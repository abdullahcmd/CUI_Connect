import { org } from '../services/org.js'
import { teachesBatch } from '../services/actors.js'
import {
  has, hasAny, holds, holdsUnder, isCR, isStudent, isStaff, deptIdOf, crBatchIds, LEADERS,
} from './roles.js'
import { strId } from '../lib/util.js'

const sameBatch = (a, b) => a.batchId && a.batchId === b.batchId
const sameDept = (a, b) => deptIdOf(a) && deptIdOf(a) === deptIdOf(b)
const deptLead = (a, deptId) => ['HOD', 'PROGRAM_INCHARGE', 'COORDINATOR'].some((r) => holds(a, r, deptId))
const SA = ['SA_HEAD', 'SA_OFFICER']
const OFFICE = ['LIBRARIAN', 'LIBRARY_STAFF', 'CAFE_MANAGER', 'CAFE_STAFF']

/**
 * One entry per row of the DM table (screens-flows §6.3). First match wins.
 * `when(sender, target, ctx)` may be async. ctx.crOf(batchId) -> CR actor names for route hints.
 */
export const DM_RULES = [
  { name: 'super-admin', when: (s, t) => has(s, 'SUPER_ADMIN') && hasAny(t, ['ADMIN', 'SUPER_ADMIN']) },
  { name: 'to-super-admin', when: (s, t) => has(t, 'SUPER_ADMIN') && has(s, 'ADMIN') },
  { name: 'office-silent', deny: true, when: (s) => hasAny(s, OFFICE) && !hasAny(s, ['ADMIN']) },
  { name: 'classmates', when: (s, t) => isStudent(s) && isStudent(t) && sameBatch(s, t) },
  { name: 'student-own-cr', when: (s, t) => isStudent(s) && isCR(t) && sameBatch(s, t) },
  { name: 'cr-teacher', when: async (s, t) => isCR(s) && isStaff(t) && has(t, 'TEACHER') && (await Promise.all(crBatchIds(s).map((b) => teachesBatch(t.id, b)))).some(Boolean) },
  { name: 'cr-coordinator', when: (s, t) => isCR(s) && has(t, 'COORDINATOR') && holds(t, 'COORDINATOR', deptIdOf(s)) },
  { name: 'teacher-cr', when: async (s, t) => has(s, 'TEACHER') && isCR(t) && (await Promise.all(crBatchIds(t).map((b) => teachesBatch(s.id, b)))).some(Boolean) },
  { name: 'dept-lead-to-cr', when: (s, t) => isCR(t) && deptLead(s, deptIdOf(t)) },
  { name: 'sa-staff', when: (s, t) => hasAny(s, SA) && isStaff(t) },
  { name: 'coordinators', when: (s, t) => has(s, 'COORDINATOR') && hasAny(t, ['COORDINATOR', 'ADMIN']) },
  { name: 'dept-staff', when: (s, t) => isStaff(s) && isStaff(t) && sameDept(s, t) && !hasAny(t, OFFICE) },
  { name: 'leadership', when: (s, t) => hasAny(s, LEADERS) && hasAny(t, LEADERS) },
  { name: 'admin-staff', when: (s, t) => hasAny(s, ['ADMIN', 'CAMPUS_INCHARGE']) && isStaff(t) && !hasAny(t, OFFICE) },
  { name: 'dept-lead-staff', when: (s, t) => isStaff(t) && hasAny(s, ['HOD', 'PROGRAM_INCHARGE']) && sameDept(s, t) },
]

/** Where to send a refused DM instead (design: "Teachers reach your class through your CR. Message Hamza (CR) →"). */
export async function routeFor(s, t, ctx) {
  const crNames = async (batchId) => ctx?.crOf ? ctx.crOf(batchId) : []
  if (isStudent(s) && isStaff(t)) {
    if (has(t, 'TEACHER')) {
      const crs = await crNames(s.batchId)
      return { type: 'CR', message: crs[0] ? `Teachers reach your class through your CR. Message ${crs[0].name} (CR) →` : 'Teachers reach your class through the CR line. Ask your coordinator to appoint a CR.', userId: crs[0]?.id }
    }
    if (hasAny(t, ['HOD', 'COORDINATOR', 'PROGRAM_INCHARGE'])) return { type: 'DESK', deskSlug: 'cs-coordinator', message: 'Coordinators and the HOD reach students through your CR or the Coordinator Desk. Open the CS Coordinator Desk →' }
    if (hasAny(t, [...SA, ...OFFICE])) return { type: 'DESK', deskSlug: 'student-affairs', message: 'Raise a ticket at the Student Affairs Desk and an officer will reply inside it.' }
    return { type: 'DESK', deskSlug: 'student-affairs', message: 'Use the Student Affairs Desk for official matters.' }
  }
  if (isStudent(s) && isStudent(t)) return { type: 'NONE', message: "Students message classmates in their own batch only. Fall and Spring batches don't mix." }
  if (isStaff(s) && isStudent(t)) {
    if (has(s, 'TEACHER') || hasAny(s, ['COORDINATOR', 'HOD', 'PROGRAM_INCHARGE'])) return { type: 'CR_LINE', message: 'Reach students through the CR line of their batch.' }
    if (hasAny(s, SA)) return { type: 'DESK', deskSlug: 'student-affairs', message: 'Student Affairs reaches students inside a desk ticket only.' }
    return { type: 'NONE', message: 'Staff reach students through the CR line, an announcement or a desk ticket.' }
  }
  if (hasAny(s, OFFICE)) return { type: 'NONE', message: 'Library and Cafe staff reply inside desk tickets only.' }
  return { type: 'NONE', message: "Direct messages aren't allowed between these roles." }
}

export async function canDM(sender, target, ctx) {
  if (sender.id === target.id) return { allow: false, code: 'FORBIDDEN_DM', meta: { reason: 'self' } }
  if (['SUSPENDED', 'INACTIVE'].includes(target.status)) return { allow: false, code: 'FORBIDDEN_DM', meta: { reason: 'suspended', route: { type: 'NONE', message: "This person's account is not active." } } }
  if (target.blocked?.includes(sender.id) || sender.blocked?.includes(target.id)) return { allow: false, code: 'FORBIDDEN_DM', meta: { reason: 'blocked', route: { type: 'NONE', message: "You can't message this person." } } }
  for (const r of DM_RULES) {
    if (await r.when(sender, target, ctx)) {
      return r.deny ? { allow: false, code: 'FORBIDDEN_DM', meta: { rule: r.name, route: await routeFor(sender, target, ctx) } } : { allow: true, meta: { rule: r.name } }
    }
  }
  return { allow: false, code: 'FORBIDDEN_DM', meta: { route: await routeFor(sender, target, ctx) } }
}
