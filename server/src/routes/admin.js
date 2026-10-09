import { Router } from 'express'
import { z } from 'zod'
import multer from 'multer'
import { User, RoleAssignment, Group, Membership, Desk, Channel, ChannelFollow, AuditLog, Report, ImportJob, Term, Setting, OrgUnit, Announcement, Ticket } from '../models/index.js'
import { requireRole } from '../lib/auth.js'
import { asyncH } from '../lib/util.js'
import { parse } from '../lib/http.js'
import { AppError } from '../lib/errors.js'
import { audit } from '../lib/audit.js'
import { org } from '../services/org.js'
import { has, hasAny, roleLabel, RANK } from '../policy/roles.js'
import * as U from '../services/users.js'
import * as D from '../services/departments.js'
import * as T from '../services/terms.js'
import * as R from '../services/reports.js'
import { loadActors, loadAllActors, publicCard, currentTerm } from '../services/actors.js'
import { onlineUserIds } from '../lib/realtime.js'
import { resync } from '../services/groups.js'
import { BOARD_PUBLISHERS } from '../policy/index.js'
import { autoFollow } from '../services/channels.js'
import { refreshAllRooms } from '../sockets/rooms.js'

const r = Router()
const admin = requireRole('ADMIN', 'SUPER_ADMIN')
const superOnly = requireRole('SUPER_ADMIN')
const csv = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5_000_000 } })

// ---------------- dashboard (ADM-01)
r.get('/admin/dashboard', admin, asyncH(async (req, res) => {
  const [users, students, staff, batches, reports, jobs, term, openTickets] = await Promise.all([
    User.countDocuments(), User.countDocuments({ kind: 'STUDENT' }), User.countDocuments({ kind: 'STAFF' }), OrgUnit.countDocuments({ type: 'BATCH', status: 'ACTIVE' }),
    Report.countDocuments({ status: { $in: ['OPEN', 'IN_REVIEW', 'ESCALATED'] } }), ImportJob.find().sort({ createdAt: -1 }).limit(5).lean(), currentTerm(), Ticket.countDocuments({ status: { $in: ['OPEN', 'IN_PROGRESS', 'ESCALATED'] } }),
  ])
  res.json({
    counts: { users, students, staff, departments: org.ofType('DEPARTMENT').filter((d) => d.status === 'ACTIVE').length, batches, openReports: reports, openTickets, online: (await onlineUserIds()).size },
    currentTerm: term ? { code: term.code, name: term.name, endsAt: term.endsAt } : null,
    importJobs: jobs.map((j) => ({ id: String(j._id), file: j.fileName, status: j.status, summary: j.summary, at: j.createdAt })),
    suspended: await User.countDocuments({ status: 'SUSPENDED' }),
  })
}))

// ---------------- admins (ADM-18, super admin)
r.get('/admin/admins', superOnly, asyncH(async (req, res) => {
  const rows = await RoleAssignment.find({ role: { $in: ['ADMIN', 'SUPER_ADMIN'] }, to: null }).lean()
  const actors = await loadActors(rows.map((x) => x.userId))
  res.json(actors.map((a) => ({ ...publicCard(a), role: a.roles.some((x) => x.role === 'SUPER_ADMIN') ? 'SUPER_ADMIN' : 'ADMIN', coordinatorsGroupManager: a.roles.some((x) => x.flags?.coordinatorsGroupManager), lastSeenAt: a.lastSeenAt })))
}))
r.post('/admin/admins', superOnly, asyncH(async (req, res) => {
  const p = parse(z.object({ uid: z.string(), name: z.string(), email: z.string().email(), coordinatorsGroupManager: z.boolean().optional() }), req.body)
  const out = await U.createUser(req.actor, { uid: p.uid, name: p.name, email: p.email, kind: 'STAFF', designation: 'Admin Office' })
  await U.assignRole(req.actor, { userId: out.user._id, role: 'ADMIN', orgUnitId: org.campus()._id, flags: p.coordinatorsGroupManager ? { coordinatorsGroupManager: true } : undefined })
  res.status(201).json({ id: String(out.user._id), temporaryPassword: out.temporaryPassword })
}))
r.post('/admin/admins/:id/suspend', superOnly, asyncH(async (req, res) => {
  const count = await RoleAssignment.countDocuments({ role: 'ADMIN', to: null, userId: { $ne: req.params.id } })
  if (!count && org.ofType('DEPARTMENT').length) throw new AppError('FORBIDDEN', 403, { reason: "Can't suspend the last Admin while departments exist." })
  res.json(await U.setStatus(req.actor, req.params.id, 'SUSPENDED', req.body?.reason))
}))
r.put('/admin/coordinators-manager/:id', superOnly, asyncH(async (req, res) => {
  await RoleAssignment.updateMany({ role: 'ADMIN', to: null }, { $unset: { 'flags.coordinatorsGroupManager': '' } })
  const row = await RoleAssignment.findOne({ role: 'ADMIN', userId: req.params.id, to: null })
  if (!row) throw new AppError('NOT_FOUND', 404)
  row.flags = { ...(row.flags ?? {}), coordinatorsGroupManager: true }; row.markModified('flags'); await row.save()
  await resync(); await audit(req.actor, 'admin.designate-coordinators-manager', { category: 'structure', target: { kind: 'user', id: req.params.id } })
  res.json({ ok: true })
}))

// ---------------- departments (ADM-02/03/04)
r.get('/admin/departments', admin, asyncH(async (req, res) => res.json(await D.listDepartments())))
r.post('/admin/departments', admin, asyncH(async (req, res) => res.status(201).json(await D.createDepartment(req.actor, req.body))))
r.get('/admin/departments/:id', admin, asyncH(async (req, res) => res.json(await D.departmentDetail(req.params.id))))
r.patch('/admin/departments/:id', admin, asyncH(async (req, res) => res.json(await D.updateDepartment(req.actor, req.params.id, req.body))))
r.post('/admin/departments/:id/archive', admin, asyncH(async (req, res) => res.json(await D.archiveDepartment(req.actor, req.params.id))))
r.post('/admin/departments/validate', admin, asyncH(async (req, res) => { D.assertCompleteHierarchy(req.body); res.json({ ok: true }) }))
r.get('/admin/staff', admin, asyncH(async (req, res) => { // pickers for the wizard
  const q = String(req.query.q ?? '')
  const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
  const rows = await User.find({ kind: 'STAFF', status: 'ACTIVE', $or: [{ name: rx }, { uid: rx }] }).limit(30).lean()
  res.json((await loadActors(rows.map((u) => u._id))).map((a) => ({ ...publicCard(a), roles: a.roles.map((x) => ({ role: x.role, orgUnit: org.get(x.orgUnitId)?.code })) })))
}))

// ---------------- users (ADM-05/06/07/08)
r.get('/admin/users', admin, asyncH(async (req, res) => res.json(await U.listUsers(req.actor, { ...req.query, page: Number(req.query.page ?? 1), limit: Number(req.query.limit ?? 25) }))))
r.post('/admin/users', asyncH(async (req, res) => {
  const p = parse(z.object({ uid: z.string(), name: z.string(), email: z.string(), kind: z.enum(['STUDENT', 'STAFF']).optional(), department: z.string().optional(), designation: z.string().optional(), cabin: z.string().optional(), semester: z.number().optional(), roles: z.array(z.string()).optional(), roleOrg: z.string().optional() }), req.body)
  const out = await U.createUser(req.actor, p)
  res.status(201).json({ id: String(out.user._id), uid: out.user.uid, temporaryPassword: out.temporaryPassword })
}))
r.get('/admin/users/:id', admin, asyncH(async (req, res) => res.json(await U.userDetail(req.actor, req.params.id))))
r.patch('/admin/users/:id', admin, asyncH(async (req, res) => res.json(await U.updateUser(req.actor, req.params.id, req.body))))
r.post('/admin/users/:id/status', admin, asyncH(async (req, res) => res.json(await U.setStatus(req.actor, req.params.id, parse(z.object({ status: z.enum(['ACTIVE', 'SUSPENDED', 'FROZEN', 'INACTIVE']), reason: z.string().optional() }), req.body).status, req.body.reason))))
r.post('/admin/users/:id/reset-password', admin, asyncH(async (req, res) => res.json(await U.adminResetPassword(req.actor, req.params.id))))
r.post('/admin/users/:id/resend-activation', admin, asyncH(async (req, res) => res.json(await U.adminResetPassword(req.actor, req.params.id))))
r.post('/admin/users/bulk', admin, asyncH(async (req, res) => {
  const { ids, action } = parse(z.object({ ids: z.array(z.string()).max(200), action: z.enum(['suspend', 'reset-password']) }), req.body)
  const results = []
  for (const id of ids) { try { action === 'suspend' ? await U.setStatus(req.actor, id, 'SUSPENDED', req.body.reason) : await U.adminResetPassword(req.actor, id); results.push({ id, ok: true }) } catch (e) { results.push({ id, ok: false, code: e.code }) } }
  res.json({ results })
}))
r.post('/admin/users/import', admin, csv.single('file'), asyncH(async (req, res) => { if (!req.file) throw new AppError('VALIDATION_FAILED', 422, { reason: 'Attach a CSV file.' }); res.json(await U.importPreview(req.actor, req.file.buffer, req.file.originalname)) }))
r.post('/admin/users/import/:jobId/commit', admin, asyncH(async (req, res) => res.json(await U.importCommit(req.actor, req.params.jobId))))
r.get('/admin/users/import/:jobId/errors.csv', admin, asyncH(async (req, res) => { const job = await ImportJob.findById(req.params.jobId).lean(); res.type('text/csv').attachment('import-errors.csv').send(U.importErrorsCsv(job)) }))
r.get('/admin/imports', admin, asyncH(async (req, res) => res.json((await ImportJob.find().sort({ createdAt: -1 }).limit(20).lean()).map((j) => ({ id: String(j._id), file: j.fileName, status: j.status, summary: j.summary, at: j.createdAt })))))

// ---------------- roles (ADM-09) — checks live in policy.assertCanAssign
r.post('/admin/roles', asyncH(async (req, res) => {
  const p = parse(z.object({ userId: z.string(), role: z.string(), orgUnitId: z.string(), flags: z.record(z.any()).optional(), from: z.coerce.date().optional(), to: z.coerce.date().optional() }), req.body)
  res.status(201).json({ id: String((await U.assignRole(req.actor, p))._id) })
}))
r.patch('/admin/roles', asyncH(async (req, res) => { // reassign HOD / PI / coordinator: new holder chosen before the old one is removed
  const p = parse(z.object({ role: z.enum(['HOD', 'PROGRAM_INCHARGE', 'COORDINATOR', 'CAMPUS_INCHARGE', 'SA_HEAD']), orgUnitId: z.string(), userId: z.string() }), req.body)
  await U.assignRole(req.actor, p)
  res.json({ ok: true })
}))
r.delete('/admin/roles/:id', asyncH(async (req, res) => res.json(await U.endRole(req.actor, req.params.id, { replacementChosen: req.query.replaced === 'true' }))))

// ---------------- terms & rollover (ADM-10/11)
r.get('/admin/terms', admin, asyncH(async (req, res) => res.json(await T.listTerms())))
r.post('/admin/terms', admin, asyncH(async (req, res) => res.status(201).json(await T.createTerm(req.actor, req.body))))
r.get('/admin/terms/:code/rollover', admin, asyncH(async (req, res) => res.json(await T.rolloverPreview(req.actor, req.params.code))))
r.post('/admin/terms/:code/rollover', admin, asyncH(async (req, res) => res.json(await T.rolloverExecute(req.actor, req.params.code, req.body ?? {}))))
r.post('/admin/terms/:code/current', admin, asyncH(async (req, res) => res.json(await T.setCurrentTerm(req.actor, req.params.code))))

// ---------------- offices (ADM-12)
r.get('/admin/offices', admin, asyncH(async (req, res) => {
  const offices = org.ofType('OFFICE')
  const actors = await loadAllActors()
  const desks = await Desk.find().lean()
  res.json(offices.map((o) => {
    const staff = actors.filter((a) => a.roles.some((x) => org.isWithin(x.orgUnitId, o._id) && x.orgUnitId === String(o._id)))
    const head = staff.find((a) => a.roles.some((x) => ['SA_HEAD', 'LIBRARIAN', 'CAFE_MANAGER', 'EXAM_OFFICER', 'PUBLISHER'].includes(x.role) && x.orgUnitId === String(o._id)))
    const desk = desks.find((d) => String(d.orgUnitId) === String(o._id))
    return { id: String(o._id), code: o.code, name: o.name, kind: o.officeKind, head: head ? { id: head.id, name: head.name } : null, staff: staff.map((s) => ({ ...publicCard(s), roles: s.roles.filter((x) => x.orgUnitId === String(o._id)).map((x) => roleLabel(x.role)) })), desk: desk ? { slug: desk.slug, name: desk.name } : null }
  }))
}))

// ---------------- groups directory (ADM-13) — no message content ever
r.get('/admin/groups', admin, asyncH(async (req, res) => {
  const gs = await Group.find({ kind: { $ne: 'DIRECT' } }).sort({ kind: 1, name: 1 }).lean()
  const counts = await Membership.aggregate([{ $match: { groupId: { $in: gs.map((g) => g._id) } } }, { $group: { _id: '$groupId', n: { $sum: 1 } } }])
  const cm = new Map(counts.map((c) => [String(c._id), c.n]))
  res.json(gs.map((g) => ({ id: String(g._id), name: g.name, kind: g.kind, scope: org.get(g.orgUnitId)?.code, members: cm.get(String(g._id)) ?? 0, manager: g.manager?.role ? roleLabel(g.manager.role) : g.manager?.flag ? 'Designated Admin' : g.ownerId ? 'Owner' : null, announceOnly: g.announceOnly, status: g.archived ? 'ARCHIVED' : 'ACTIVE' })))
}))
r.post('/admin/groups/:id/archive', admin, asyncH(async (req, res) => { await Group.updateOne({ _id: req.params.id }, { archived: true }); await audit(req.actor, 'group.archive', { category: 'structure', target: { kind: 'group', id: req.params.id } }); res.json({ ok: true }) }))

// ---------------- channels admin (ADM-14) and board scopes (ADM-15)
r.get('/admin/users/import/template.csv', admin, (req, res) => res.type('text/csv').attachment('student-import-template.csv').send('regNo,name,email,section\nFA26-BCS-020,Example Student,fa26-bcs-020@students.comsats.edu.pk,A\n'))
r.post('/admin/channels', asyncH(async (req, res) => {
  // Admin creates any channel; Student Affairs creates societies (and their leads) for their own office
  if (!hasAny(req.actor, ['ADMIN', 'SUPER_ADMIN']) && !(hasAny(req.actor, ['SA_HEAD', 'SA_OFFICER']) && req.body?.kind === 'SOCIETY')) throw new AppError('FORBIDDEN', 403)
  const p = parse(z.object({ slug: z.string().regex(/^[a-z0-9-]+$/), name: z.string(), description: z.string().optional(), kind: z.enum(['INSTITUTIONAL', 'SOCIETY', 'UTILITY', 'DEPARTMENT']).default('INSTITUTIONAL'), ownerOfficeCode: z.string().optional(), joinMode: z.enum(['AUTO_LOCKED', 'AUTO_MUTE', 'OPT_IN']).default('OPT_IN'), publisherIds: z.array(z.string()).optional(), leadId: z.string().optional(), requireApproval: z.boolean().optional(), openSubmissions: z.boolean().optional(), deskSlug: z.string().optional() }), req.body)
  if (await Channel.findOne({ slug: p.slug })) throw new AppError('CONFLICT', 409)
  const office = p.ownerOfficeCode ? org.byCode(p.ownerOfficeCode) : null
  const c = await Channel.create({ ...p, initials: p.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase(), code: `CH-${p.slug.toUpperCase().slice(0, 8)}`, ownerOfficeId: office?._id, ownerLabel: office?.name })
  if (p.joinMode !== 'OPT_IN') for (const u of await User.find({ status: 'ACTIVE' })) await autoFollow(u)
  await audit(req.actor, 'channel.create', { category: 'structure', target: { kind: 'channel', id: String(c._id), label: c.name } })
  res.status(201).json({ id: String(c._id) })
}))
r.get('/admin/board-scopes', admin, asyncH(async (req, res) => res.json({ publishersByScopeType: BOARD_PUBLISHERS, scopes: org.all().filter((o) => ['CAMPUS', 'DEPARTMENT', 'PROGRAM', 'BATCH'].includes(o.type) && o.status === 'ACTIVE').map((o) => ({ id: String(o._id), type: o.type, code: o.code, name: o.name, publishers: BOARD_PUBLISHERS[o.type] })) })))

// ---------------- reports (ADM-16)
r.get('/reports', asyncH(async (req, res) => res.json(await R.listReports(req.actor, { tab: req.query.tab }))))
r.get('/reports/:id', asyncH(async (req, res) => res.json(await R.reportDetail(req.actor, req.params.id))))
r.post('/reports/:id/action', asyncH(async (req, res) => res.json(await R.reportAction(req.actor, req.params.id, parse(z.object({ action: z.enum(['dismiss', 'warn', 'mute', 'escalate', 'remove']), note: z.string().optional(), messageId: z.string().optional() }), req.body)))))
r.post('/reports/:id/suspend', admin, asyncH(async (req, res) => res.json(await R.suspendFromReport(req.actor, req.params.id, req.body?.reason))))

// ---------------- audit (ADM-17): admin sees own actions + structure changes; super admin sees everything
r.get('/admin/audit', admin, asyncH(async (req, res) => {
  const q = {}
  if (!has(req.actor, 'SUPER_ADMIN')) q.$or = [{ actorId: req.actor._id }, { category: 'structure' }]
  if (req.query.actor) q.actorUid = String(req.query.actor).toUpperCase()
  if (req.query.action) q.action = new RegExp(String(req.query.action).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
  if (req.query.category) q.category = req.query.category
  if (req.query.from || req.query.to) q.at = { ...(req.query.from ? { $gte: new Date(req.query.from) } : {}), ...(req.query.to ? { $lte: new Date(req.query.to) } : {}) }
  const page = Number(req.query.page ?? 1), limit = Math.min(Number(req.query.limit ?? 50), 200)
  const [items, total] = await Promise.all([AuditLog.find(q).sort({ at: -1 }).skip((page - 1) * limit).limit(limit).lean(), AuditLog.countDocuments(q)])
  if (req.query.format === 'csv') return res.type('text/csv').attachment('audit.csv').send(['at,actor,action,category,target', ...items.map((a) => [a.at.toISOString(), a.actorUid, a.action, a.category, a.target?.label ?? ''].join(','))].join('\n'))
  res.json({ items: items.map((a) => ({ id: String(a._id), at: a.at, actor: a.actorName, actorUid: a.actorUid, action: a.action, category: a.category, target: a.target, meta: a.meta, before: a.before, after: a.after, ip: a.ip })), total, page, pages: Math.ceil(total / limit) })
}))

// ---------------- system settings (ADM-19, super admin)
const DEFAULT_SETTINGS = { smtp: { host: 'smtp.comsats.edu.pk', port: 587, from: 'no-reply@comsats.edu.pk' }, uploads: { maxMb: 10, types: ['pdf', 'png', 'jpg'] }, passwordPolicy: { minLength: 10, lockoutAttempts: 5, lockoutMinutes: 15 }, retention: { auditYears: 3, removedMessageDays: 30 }, maintenance: { enabled: false, message: '' } }
r.get('/admin/system', superOnly, asyncH(async (req, res) => res.json({ ...DEFAULT_SETTINGS, ...((await Setting.findOne({ key: 'system' }).lean())?.value ?? {}) })))
r.put('/admin/system', superOnly, asyncH(async (req, res) => {
  const cur = (await Setting.findOne({ key: 'system' }).lean())?.value ?? {}
  const next = { ...DEFAULT_SETTINGS, ...cur, ...req.body }
  await Setting.updateOne({ key: 'system' }, { value: next }, { upsert: true })
  await audit(req.actor, 'system.settings', { category: 'system', after: Object.keys(req.body) })
  res.json(next)
}))
export default r
