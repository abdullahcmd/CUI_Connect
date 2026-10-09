import { org } from '../services/org.js'
import { strId } from '../lib/util.js'

export const RANK = {
  SUPER_ADMIN: 100, ADMIN: 90, CAMPUS_INCHARGE: 80, SA_HEAD: 70, HOD: 70, SA_OFFICER: 60, PROGRAM_INCHARGE: 60,
  COORDINATOR: 60, LIBRARIAN: 55, CAFE_MANAGER: 55, TEACHER: 50, LIBRARY_STAFF: 50, CAFE_STAFF: 50, PUBLISHER: 50,
  EXAM_OFFICER: 50, CR: 40, SOCIETY_LEAD: 40, STUDENT: 10,
}

export const STAFF_ROLES = ['SUPER_ADMIN', 'ADMIN', 'CAMPUS_INCHARGE', 'SA_HEAD', 'SA_OFFICER', 'HOD', 'PROGRAM_INCHARGE',
  'COORDINATOR', 'TEACHER', 'LIBRARIAN', 'LIBRARY_STAFF', 'CAFE_MANAGER', 'CAFE_STAFF', 'PUBLISHER', 'EXAM_OFFICER']
export const LEADERS = ['HOD', 'CAMPUS_INCHARGE', 'ADMIN', 'SA_HEAD', 'SUPER_ADMIN']

/** Roles unique per scope: assigning a new holder replaces the old one. */
export const UNIQUE_ROLES = ['HOD', 'PROGRAM_INCHARGE', 'CAMPUS_INCHARGE', 'SA_HEAD', 'LIBRARIAN', 'CAFE_MANAGER']

export const rankOf = (actor) => Math.max(0, ...(actor.roles ?? []).map((r) => RANK[r.role] ?? 0))
export const has = (actor, role) => (actor.roles ?? []).some((r) => r.role === role)
export const hasAny = (actor, roles) => roles.some((r) => has(actor, r))

/** Does the actor hold `role` at `orgId` or at an ancestor of it? (e.g. Admin at campus holds everywhere) */
export function holds(actor, role, orgId) {
  if (!orgId) return has(actor, role)
  return (actor.roles ?? []).some((r) => r.role === role && org.isWithin(orgId, r.orgUnitId))
}
export const holdsAny = (actor, roles, orgId) => roles.some((r) => holds(actor, r, orgId))
/** Does the actor hold `role` at exactly `orgId`? */
export const holdsAt = (actor, role, orgId) => (actor.roles ?? []).some((r) => r.role === role && strId(r.orgUnitId) === strId(orgId))
/** Does the actor hold `role` anywhere inside the subtree of `orgId`? (CRs sit at batches under a department) */
export const holdsUnder = (actor, role, orgId) => (actor.roles ?? []).some((r) => r.role === role && org.isWithin(r.orgUnitId, orgId))

export const isStudent = (a) => a.kind === 'STUDENT'
export const isStaff = (a) => a.kind === 'STAFF'
export const isCR = (a) => has(a, 'CR')
export const crBatchIds = (a) => (a.roles ?? []).filter((r) => r.role === 'CR').map((r) => strId(r.orgUnitId))

export function deptIdOf(actor) {
  if (actor.departmentId) return strId(actor.departmentId)
  if (actor.batchId) return strId(org.departmentOf(actor.batchId)?._id)
  const r = (actor.roles ?? []).find((x) => org.departmentOf(x.orgUnitId))
  return r ? strId(org.departmentOf(r.orgUnitId)._id) : null
}

export const roleLabel = (r) => ({
  SUPER_ADMIN: 'SUPER ADMIN', ADMIN: 'ADMIN OFFICE', CAMPUS_INCHARGE: 'CAMPUS INCHARGE', SA_HEAD: 'STUDENT AFFAIRS',
  SA_OFFICER: 'STUDENT AFFAIRS', HOD: 'HOD', PROGRAM_INCHARGE: 'PROGRAM INCHARGE', COORDINATOR: 'COORDINATOR',
  TEACHER: 'TEACHER', CR: 'CR', STUDENT: 'STUDENT', LIBRARIAN: 'LIBRARY', LIBRARY_STAFF: 'LIBRARY', CAFE_MANAGER: 'CAFE',
  CAFE_STAFF: 'CAFE', PUBLISHER: 'PUBLISHER', SOCIETY_LEAD: 'SOCIETY LEAD', EXAM_OFFICER: 'EXAM CELL',
}[r] ?? r)

/** Badges shown after a sender's name; students carry none. */
export function badgesOf(actor) {
  const order = ['SUPER_ADMIN', 'ADMIN', 'CAMPUS_INCHARGE', 'SA_HEAD', 'SA_OFFICER', 'HOD', 'PROGRAM_INCHARGE', 'COORDINATOR', 'EXAM_OFFICER',
    'LIBRARIAN', 'LIBRARY_STAFF', 'CAFE_MANAGER', 'CAFE_STAFF', 'TEACHER', 'CR', 'SOCIETY_LEAD']
  const out = []
  for (const r of order) if (has(actor, r)) out.push(roleLabel(r))
  return [...new Set(out)]
}
