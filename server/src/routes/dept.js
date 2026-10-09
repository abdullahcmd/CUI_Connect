import { Router } from 'express'
import { z } from 'zod'
import multer from 'multer'
import { parse as parseCsv } from 'csv-parse/sync'
import { asyncH } from '../lib/util.js'
import { parse } from '../lib/http.js'
import { AppError } from '../lib/errors.js'
import { org } from '../services/org.js'
import { Group, Membership, RoleAssignment } from '../models/index.js'
import { hasAny, holds } from '../policy/roles.js'
import * as D from '../services/departments.js'
import { assignRole, endRole, createUser, moveStudent } from '../services/users.js'
import { loadActors } from '../services/actors.js'

const r = Router()
const csv = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5_000_000 } })

const deptGuard = (req, deptId) => {
  if (hasAny(req.actor, ['ADMIN', 'SUPER_ADMIN'])) return
  if (['HOD', 'COORDINATOR', 'PROGRAM_INCHARGE'].some((x) => holds(req.actor, x, deptId))) return
  throw new AppError('DEPARTMENT_BOUNDARY', 403)
}

r.get('/dept/mine', asyncH(async (req, res) => {
  const ids = new Set()
  if (hasAny(req.actor, ['ADMIN', 'SUPER_ADMIN'])) return res.json(org.ofType('DEPARTMENT').filter((d) => d.status === 'ACTIVE').map((d) => ({ id: String(d._id), code: d.code, name: d.name })))
  for (const x of req.actor.roles) if (['HOD', 'COORDINATOR', 'PROGRAM_INCHARGE'].includes(x.role)) { const d = org.departmentOf(x.orgUnitId); if (d) ids.add(String(d._id)) }
  res.json([...ids].map((id) => ({ id, code: org.get(id).code, name: org.get(id).name })))
}))
r.get('/dept/:id/programs', asyncH(async (req, res) => { deptGuard(req, req.params.id); res.json({ programs: org.children(req.params.id).filter((p) => p.type === 'PROGRAM').map((p) => ({ id: String(p._id), code: p.code, name: p.name })) }) }))
r.get('/dept/:id/dashboard', asyncH(async (req, res) => res.json(await D.deptDashboard(req.actor, req.params.id))))
r.get('/dept/:id/batches', asyncH(async (req, res) => { deptGuard(req, req.params.id); res.json(await D.listBatches(req.actor, req.params.id, { status: req.query.status === 'archived' ? 'ARCHIVED' : 'ACTIVE', q: req.query.q, page: Number(req.query.page ?? 1), limit: Number(req.query.limit ?? 20) })) }))
r.post('/dept/batches/preview', asyncH(async (req, res) => res.json(D.previewBatchCode(parse(z.object({ programId: z.string().optional(), programCode: z.string().optional(), intake: z.enum(['FA', 'SP']), year: z.number() }), req.body)))))
r.post('/dept/batches', asyncH(async (req, res) => res.status(201).json(await D.createBatch(req.actor, parse(z.object({ programId: z.string().optional(), programCode: z.string().optional(), intake: z.enum(['FA', 'SP']), year: z.number().int().min(2000).max(2100), section: z.string().optional() }), req.body)))))
r.get('/dept/batches/:id', asyncH(async (req, res) => res.json(await D.batchDetail(req.actor, req.params.id))))
r.put('/dept/batches/:id/crs', asyncH(async (req, res) => res.json(await D.assignCRs(req.actor, req.params.id, parse(z.object({ studentIds: z.array(z.string()).min(1).max(2) }), req.body).studentIds))))
r.patch('/dept/batches/:id', asyncH(async (req, res) => res.json(await D.setBatchPermission(req.actor, req.params.id, parse(z.object({ announceOnly: z.boolean().optional(), advisorId: z.string().optional() }), req.body)))))
r.post('/dept/students/:id/move', asyncH(async (req, res) => res.json(await moveStudent(req.actor, req.params.id, parse(z.object({ batchCode: z.string().optional(), status: z.enum(['ACTIVE', 'FROZEN']).optional() }), req.body)))))

r.get('/dept/:id/offerings', asyncH(async (req, res) => { deptGuard(req, req.params.id); res.json(await D.listOfferings(req.actor, req.params.id, req.query.term)) }))
r.post('/terms/:code/offerings', asyncH(async (req, res) => res.status(201).json(await D.upsertOffering(req.actor, req.params.code, parse(z.object({ id: z.string().optional(), courseCode: z.string().min(3), title: z.string().optional(), batchId: z.string().optional(), batchCode: z.string().optional(), teacherId: z.string(), room: z.string().optional(), slot: z.string().optional(), creditHours: z.number().optional() }), req.body)))))
r.delete('/offerings/:id', asyncH(async (req, res) => res.json(await D.deleteOffering(req.actor, req.params.id))))
r.post('/terms/:code/offerings/import', csv.single('file'), asyncH(async (req, res) => {
  if (!req.file) throw new AppError('VALIDATION_FAILED', 422, { reason: 'Attach a CSV file.' })
  const rows = parseCsv(req.file.buffer, { columns: (h) => h.map((x) => x.trim().toLowerCase().replace(/\s+/g, '')), skip_empty_lines: true, trim: true })
  res.json(await D.importOfferings(req.actor, req.params.code, rows))
}))

r.get('/dept/:id/teachers', asyncH(async (req, res) => { deptGuard(req, req.params.id); res.json(await D.teachersOfDept(req.actor, req.params.id)) }))
r.post('/dept/:id/teachers', asyncH(async (req, res) => { // DEP-08: new account, or add an existing account as teacher here
  const d = org.get(req.params.id)
  deptGuard(req, req.params.id)
  const p = parse(z.object({ existingUserId: z.string().optional(), uid: z.string().optional(), name: z.string().optional(), email: z.string().optional(), designation: z.string().optional(), cabin: z.string().optional() }), req.body)
  if (p.existingUserId) { await assignRole(req.actor, { userId: p.existingUserId, role: 'TEACHER', orgUnitId: d._id }); return res.status(201).json({ ok: true }) }
  const out = await createUser(req.actor, { uid: p.uid, name: p.name, email: p.email, kind: 'STAFF', department: d.code, roles: ['TEACHER'], designation: p.designation, cabin: p.cabin })
  res.status(201).json({ id: String(out.user._id), temporaryPassword: out.temporaryPassword })
}))
r.put('/dept/:id/roles', asyncH(async (req, res) => { // DEP-09
  const p = parse(z.object({ programIncharge: z.object({ programId: z.string(), userId: z.string() }).optional(), addCoordinatorId: z.string().optional(), endAssignmentId: z.string().optional() }), req.body)
  if (p.endAssignmentId) await endRole(req.actor, p.endAssignmentId)
  res.json(await D.updateDepartment(req.actor, req.params.id, { programIncharge: p.programIncharge, addCoordinatorId: p.addCoordinatorId }))
}))
r.get('/dept/:id/oversight', asyncH(async (req, res) => { // DEP-10 class groups and CR lines in the department
  deptGuard(req, req.params.id)
  const sub = org.subtree(req.params.id)
  const groups = await Group.find({ kind: { $in: ['CLASS', 'CR_LINE'] }, orgUnitId: { $in: sub }, archived: { $ne: true } }).lean()
  const counts = await Membership.aggregate([{ $match: { groupId: { $in: groups.map((g) => g._id) } } }, { $group: { _id: '$groupId', n: { $sum: 1 } } }])
  const cm = new Map(counts.map((c) => [String(c._id), c.n]))
  res.json(groups.map((g) => ({ id: String(g._id), name: g.name, kind: g.kind, batch: org.get(g.orgUnitId)?.code, members: cm.get(String(g._id)) ?? 0, announceOnly: g.announceOnly, lastMessageAt: g.lastMessageAt })).sort((a, b) => a.batch.localeCompare(b.batch)))
}))
r.get('/dept/:id/students', asyncH(async (req, res) => { deptGuard(req, req.params.id); res.json(await D.studentLookup(req.actor, req.params.id, String(req.query.q ?? ''))) }))
r.get('/dept/:id/audit-export', asyncH(async (req, res) => { deptGuard(req, req.params.id); const b = await D.listBatches(req.actor, req.params.id, { limit: 500 }); res.type('text/csv').attachment('department-audit.csv').send(['batch,program,advisor,class_size,crs,relay_status,channel_permission', ...b.items.map((x) => [x.code, x.program, x.advisor?.name ?? '', x.classSize, x.crs.map((c) => c.name).join('|'), x.relayStatus, x.channelPermission].join(','))].join('\n')) }))
export default r
