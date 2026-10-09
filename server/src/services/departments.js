import { OrgUnit, User, RoleAssignment, Group, Membership, Desk, Channel, Announcement, Ticket, CourseOffering, Term, Setting } from '../models/index.js'
import { org, createOrg, loadOrg } from './org.js'
import { loadActors, loadAllActors, loadActor, invalidateTeaching, currentTerm, publicCard } from './actors.js'
import { has, hasAny, holds, deptIdOf, roleLabel } from '../policy/roles.js'
import { AppError } from '../lib/errors.js'
import { strId, uniq, parseReg, sha256 } from '../lib/util.js'
import { audit } from '../lib/audit.js'
import { notify, notifyMany } from '../lib/notify.js'
import { assignRole } from './users.js'
import { createDeptGroups, createBatchGroups, resync, archiveBatchGroups } from './groups.js'
import { refreshUserRooms } from '../sockets/rooms.js'
import { toGroup, toUser } from '../lib/realtime.js'
import { autoFollow } from './channels.js'

// ---------- department wizard (ADM-03) ----------
export function assertCompleteHierarchy(d) {
  const missing = []
  if (!d.hodId) missing.push('hod')
  if (!d.programs?.length || d.programs.some((p) => !p.programInchargeId)) missing.push('programIncharges')
  if (!d.coordinatorIds?.length) missing.push('coordinators')
  if (missing.length) throw new AppError('INCOMPLETE_HIERARCHY', 422, { missing })
}

export async function createDepartment(actor, d) {
  assertCompleteHierarchy(d)
  const code = String(d.code ?? '').trim().toUpperCase()
  if (!d.name || !code) throw new AppError('VALIDATION_FAILED', 422, { fields: ['name', 'code'] })
  if (org.byCode(code)) throw new AppError('CONFLICT', 409, { reason: 'Department code already exists.' })
  const progCodes = d.programs.map((p) => String(p.code).toUpperCase())
  if (new Set(progCodes).size !== progCodes.length || progCodes.some((c) => org.byCode(c))) throw new AppError('CONFLICT', 409, { reason: 'Program codes must be unique.' })
  if (await RoleAssignment.findOne({ userId: d.hodId, role: 'HOD', to: null })) throw new AppError('CONFLICT', 409, { reason: 'This person is already HOD of another department.' })
  const need = uniq([d.hodId, ...d.programs.map((p) => p.programInchargeId), ...d.coordinatorIds, ...(d.teacherIds ?? [])])
  const found = await User.countDocuments({ _id: { $in: need }, kind: 'STAFF' })
  if (found !== need.length) throw new AppError('VALIDATION_FAILED', 422, { reason: 'Every HOD, Program Incharge, coordinator and teacher must be an existing staff account.' })
  const campus = org.campus()
  const dept = await createOrg({ type: 'DEPARTMENT', code, name: d.name, parentId: campus._id })
  const progs = []
  for (const p of d.programs) progs.push(await createOrg({ type: 'PROGRAM', code: String(p.code).toUpperCase(), name: p.name, parentId: dept._id }))
  await assignRole(actor, { userId: d.hodId, role: 'HOD', orgUnitId: dept._id }, { bypass: true })
  for (let i = 0; i < progs.length; i++) await assignRole(actor, { userId: d.programs[i].programInchargeId, role: 'PROGRAM_INCHARGE', orgUnitId: progs[i]._id }, { bypass: true })
  for (const c of d.coordinatorIds) await assignRole(actor, { userId: c, role: 'COORDINATOR', orgUnitId: dept._id }, { bypass: true })
  for (const t of d.teacherIds ?? []) await assignRole(actor, { userId: t, role: 'TEACHER', orgUnitId: dept._id }, { bypass: true })
  await User.updateMany({ _id: { $in: need }, $or: [{ departmentId: null }, { departmentId: { $exists: false } }] }, { departmentId: dept._id })
  const desk = await Desk.create({
    slug: `${code.toLowerCase()}-coordinator`, name: `${code} Coordinator Desk`, prefix: 'CD', kind: 'COORDINATOR', orgUnitId: dept._id, description: `Requests to the ${d.name} coordinators.`,
    categories: ['Attendance', 'Timetable', 'Course registration', 'Result query', 'Other'], headIds: [d.hodId],
    chain: [{ level: 1, label: 'Coordinator', role: 'COORDINATOR', scope: 'DESK_ORG' }, { level: 2, label: 'Program Incharge', role: 'PROGRAM_INCHARGE', scope: 'PROGRAM_OF_REQUESTER' }, { level: 3, label: 'HOD', role: 'HOD', scope: 'DESK_ORG' }],
    hours: 'Mon–Fri 09:00 – 15:30', targetReplyHours: 48,
  })
  await Channel.create({ slug: `${code.toLowerCase()}-events`, code: `CH-${code}-EVT`, name: `${code} Events`, initials: code.slice(0, 2), kind: 'DEPARTMENT', description: `Events and seminars of ${d.name}.`, scopeOrgId: dept._id, ownerLabel: `${d.name}`, joinMode: 'AUTO_MUTE', tag: 'DEPARTMENT', deskSlug: desk.slug, audienceLabel: code })
  await createDeptGroups(dept)
  await resync()
  await Promise.all(need.map((id) => refreshUserRooms(id)))
  await notifyMany(need, { type: 'role', title: `You were appointed in the new ${d.name} department`, mutable: false })
  await audit(actor, 'department.create', { category: 'structure', target: { kind: 'department', id: String(dept._id), label: dept.code }, after: { hod: d.hodId, programs: progCodes, coordinators: d.coordinatorIds } })
  return departmentDetail(dept._id)
}

export async function listDepartments() {
  const depts = org.ofType('DEPARTMENT')
  const roles = await RoleAssignment.find({ to: null, role: { $in: ['HOD', 'COORDINATOR', 'PROGRAM_INCHARGE'] } }).lean()
  const users = new Map((await loadActors(uniq(roles.map((r) => r.userId)))).map((u) => [u.id, u]))
  const out = []
  for (const d of depts) {
    const sub = org.subtree(d._id)
    const hodRow = roles.find((r) => r.role === 'HOD' && strId(r.orgUnitId) === String(d._id))
    const batches = org.ofType('BATCH').filter((b) => sub.includes(String(b._id)) && b.status === 'ACTIVE')
    const students = await User.countDocuments({ batchId: { $in: batches.map((b) => b._id) }, status: { $ne: 'INACTIVE' } })
    const staff = await User.countDocuments({ departmentId: d._id, kind: 'STAFF' })
    out.push({
      id: String(d._id), code: d.code, name: d.name, status: d.status, hod: hodRow && users.get(String(hodRow.userId)) ? { id: String(hodRow.userId), name: users.get(String(hodRow.userId)).name } : null,
      programs: org.children(d._id).filter((p) => p.type === 'PROGRAM').map((p) => ({ id: String(p._id), code: p.code, name: p.name })), batchCount: batches.length, students, staff,
      coordinators: roles.filter((r) => r.role === 'COORDINATOR' && strId(r.orgUnitId) === String(d._id)).length,
    })
  }
  return out
}

export async function departmentDetail(id) {
  const d = org.get(id)
  if (!d || d.type !== 'DEPARTMENT') throw new AppError('NOT_FOUND', 404)
  const sub = org.subtree(d._id)
  const roles = await RoleAssignment.find({ to: null, orgUnitId: { $in: sub }, role: { $in: ['HOD', 'COORDINATOR', 'PROGRAM_INCHARGE', 'TEACHER'] } }).lean()
  const actors = new Map((await loadActors(uniq(roles.map((r) => r.userId)))).map((a) => [a.id, a]))
  const pick = (r) => ({ assignmentId: String(r._id), ...publicCard(actors.get(String(r.userId))), orgUnit: org.get(r.orgUnitId)?.code })
  const programs = org.children(d._id).filter((p) => p.type === 'PROGRAM')
  const batches = org.ofType('BATCH').filter((b) => sub.includes(String(b._id)))
  return {
    id: String(d._id), code: d.code, name: d.name, status: d.status,
    hod: roles.filter((r) => r.role === 'HOD').map(pick)[0] ?? null,
    coordinators: roles.filter((r) => r.role === 'COORDINATOR').map(pick),
    programs: programs.map((p) => ({ id: String(p._id), code: p.code, name: p.name, programIncharge: roles.filter((r) => r.role === 'PROGRAM_INCHARGE' && strId(r.orgUnitId) === String(p._id)).map(pick)[0] ?? null, batches: batches.filter((b) => strId(b.programId ?? b.parentId) === String(p._id) && b.status === 'ACTIVE').length })),
    teachers: roles.filter((r) => r.role === 'TEACHER').map(pick), activeBatches: batches.filter((b) => b.status === 'ACTIVE').length,
  }
}

export async function updateDepartment(actor, id, patch) {
  const d = org.get(id)
  if (!d) throw new AppError('NOT_FOUND', 404)
  if (patch.name) await OrgUnit.updateOne({ _id: id }, { name: patch.name })
  if (patch.addProgram) {
    const code = String(patch.addProgram.code).toUpperCase()
    if (org.byCode(code)) throw new AppError('CONFLICT', 409)
    if (!patch.addProgram.programInchargeId) throw new AppError('INCOMPLETE_HIERARCHY', 422, { missing: ['programIncharges'] })
    const prog = await createOrg({ type: 'PROGRAM', code, name: patch.addProgram.name, parentId: id })
    await assignRole(actor, { userId: patch.addProgram.programInchargeId, role: 'PROGRAM_INCHARGE', orgUnitId: prog._id }, { bypass: true })
  }
  if (patch.hodId) await assignRole(actor, { userId: patch.hodId, role: 'HOD', orgUnitId: id })
  if (patch.programIncharge) await assignRole(actor, { userId: patch.programIncharge.userId, role: 'PROGRAM_INCHARGE', orgUnitId: patch.programIncharge.programId })
  if (patch.addCoordinatorId) await assignRole(actor, { userId: patch.addCoordinatorId, role: 'COORDINATOR', orgUnitId: id })
  await loadOrg(); await resync()
  await audit(actor, 'department.update', { category: 'structure', target: { kind: 'department', id, label: d.code }, after: patch })
  return departmentDetail(id)
}

export async function archiveDepartment(actor, id) {
  const d = org.get(id)
  const active = org.ofType('BATCH').filter((b) => org.isWithin(b._id, id) && b.status === 'ACTIVE')
  if (active.length) throw new AppError('CONFLICT', 409, { reason: `Archive or move ${active.length} active batches first.`, count: active.length })
  await OrgUnit.updateMany({ _id: { $in: org.subtree(id) } }, { status: 'ARCHIVED' })
  await Group.updateMany({ orgUnitId: { $in: org.subtree(id) } }, { archived: true })
  await loadOrg(); await resync()
  await audit(actor, 'department.archive', { category: 'structure', target: { kind: 'department', id, label: d.code } })
  return { ok: true }
}

// ---------- batches (DEP-02/03/04/05) ----------
const guardDept = (actor, deptId) => {
  if (hasAny(actor, ['ADMIN', 'SUPER_ADMIN'])) return
  if (holds(actor, 'COORDINATOR', deptId) || holds(actor, 'HOD', deptId)) return
  throw new AppError('DEPARTMENT_BOUNDARY', 403)
}

export function batchCode(intake, year, programCode) { return `${intake}${String(year).slice(-2)}-${programCode}` }

export async function createBatch(actor, { programId, programCode, intake, year, section }) {
  const prog = programId ? org.get(programId) : org.byCode(programCode)
  if (!prog || prog.type !== 'PROGRAM') throw new AppError('NOT_FOUND', 404, { reason: 'Program not found.' })
  const dept = org.departmentOf(prog._id)
  guardDept(actor, dept._id)
  if (!['FA', 'SP'].includes(intake) || !year) throw new AppError('VALIDATION_FAILED', 422)
  const code = batchCode(intake, year, prog.code)
  if (org.byCode(code)) throw new AppError('CONFLICT', 409, { reason: 'Duplicate batch code.', code })
  const b = await createOrg({ type: 'BATCH', code, name: `${prog.code} ${intake === 'FA' ? 'Fall' : 'Spring'} ${year}`, parentId: prog._id, intake, year: Number(year), programId: prog._id, section, expectedGraduation: `${intake === 'FA' ? 'SP' : 'FA'}${String(Number(year) + 4).slice(-2)}` })
  await createBatchGroups(b)
  await resync()
  await audit(actor, 'batch.create', { category: 'structure', target: { kind: 'batch', id: String(b._id), label: code } })
  return { id: String(b._id), code }
}

export const previewBatchCode = (p) => { const prog = p.programId ? org.get(p.programId) : org.byCode(p.programCode); return { code: prog ? batchCode(p.intake, p.year, prog.code) : null, exists: prog ? !!org.byCode(batchCode(p.intake, p.year, prog.code)) : false } }

export async function listBatches(actor, deptId, { status = 'ACTIVE', q, page = 1, limit = 20 } = {}) {
  const dept = org.get(deptId)
  const sub = new Set(org.subtree(deptId))
  let batches = org.ofType('BATCH').filter((b) => sub.has(String(b._id)) && b.status === status)
  if (q) batches = batches.filter((b) => b.code.toLowerCase().includes(q.toLowerCase()))
  const crRows = await RoleAssignment.find({ role: 'CR', to: null, orgUnitId: { $in: batches.map((b) => b._id) } }).lean()
  const crActors = new Map((await loadActors(uniq(crRows.map((r) => r.userId)))).map((a) => [a.id, a]))
  const advisors = new Map((await loadActors(uniq(batches.map((b) => b.advisorId).filter(Boolean)))).map((a) => [a.id, a]))
  const classGroups = await Group.find({ template: 'CLASS', orgUnitId: { $in: batches.map((b) => b._id) } }).lean()
  const gmap = new Map(classGroups.map((g) => [String(g.orgUnitId), g]))
  const sizes = await User.aggregate([{ $match: { batchId: { $in: batches.map((b) => b._id) }, status: { $ne: 'INACTIVE' } } }, { $group: { _id: '$batchId', n: { $sum: 1 } } }])
  const sm = new Map(sizes.map((s) => [String(s._id), s.n]))
  const rows = batches.sort((a, b) => b.year - a.year || a.code.localeCompare(b.code)).map((b) => {
    const crs = crRows.filter((r) => strId(r.orgUnitId) === String(b._id)).map((r) => crActors.get(String(r.userId))).filter(Boolean)
    const g = gmap.get(String(b._id))
    return {
      id: String(b._id), code: b.code, section: b.section, program: org.get(b.programId)?.code, intake: b.intake, year: b.year, dept: dept.code,
      advisor: advisors.get(strId(b.advisorId)) ? { id: strId(b.advisorId), name: advisors.get(strId(b.advisorId)).name, designation: advisors.get(strId(b.advisorId)).designation } : null,
      crs: crs.map((c) => ({ id: c.id, name: c.name, uid: c.uid, initials: publicCard(c).initials })), classSize: sm.get(String(b._id)) ?? 0,
      relayStatus: crs.length ? 'SYNCHRONIZED' : 'PENDING ELECTION', channelPermission: g?.announceOnly ? 'Announce-Only' : 'Open Discussion', classGroupId: g ? String(g._id) : undefined, expectedGraduation: b.expectedGraduation,
    }
  })
  return { items: rows.slice((page - 1) * limit, page * limit), total: rows.length, page, pages: Math.max(1, Math.ceil(rows.length / limit)) }
}

export async function batchDetail(actor, batchId) {
  const b = org.get(batchId)
  if (!b || b.type !== 'BATCH') throw new AppError('NOT_FOUND', 404)
  const dept = org.departmentOf(batchId)
  if (!hasAny(actor, ['ADMIN', 'SUPER_ADMIN']) && !(holds(actor, 'HOD', dept._id) || holds(actor, 'COORDINATOR', dept._id) || holds(actor, 'PROGRAM_INCHARGE', org.programOf(batchId)._id))) throw new AppError('DEPARTMENT_BOUNDARY', 403)
  const students = await loadActors((await User.find({ batchId, status: { $ne: 'INACTIVE' } }, '_id').lean()).map((u) => u._id))
  const crIds = new Set(students.filter((s) => s.roles.some((r) => r.role === 'CR' && strId(r.orgUnitId) === strId(batchId))).map((s) => s.id))
  const [cls, crl] = await Promise.all([Group.findOne({ template: 'CLASS', orgUnitId: batchId }).lean(), Group.findOne({ template: 'CR_LINE', orgUnitId: batchId }).lean()])
  const term = await currentTerm()
  const offs = term ? await CourseOffering.find({ termId: term._id, batchId }).lean() : []
  const teachers = new Map((await loadActors(uniq(offs.map((o) => o.teacherId)))).map((t) => [t.id, t]))
  return {
    batch: { id: String(b._id), code: b.code, section: b.section, program: org.get(b.programId)?.code, dept: dept.code, status: b.status, expectedGraduation: b.expectedGraduation },
    students: students.sort((a, b2) => a.uid.localeCompare(b2.uid)).map((s) => ({ ...publicCard(s), isCR: crIds.has(s.id), semester: s.semester })), crs: students.filter((s) => crIds.has(s.id)).map((s) => publicCard(s)),
    classGroup: cls ? { id: String(cls._id), name: cls.name, announceOnly: cls.announceOnly } : null, crLine: crl ? { id: String(crl._id), name: crl.name } : null,
    offerings: offs.map((o) => ({ id: String(o._id), courseCode: o.courseCode, title: o.title, teacher: teachers.get(String(o.teacherId)) ? publicCard(teachers.get(String(o.teacherId))) : null })),
  }
}

export async function assignCRs(actor, batchId, studentIds) {
  const b = org.get(batchId)
  const dept = org.departmentOf(batchId)
  guardDept(actor, dept._id)
  if (studentIds.length < 1 || studentIds.length > 2) throw new AppError('VALIDATION_FAILED', 422, { reason: 'Pick one or two students.' })
  const students = await loadActors(studentIds)
  for (const s of students) {
    if (s.batchId !== strId(batchId)) throw new AppError('VALIDATION_FAILED', 422, { reason: `${s.name} isn't in ${b.code}.` })
    if (s.status !== 'ACTIVE') throw new AppError('VALIDATION_FAILED', 422, { reason: `${s.name}'s account is ${s.status.toLowerCase()}.` })
  }
  const current = await RoleAssignment.find({ role: 'CR', orgUnitId: batchId, to: null }).lean()
  const keep = new Set(studentIds.map(String))
  const removed = current.filter((c) => !keep.has(String(c.userId)))
  if (removed.length) await RoleAssignment.updateMany({ _id: { $in: removed.map((r) => r._id) } }, { to: new Date() })
  for (const id of studentIds) if (!current.some((c) => String(c.userId) === String(id))) await assignRole(actor, { userId: id, role: 'CR', orgUnitId: batchId }, { bypass: false })
  invalidateTeaching(); await resync()
  const all = [...removed.map((r) => String(r.userId)), ...studentIds]
  await Promise.all(all.map((u) => refreshUserRooms(u)))
  for (const r of removed) notify(r.userId, { type: 'role', title: `You are no longer CR of ${b.code}`, mutable: false })
  const batchUsers = await User.find({ batchId }, '_id').lean()
  await notifyMany(batchUsers.map((u) => u._id), { type: 'role', title: `${students.map((s) => s.name).join(' and ')} ${students.length > 1 ? 'are' : 'is'} now CR of ${b.code}`, mutable: false })
  const cls = await Group.findOne({ template: 'CLASS', orgUnitId: batchId }).lean()
  if (cls) toGroup(cls._id, 'group:changed', { groupId: String(cls._id), crs: students.map((s) => ({ id: s.id, name: s.name })) })
  await audit(actor, 'batch.assign-cr', { category: 'structure', target: { kind: 'batch', id: String(batchId), label: b.code }, meta: { crs: students.map((s) => s.uid) } })
  return { ok: true, crs: students.map((s) => publicCard(s)) }
}

export async function setBatchPermission(actor, batchId, { announceOnly, advisorId }) {
  const dept = org.departmentOf(batchId)
  guardDept(actor, dept._id)
  if (announceOnly !== undefined) {
    const g = await Group.findOneAndUpdate({ template: 'CLASS', orgUnitId: batchId }, { announceOnly }, { new: true })
    if (g) toGroup(g._id, 'group:changed', { groupId: String(g._id), announceOnly })
  }
  if (advisorId !== undefined) { await OrgUnit.updateOne({ _id: batchId }, { advisorId }); await loadOrg() }
  return { ok: true }
}

// ---------- offerings (DEP-06) ----------
export async function listOfferings(actor, deptId, termCode) {
  const term = termCode ? await Term.findOne({ code: termCode }).lean() : await currentTerm()
  if (!term) throw new AppError('NOT_FOUND', 404)
  const sub = new Set(org.subtree(deptId))
  const batches = org.ofType('BATCH').filter((b) => sub.has(String(b._id)) && b.status === 'ACTIVE')
  const offs = await CourseOffering.find({ termId: term._id, batchId: { $in: batches.map((b) => b._id) } }).lean()
  const teachers = new Map((await loadActors(uniq(offs.map((o) => o.teacherId)))).map((t) => [t.id, t]))
  const deptTeachers = (await loadAllActors()).filter((a) => a.roles.some((r) => r.role === 'TEACHER' && org.isWithin(r.orgUnitId, deptId)))
  return {
    term: { code: term.code, current: term.current },
    rows: offs.map((o) => ({ id: String(o._id), courseCode: o.courseCode, title: o.title, creditHours: o.creditHours, room: o.room, slot: o.slot, batch: org.get(o.batchId)?.code, batchId: String(o.batchId), teacher: teachers.get(String(o.teacherId)) ? { ...publicCard(teachers.get(String(o.teacherId))) } : null })).sort((a, b) => a.batch.localeCompare(b.batch) || a.courseCode.localeCompare(b.courseCode)),
    batches: batches.map((b) => ({ id: String(b._id), code: b.code, offerings: offs.filter((o) => strId(o.batchId) === String(b._id)).length })),
    teachers: deptTeachers.map((t) => ({ ...publicCard(t), load: offs.filter((o) => strId(o.teacherId) === t.id).length })),
  }
}

async function checkOffering(actor, { batchId, teacherId }) {
  const b = org.get(batchId)
  if (!b || b.type !== 'BATCH' || b.status !== 'ACTIVE') throw new AppError('VALIDATION_FAILED', 422, { reason: 'Batch must be active.' })
  const dept = org.departmentOf(batchId)
  guardDept(actor, dept._id)
  const t = await loadActor(teacherId)
  if (!t || !t.roles.some((r) => r.role === 'TEACHER' && org.isWithin(r.orgUnitId, dept._id))) throw new AppError('TEACHER_NOT_ASSIGNED', 422, { reason: `${t?.name ?? 'This person'} isn't a teacher in ${dept.code}. Add them as a teacher first.` })
  return { b, dept, t }
}

export async function upsertOffering(actor, termCode, p) {
  const term = await Term.findOne({ code: termCode }).lean()
  if (!term) throw new AppError('NOT_FOUND', 404)
  const batchId = p.batchId ?? org.byCode(p.batchCode)?._id
  const { b, t } = await checkOffering(actor, { batchId, teacherId: p.teacherId })
  const doc = p.id ? await CourseOffering.findByIdAndUpdate(p.id, { courseCode: p.courseCode, title: p.title, batchId, teacherId: p.teacherId, room: p.room, slot: p.slot, creditHours: p.creditHours }, { new: true })
    : await CourseOffering.create({ termId: term._id, courseCode: p.courseCode, title: p.title, batchId, teacherId: p.teacherId, room: p.room, slot: p.slot, creditHours: p.creditHours })
  invalidateTeaching()
  await resync()
  notify(p.teacherId, { type: 'role', title: `You now teach ${p.courseCode} to ${b.code}`, body: 'The CR line for this batch is now in your sidebar.', mutable: false })
  await audit(actor, 'offering.save', { category: 'structure', target: { kind: 'offering', id: String(doc._id), label: `${p.courseCode} ${b.code}` } })
  return { id: String(doc._id) }
}

export async function deleteOffering(actor, id) {
  const o = await CourseOffering.findById(id)
  if (!o) throw new AppError('NOT_FOUND', 404)
  guardDept(actor, org.departmentOf(o.batchId)._id)
  await o.deleteOne(); invalidateTeaching(); await resync()
  return { ok: true }
}

export async function importOfferings(actor, termCode, rows) {
  const results = []
  for (const [i, r] of rows.entries()) {
    try {
      const teacher = await User.findOne({ uid: String(r.teacher ?? r.teacheruid ?? '').toUpperCase() }).lean()
      if (!teacher) throw new AppError('NOT_FOUND', 404, { reason: 'Teacher not found.' })
      await upsertOffering(actor, termCode, { courseCode: r.coursecode ?? r.courseCode, title: r.title, batchCode: r.batch ?? r.batchcode, teacherId: teacher._id })
      results.push({ row: i + 2, ok: true })
    } catch (e) { results.push({ row: i + 2, ok: false, error: e.meta?.reason ?? e.code ?? e.message }) }
  }
  return { imported: results.filter((r) => r.ok).length, errors: results.filter((r) => !r.ok) }
}

/** HOD/coordinator dashboard (DEP-01, HOD governance screen). */
export async function deptDashboard(actor, deptId) {
  const dept = org.get(deptId)
  if (!dept) throw new AppError('NOT_FOUND', 404)
  if (!hasAny(actor, ['ADMIN', 'SUPER_ADMIN']) && !['HOD', 'COORDINATOR', 'PROGRAM_INCHARGE'].some((r) => holds(actor, r, deptId))) throw new AppError('DEPARTMENT_BOUNDARY', 403)
  const sub = new Set(org.subtree(deptId))
  const batches = org.ofType('BATCH').filter((b) => sub.has(String(b._id)) && b.status === 'ACTIVE')
  const students = await User.countDocuments({ batchId: { $in: batches.map((b) => b._id) }, status: { $ne: 'INACTIVE' } })
  const term = await currentTerm()
  const offs = term ? await CourseOffering.find({ termId: term._id, batchId: { $in: batches.map((b) => b._id) } }).lean() : []
  const instructors = uniq(offs.map((o) => o.teacherId)).length
  const teachersTotal = await User.countDocuments({ departmentId: deptId, kind: 'STAFF' })
  const crRows = await RoleAssignment.find({ role: 'CR', to: null, orgUnitId: { $in: batches.map((b) => b._id) } }).lean()
  const withCr = new Set(crRows.map((r) => String(r.orgUnitId)))
  const desk = await Desk.findOne({ kind: 'COORDINATOR', orgUnitId: deptId }).lean()
  const tickets = desk ? await Ticket.find({ deskId: desk._id }).lean() : []
  const resolved = tickets.filter((t) => ['RESOLVED', 'CLOSED'].includes(t.status)).length
  const posts = await Announcement.find({ scopeId: { $in: [...sub] }, status: 'PUBLISHED' }).sort({ createdAt: -1 }).limit(5).lean()
  return {
    dept: { id: String(dept._id), code: dept.code, name: dept.name }, term: term?.code,
    kpis: {
      enrolledCohort: { batches: batches.length, students }, instructionalGrid: { instructors: instructors || teachersTotal, crLinesSynced: batches.filter((b) => withCr.has(String(b._id))).length, offerings: offs.length },
      deskSla: { resolutionRate: tickets.length ? Math.round((resolved / tickets.length) * 1000) / 10 : 100, openTickets: tickets.filter((t) => ['OPEN', 'IN_PROGRESS', 'ESCALATED'].includes(t.status)).length, deskSlug: desk?.slug },
      registrarGazette: { form: '44-B', status: 'Synchronized', cadence: 'Bi-weekly Academic Audit', at: '14:00 PKT' },
    },
    crGaps: batches.filter((b) => !withCr.has(String(b._id))).map((b) => ({ id: String(b._id), code: b.code })),
    latestPosts: posts.map((p) => ({ id: String(p._id), title: p.title, createdAt: p.createdAt, scope: org.get(p.scopeId)?.code })),
    isolation: { teacherCrRelay: 'ACTIVE' },
  }
}

export async function teachersOfDept(actor, deptId) {
  const actors = (await loadAllActors()).filter((a) => a.roles.some((r) => ['TEACHER', 'HOD', 'COORDINATOR', 'PROGRAM_INCHARGE'].includes(r.role) && org.isWithin(r.orgUnitId, deptId)))
  const term = await currentTerm()
  const offs = term ? await CourseOffering.find({ termId: term._id }).lean() : []
  return actors.map((a) => ({ ...publicCard(a), email: a.email, cabin: a.cabin, courses: offs.filter((o) => strId(o.teacherId) === a.id).map((o) => ({ courseCode: o.courseCode, batch: org.get(o.batchId)?.code })) })).sort((a, b) => a.name.localeCompare(b.name))
}

export async function studentLookup(actor, deptId, q) {
  const sub = org.subtree(deptId)
  const rx = new RegExp(String(q ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
  const users = await User.find({ kind: 'STUDENT', batchId: { $in: sub }, $or: [{ name: rx }, { uid: rx }] }).limit(30).lean()
  const actors = await loadActors(users.map((u) => u._id))
  const desk = await Desk.findOne({ kind: 'COORDINATOR', orgUnitId: deptId }).lean()
  const tickets = desk ? await Ticket.find({ deskId: desk._id, requesterId: { $in: users.map((u) => u._id) } }).lean() : []
  return actors.map((a) => ({ ...publicCard(a), semester: a.semester, tickets: tickets.filter((t) => strId(t.requesterId) === a.id).map((t) => ({ code: t.code, subject: t.subject, status: t.status })) }))
}
