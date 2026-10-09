import { User, RoleAssignment, RefreshToken, Mail, PasswordReset, ImportJob, OrgUnit } from '../models/index.js'
import { parse } from 'csv-parse/sync'
import { org, createOrg } from './org.js'
import { loadActor, loadActors, loadAllActors, invalidateTeaching, publicCard } from './actors.js'
import { assertCanAssign, canDM } from '../policy/index.js'
import { has, hasAny, holds, rankOf, RANK, UNIQUE_ROLES, roleLabel, deptIdOf } from '../policy/roles.js'
import { hashPassword, assertStrongPassword } from '../lib/auth.js'
import { AppError } from '../lib/errors.js'
import { randomToken, parseReg, strId, uniq, addDays } from '../lib/util.js'
import { audit } from '../lib/audit.js'
import { notify } from '../lib/notify.js'
import { disconnectUser, toUser } from '../lib/realtime.js'
import { resync, createBatchGroups } from './groups.js'
import { refreshUserRooms } from '../sockets/rooms.js'
import { autoFollow } from './channels.js'
import { releaseAgentTickets } from './tickets.js'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function sendMail(to, subject, body, meta) {
  await Mail.create({ to, subject, body, meta })
  if (process.env.NODE_ENV !== 'test') console.log(`✉  [mail → ${to}] ${subject}`)
}

export function tempPassword() { return `Tmp-${randomToken(4)}!${Math.floor(Math.random() * 90 + 10)}` }

export async function createUser(actor, p, { skipAudit = false } = {}) {
  const uid = String(p.uid ?? '').trim().toUpperCase()
  if (!uid || !p.name || !EMAIL_RE.test(p.email ?? '')) throw new AppError('VALIDATION_FAILED', 422, { fields: ['uid', 'name', 'email'] })
  if (await User.findOne({ $or: [{ uid }, { email: p.email.toLowerCase() }] })) throw new AppError('CONFLICT', 409, { reason: 'Duplicate ID or email.' })
  let batch = null, kind = p.kind ?? (parseReg(uid) ? 'STUDENT' : 'STAFF')
  if (kind === 'STUDENT') {
    const r = parseReg(uid)
    if (!r) throw new AppError('VALIDATION_FAILED', 422, { field: 'uid', reason: 'Registration number must look like FA23-BCS-014.' })
    batch = org.byCode(r.batchCode)
    if (!batch) throw new AppError('VALIDATION_FAILED', 422, { field: 'uid', reason: `Batch ${r.batchCode} doesn't exist yet.` })
  }
  // permission: Admin creates any; HOD creates teachers in own department; SA Officer creates single students
  if (actor) {
    const okAdmin = hasAny(actor, ['ADMIN', 'SUPER_ADMIN'])
    const okHod = kind === 'STAFF' && p.department && holds(actor, 'HOD', org.byCode(p.department)?._id) && (p.roles ?? ['TEACHER']).every((r) => r === 'TEACHER')
    const okSa = kind === 'STUDENT' && hasAny(actor, ['SA_OFFICER', 'SA_HEAD'])
    if (!(okAdmin || okHod || okSa)) throw new AppError(kind === 'STAFF' && has(actor, 'HOD') ? 'DEPARTMENT_BOUNDARY' : 'FORBIDDEN', 403)
  }
  const temp = p.password ?? tempPassword()
  const dept = p.department ? org.byCode(p.department) : batch ? org.departmentOf(batch._id) : null
  const u = await User.create({
    uid, name: p.name, email: p.email.toLowerCase(), passwordHash: await hashPassword(temp), kind, batchId: batch?._id, departmentId: kind === 'STAFF' ? dept?._id : undefined,
    designation: p.designation, cabin: p.cabin, phone: p.phone, gender: p.gender, semester: p.semester, mustChangePassword: p.mustChangePassword ?? true, tempPasswordExpires: addDays(new Date(), 7),
  })
  if (kind === 'STUDENT') await RoleAssignment.create({ userId: u._id, role: 'STUDENT', orgUnitId: batch._id, assignedBy: actor?._id })
  for (const r of p.roles ?? (kind === 'STAFF' ? [] : [])) {
    const target = p.roleOrg ? org.byCode(p.roleOrg) : dept
    await assignRole(actor, { userId: u._id, role: r, orgUnitId: target?._id ?? org.campus()._id }, { bypass: !actor })
  }
  await autoFollow(u)
  if (!p.silent) await sendMail(u.email, 'Your CUI Connect account', `Sign in with ${u.uid}. Temporary password: ${temp} (valid 7 days).`, { uid: u.uid })
  if (!skipAudit) await audit(actor, 'user.create', { category: 'account', target: { kind: 'user', id: String(u._id), label: u.uid } })
  return { user: u.toObject(), temporaryPassword: p.password ? undefined : temp }
}

/** One transaction-like role assignment honouring rank, self-assignment and uniqueness rules. */
export async function assignRole(actor, { userId, role, orgUnitId, flags, from, to }, { bypass = false } = {}) {
  if (!bypass) {
    const v = assertCanAssign(actor, role, orgUnitId, userId)
    if (!v.allow) throw new AppError(v.code, 403, v.meta)
  }
  if (UNIQUE_ROLES.includes(role)) {
    const prev = await RoleAssignment.find({ role, orgUnitId, to: null, userId: { $ne: userId } }).lean()
    if (prev.length) await RoleAssignment.updateMany({ _id: { $in: prev.map((p) => p._id) } }, { to: new Date() })
    for (const p of prev) { notify(p.userId, { type: 'role', title: `Your ${roleLabel(role)} role has ended`, mutable: false }); refreshUserRooms(String(p.userId)) }
  }
  if (role === 'HOD' && !bypass) {
    const elsewhere = await RoleAssignment.findOne({ userId, role: 'HOD', to: null, orgUnitId: { $ne: orgUnitId } })
    if (elsewhere) throw new AppError('CONFLICT', 409, { reason: 'This person is already HOD of another department.' })
  }
  const existing = await RoleAssignment.findOne({ userId, role, orgUnitId, to: null })
  const row = existing ?? (await RoleAssignment.create({ userId, role, orgUnitId, flags, from: from ?? new Date(), to, assignedBy: actor?._id }))
  if (existing && flags) { existing.flags = { ...(existing.flags ?? {}), ...flags }; await existing.save() }
  if (!bypass) {
    await audit(actor, 'role.assign', { category: 'account', target: { kind: 'user', id: String(userId) }, meta: { role, orgUnit: org.get(orgUnitId)?.code } })
    notify(userId, { type: 'role', title: `You are now ${roleLabel(role)}${org.get(orgUnitId) ? ` · ${org.get(orgUnitId).code}` : ''}`, mutable: false })
    invalidateTeaching(); await resync()
    await refreshUserRooms(String(userId))
  }
  return row
}

export async function endRole(actor, assignmentId, { replacementChosen = false } = {}) {
  const row = await RoleAssignment.findById(assignmentId)
  if (!row) throw new AppError('NOT_FOUND', 404)
  const v = assertCanAssign(actor, row.role, row.orgUnitId, null)
  if (!v.allow) throw new AppError(v.code, 403, v.meta)
  if (row.role === 'COORDINATOR') {
    const left = await RoleAssignment.countDocuments({ role: 'COORDINATOR', orgUnitId: row.orgUnitId, to: null, _id: { $ne: row._id } })
    if (!left) throw new AppError('INCOMPLETE_HIERARCHY', 422, { missing: ['coordinators'], reason: 'A department needs at least one coordinator.' })
  }
  if (['HOD', 'CAMPUS_INCHARGE', 'SA_HEAD', 'PROGRAM_INCHARGE'].includes(row.role) && !replacementChosen)
    throw new AppError('INCOMPLETE_HIERARCHY', 422, { missing: [row.role.toLowerCase()], reason: 'Choose the replacement first; a role like this is only ever ended by replacing it.' })
  row.to = new Date(); await row.save()
  await audit(actor, 'role.end', { category: 'account', target: { kind: 'user', id: String(row.userId) }, meta: { role: row.role } })
  notify(row.userId, { type: 'role', title: `Your ${roleLabel(row.role)} role has ended`, mutable: false })
  invalidateTeaching(); await resync(); await refreshUserRooms(String(row.userId))
  return { ok: true }
}

export async function setStatus(actor, userId, status, reason) {
  const target = await loadActor(userId)
  if (!target) throw new AppError('NOT_FOUND', 404)
  // admins can't touch admin accounts; super admin can, never the last one
  if (hasAny(target, ['ADMIN', 'SUPER_ADMIN']) && !has(actor, 'SUPER_ADMIN')) throw new AppError('RANK_VIOLATION', 403)
  if (target.id === actor.id) throw new AppError('SELF_ASSIGNMENT', 403, { reason: "You can't suspend yourself." })
  if (status === 'SUSPENDED') {
    if (has(target, 'SUPER_ADMIN')) {
      const others = await RoleAssignment.countDocuments({ role: 'SUPER_ADMIN', to: null, userId: { $ne: target._id } })
      if (!others) throw new AppError('FORBIDDEN', 403, { reason: 'The last active Super Admin can never be suspended.' })
    }
    for (const r of target.roles.filter((x) => ['HOD', 'CAMPUS_INCHARGE', 'SA_HEAD'].includes(x.role)))
      throw new AppError('INCOMPLETE_HIERARCHY', 422, { reason: `Choose a replacement ${roleLabel(r.role)} first.`, role: r.role })
    if (target.roles.some((r) => r.flags?.coordinatorsGroupManager)) throw new AppError('INCOMPLETE_HIERARCHY', 422, { reason: 'Designate a replacement Coordinators-group manager first.' })
  }
  await User.updateOne({ _id: userId }, { status, suspendedReason: status === 'SUSPENDED' ? reason : undefined })
  if (status === 'SUSPENDED') {
    await RefreshToken.updateMany({ userId, revokedAt: null }, { revokedAt: new Date() })
    toUser(userId, 'account:suspended', { reason }); await disconnectUser(userId); await releaseAgentTickets(userId)
    await sendMail(target.email, 'Your CUI Connect account was suspended', reason ?? 'Contact the Admin Office.')
  }
  await audit(actor, `user.${status.toLowerCase()}`, { category: 'account', target: { kind: 'user', id: userId, label: target.uid }, meta: { reason } })
  return { ok: true, status }
}

export async function adminResetPassword(actor, userId) {
  const target = await loadActor(userId)
  if (!target) throw new AppError('NOT_FOUND', 404)
  if (hasAny(target, ['ADMIN', 'SUPER_ADMIN']) && !has(actor, 'SUPER_ADMIN')) throw new AppError('RANK_VIOLATION', 403)
  const temp = tempPassword()
  await User.updateOne({ _id: userId }, { passwordHash: await hashPassword(temp), mustChangePassword: true, tempPasswordExpires: addDays(new Date(), 7), failedLogins: 0, lockedUntil: null })
  await RefreshToken.updateMany({ userId, revokedAt: null }, { revokedAt: new Date() })
  await disconnectUser(userId)
  await sendMail(target.email, 'Password reset', `Temporary password: ${temp}`)
  await audit(actor, 'user.reset-password', { category: 'security', target: { kind: 'user', id: userId, label: target.uid } })
  return { ok: true }
}

export async function listUsers(actor, { q, role, department, batch, status, kind, page = 1, limit = 25 }) {
  const f = {}
  if (status) f.status = status
  if (kind) f.kind = kind
  if (q) f.$or = [{ name: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }, { uid: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }, { email: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }]
  if (batch) f.batchId = org.byCode(batch)?._id
  if (department) { const d = org.byCode(department); const ids = d ? org.subtree(d._id) : []; f.$and = [{ $or: [{ departmentId: d?._id }, { batchId: { $in: ids } }] }] }
  let users = await User.find(f).sort({ name: 1 }).lean()
  const as = await RoleAssignment.find({ userId: { $in: users.map((u) => u._id) }, to: null }).lean()
  const byUser = new Map()
  for (const a of as) (byUser.get(String(a.userId)) ?? byUser.set(String(a.userId), []).get(String(a.userId))).push(a)
  let rows = users.map((u) => ({
    id: String(u._id), uid: u.uid, name: u.name, email: u.email, kind: u.kind, status: u.status, designation: u.designation, batch: org.get(u.batchId)?.code,
    department: org.get(u.departmentId ?? org.departmentOf(u.batchId)?._id)?.code, lastLoginAt: u.lastLoginAt,
    roles: (byUser.get(String(u._id)) ?? []).filter((a) => a.role !== 'STUDENT').map((a) => ({ role: a.role, label: roleLabel(a.role), orgUnit: org.get(a.orgUnitId)?.code })),
  }))
  if (role) rows = rows.filter((r) => r.roles.some((x) => x.role === role) || (role === 'STUDENT' && r.kind === 'STUDENT'))
  const total = rows.length
  return { items: rows.slice((page - 1) * limit, page * limit), total, page, pages: Math.ceil(total / limit) }
}

export async function userDetail(actor, id) {
  const u = await User.findById(id).lean()
  if (!u) throw new AppError('NOT_FOUND', 404)
  const roles = await RoleAssignment.find({ userId: id }).sort({ from: -1 }).lean()
  const sessions = await RefreshToken.find({ userId: id, revokedAt: null, expiresAt: { $gt: new Date() } }).sort({ lastUsedAt: -1 }).lean()
  const { AuditLog } = await import('../models/index.js')
  const trail = await AuditLog.find({ $or: [{ 'target.id': id }, { actorId: id }] }).sort({ at: -1 }).limit(30).lean()
  const target = await loadActor(id)
  return {
    user: { id, uid: u.uid, name: u.name, email: u.email, kind: u.kind, status: u.status, designation: u.designation, cabin: u.cabin, phone: u.phone, semester: u.semester, batch: org.get(u.batchId)?.code, department: org.get(deptIdOf(target))?.code, lastLoginAt: u.lastLoginAt, suspendedReason: u.suspendedReason, mustChangePassword: u.mustChangePassword },
    roles: roles.map((r) => ({ id: String(r._id), role: r.role, label: roleLabel(r.role), orgUnit: org.get(r.orgUnitId)?.code, orgUnitId: String(r.orgUnitId), from: r.from, to: r.to, flags: r.flags, active: !r.to || r.to > new Date() })),
    sessions: sessions.map((s) => ({ id: String(s._id), device: s.device, ip: s.ip, lastUsedAt: s.lastUsedAt })),
    audit: trail.map((a) => ({ id: String(a._id), action: a.action, actor: a.actorName, at: a.at, meta: a.meta })),
    readOnly: hasAny(target, ['ADMIN', 'SUPER_ADMIN']) && !has(actor, 'SUPER_ADMIN'),
  }
}

export async function updateUser(actor, id, patch) {
  const target = await loadActor(id)
  if (!target) throw new AppError('NOT_FOUND', 404)
  if (hasAny(target, ['ADMIN', 'SUPER_ADMIN']) && !has(actor, 'SUPER_ADMIN') && target.id !== actor.id) throw new AppError('RANK_VIOLATION', 403)
  const allowed = target.id === actor.id ? ['phone'] : ['name', 'email', 'designation', 'cabin', 'phone', 'semester', 'gender']
  const upd = {}
  for (const k of allowed) if (patch[k] !== undefined) upd[k] = patch[k]
  const before = Object.fromEntries(Object.keys(upd).map((k) => [k, target[k]]))
  await User.updateOne({ _id: id }, upd)
  await audit(actor, 'user.update', { category: 'account', target: { kind: 'user', id, label: target.uid }, before, after: upd })
  return { ok: true }
}

// ---------- CSV import (ADM-08) ----------
export async function importPreview(actor, buffer, fileName) {
  let records
  try { records = parse(buffer, { columns: (h) => h.map((x) => x.trim().toLowerCase().replace(/\s+/g, '')), skip_empty_lines: true, trim: true }) } catch (e) { throw new AppError('VALIDATION_FAILED', 422, { reason: `Could not read the CSV: ${e.message}` }) }
  const seen = new Set()
  const existing = new Set((await User.find({}, 'uid email').lean()).flatMap((u) => [u.uid, u.email]))
  const rows = records.map((r, i) => {
    const uid = String(r.regno ?? r.uid ?? r.registrationno ?? '').toUpperCase()
    const name = r.name, email = String(r.email ?? '').toLowerCase()
    const errs = []
    const parsed = parseReg(uid)
    if (!parsed) errs.push('Registration number format is invalid (expected FA23-BCS-014).')
    else if (!org.byCode(parsed.batchCode)) errs.push(`Batch ${parsed.batchCode} does not exist.`)
    if (!name) errs.push('Name is required.')
    if (!EMAIL_RE.test(email)) errs.push('Email is invalid.')
    if (seen.has(uid) || existing.has(uid)) errs.push('Duplicate registration number.')
    if (seen.has(email) || existing.has(email)) errs.push('Email already used.')
    seen.add(uid); seen.add(email)
    return { row: i + 2, uid, name, email, section: r.section, batchCode: parsed?.batchCode, errors: errs, ok: errs.length === 0 }
  })
  const byBatch = {}
  for (const r of rows.filter((x) => x.ok)) byBatch[r.batchCode] = (byBatch[r.batchCode] ?? 0) + 1
  const job = await ImportJob.create({ startedBy: actor._id, fileName, rows, status: 'PREVIEW', summary: { total: rows.length, valid: rows.filter((r) => r.ok).length, invalid: rows.filter((r) => !r.ok).length, byBatch } })
  return { jobId: String(job._id), summary: job.summary, groups: Object.entries(byBatch).map(([code, n]) => ({ code, count: n, message: `${n} students will join ${code} class group` })), rows: rows.slice(0, 500) }
}

export async function importCommit(actor, jobId) {
  const job = await ImportJob.findById(jobId)
  if (!job || job.status !== 'PREVIEW') throw new AppError('NOT_FOUND', 404)
  const done = [], failed = []
  for (const r of job.rows.filter((x) => x.ok)) {
    try { await createUser(actor, { uid: r.uid, name: r.name, email: r.email, kind: 'STUDENT', silent: false }, { skipAudit: true }); done.push(r.uid) } catch (e) { failed.push({ ...r, errors: [e.code ?? e.message] }) }
  }
  job.status = 'DONE'; job.errorRows = [...job.rows.filter((x) => !x.ok), ...failed]; job.summary = { ...job.summary, imported: done.length, failed: job.errorRows.length }
  await job.save()
  await resync()
  await audit(actor, 'user.import', { category: 'account', meta: { imported: done.length, failed: job.errorRows.length, file: job.fileName } })
  notify(actor.id, { type: 'import', title: `Import finished: ${done.length} students added`, body: failed.length ? `${job.errorRows.length} rows had errors.` : undefined, link: '/admin/import' })
  return { imported: done.length, errors: job.errorRows, summary: job.summary }
}

export function importErrorsCsv(job) {
  const esc = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`
  return ['row,regNo,name,email,errors', ...(job.errorRows ?? []).map((e) => [e.row, e.uid, e.name, e.email, (e.errors ?? []).join('; ')].map(esc).join(','))].join('\n')
}

/** Student changing batch, program, status (F-26). */
export async function moveStudent(actor, userId, { batchCode, status }) {
  const u = await User.findById(userId)
  if (!u || u.kind !== 'STUDENT') throw new AppError('NOT_FOUND', 404)
  const dept = org.departmentOf(u.batchId)
  if (batchCode) {
    const b = org.byCode(batchCode)
    if (!b) throw new AppError('NOT_FOUND', 404)
    const allowed = hasAny(actor, ['ADMIN', 'SUPER_ADMIN']) || holds(actor, 'COORDINATOR', dept?._id) || holds(actor, 'HOD', dept?._id)
    if (!allowed) throw new AppError('DEPARTMENT_BOUNDARY', 403)
    u.batchId = b._id
    await RoleAssignment.updateMany({ userId, role: { $in: ['STUDENT', 'CR'] }, to: null }, { to: new Date() })
    await RoleAssignment.create({ userId, role: 'STUDENT', orgUnitId: b._id, assignedBy: actor._id })
  }
  if (status) u.status = status
  await u.save()
  await audit(actor, 'user.move', { category: 'account', target: { kind: 'user', id: userId, label: u.uid }, meta: { batchCode, status } })
  invalidateTeaching(); await resync(); await refreshUserRooms(userId)
  return { ok: true }
}

/** Directory search that tells the UI whether a DM is allowed and why not (MSG-14, APP-04). */
export async function directory(actor, { q = '', limit = 20 }, ctx) {
  const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
  const users = await User.find({ status: { $nin: ['INACTIVE'] }, _id: { $ne: actor._id }, $or: [{ name: rx }, { uid: rx }] }).limit(60).lean()
  const actors = await loadActors(users.map((u) => u._id))
  const out = []
  for (const t of actors) {
    const v = await canDM(actor, t, ctx)
    out.push({ ...publicCard(t), dm: { allowed: v.allow, route: v.meta?.route, rule: v.meta?.rule } })
  }
  return out.sort((a, b) => Number(b.dm.allowed) - Number(a.dm.allowed) || a.name.localeCompare(b.name)).slice(0, limit)
}
