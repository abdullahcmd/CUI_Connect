import { User, RoleAssignment, Term, CourseOffering } from '../models/index.js'
import { org } from './org.js'
import { strId, initials } from '../lib/util.js'
import { badgesOf, deptIdOf, roleLabel } from '../policy/roles.js'

const activeNow = () => { const n = new Date(); return { $or: [{ to: null }, { to: { $exists: false } }, { to: { $gt: n } }], from: { $lte: n } } }

function shape(u, assignments) {
  const roles = assignments.map((a) => ({ id: String(a._id), role: a.role, orgUnitId: String(a.orgUnitId), flags: a.flags ?? {}, from: a.from, to: a.to }))
  // every student implicitly holds STUDENT at their batch
  if (u.kind === 'STUDENT' && u.batchId && !roles.some((r) => r.role === 'STUDENT')) roles.push({ role: 'STUDENT', orgUnitId: String(u.batchId), flags: {} })
  return {
    _id: u._id, id: String(u._id), uid: u.uid, name: u.name, email: u.email, kind: u.kind, status: u.status,
    batchId: u.batchId ? String(u.batchId) : null, departmentId: u.departmentId ? String(u.departmentId) : null,
    designation: u.designation, cabin: u.cabin, semester: u.semester, blocked: (u.blocked ?? []).map(String), roles,
    settings: u.settings, mustChangePassword: u.mustChangePassword, lastSeenAt: u.lastSeenAt,
  }
}

export async function loadActor(userId) {
  const u = await User.findById(userId).lean()
  if (!u) return null
  const as = await RoleAssignment.find({ userId: u._id, ...activeNow() }).lean()
  return shape(u, as)
}

export async function loadActors(ids) {
  const users = await User.find({ _id: { $in: ids } }).lean()
  const as = await RoleAssignment.find({ userId: { $in: ids }, ...activeNow() }).lean()
  const byUser = new Map()
  for (const a of as) (byUser.get(String(a.userId)) ?? byUser.set(String(a.userId), []).get(String(a.userId))).push(a)
  return users.map((u) => shape(u, byUser.get(String(u._id)) ?? []))
}

/** Every user with their roles (demo scale: a few hundred). Used by membership sync and directory queries. */
export async function loadAllActors() {
  const users = await User.find().lean()
  const as = await RoleAssignment.find(activeNow()).lean()
  const byUser = new Map()
  for (const a of as) (byUser.get(String(a.userId)) ?? byUser.set(String(a.userId), []).get(String(a.userId))).push(a)
  return users.map((u) => shape(u, byUser.get(String(u._id)) ?? []))
}

// ---- current-term teaching map: teacherId -> Set(batchId)
let teaching = null
export const invalidateTeaching = () => { teaching = null }
export async function currentTerm() { return Term.findOne({ current: true }).lean() }

export async function teachingMap() {
  if (teaching) return teaching
  const term = await currentTerm()
  const m = new Map()
  if (term) {
    const offs = await CourseOffering.find({ termId: term._id }).lean()
    for (const o of offs) {
      const k = String(o.teacherId)
      if (!m.has(k)) m.set(k, new Set())
      m.get(k).add(String(o.batchId))
    }
  }
  teaching = m
  return m
}
export async function teachesBatch(teacherId, batchId) { return (await teachingMap()).get(strId(teacherId))?.has(strId(batchId)) ?? false }

/** Short public card shown beside messages and in pickers. */
export function publicCard(a) {
  const dept = org.get(deptIdOf(a))
  const batch = a.batchId ? org.get(a.batchId) : null
  return {
    id: a.id, uid: a.uid, name: a.name, initials: initials(a.name), kind: a.kind, status: a.status,
    badges: badgesOf(a), designation: a.designation, dept: dept?.code, batch: batch?.code, cabin: a.cabin,
    roles: [...new Set(a.roles.map((r) => roleLabel(r.role)))],
  }
}
