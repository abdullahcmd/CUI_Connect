import { org } from '../services/org.js'
import { has, holds, holdsUnder, holdsAny, isStudent, STAFF_ROLES } from './roles.js'
import { strId } from '../lib/util.js'
export { canDM } from './dmRules.js'

export const allow = (meta) => ({ allow: true, meta })
export const deny = (code, meta) => ({ allow: false, code, meta })

const grantFor = (actor, group) => (group.visibilityGrants ?? []).find((g) => holds(actor, g.role, g.at))

export function isManager(actor, group, membership) {
  if (membership?.groupRole === 'MANAGER') return true
  const m = group.manager
  if (!m) return false
  if (m.userId && strId(m.userId) === actor.id) return true
  if (strId(group.ownerId) === actor.id) return true
  if (m.role && holds(actor, m.role, m.orgUnitId)) return true
  return false
}
export const isModerator = (actor, group, membership) => isManager(actor, group, membership) || membership?.groupRole === 'MODERATOR'

export function canRead(actor, group, membership) {
  if (membership) return allow({ via: 'membership' })
  if (grantFor(actor, group)) return allow({ via: 'grant' })
  return deny('NOT_MEMBER', teacherHint(actor, group))
}

/** Teachers who open a class group get pointed at the CR line instead. */
function teacherHint(actor, group) {
  if (group.kind === 'CLASS' && has(actor, 'TEACHER')) return { route: { type: 'CR_LINE', message: 'Teachers reach this class through the CR line. Open CR line →' } }
  return undefined
}

export function canPost(actor, group, membership) {
  const r = canRead(actor, group, membership)
  if (!r.allow) return r
  if (group.archived) return deny('READ_ONLY_CHANNEL', { reason: 'archived' })
  if (['SUSPENDED', 'INACTIVE', 'ALUMNI'].includes(actor.status)) return deny('READ_ONLY_CHANNEL', { reason: actor.status.toLowerCase() })
  if (actor.status === 'FROZEN' && actor.kind === 'STUDENT') return deny('READ_ONLY_CHANNEL', { reason: 'frozen' })
  if (membership?.mutedUntil && membership.mutedUntil > new Date()) return deny('READ_ONLY_CHANNEL', { reason: 'muted', until: membership.mutedUntil })
  const mgr = isManager(actor, group, membership)
  if (group.announceOnly && !mgr && !(group.posters ?? []).some((role) => holds(actor, role, group.orgUnitId))) {
    return deny('ANNOUNCE_ONLY', { manager: group.manager })
  }
  if (!membership) {
    const g = grantFor(actor, group)
    return g.access === 'READ_POST' ? allow({ via: 'grant', postedAs: g.role }) : deny('READ_ONLY_CHANNEL', { reason: 'read-only grant' })
  }
  return allow()
}

/** Which scope types each role may publish to (screens-flows §6.2). */
export const BOARD_PUBLISHERS = {
  CAMPUS: ['SUPER_ADMIN', 'ADMIN', 'CAMPUS_INCHARGE', 'SA_HEAD', 'EXAM_OFFICER'],
  OFFICE: ['SUPER_ADMIN', 'ADMIN', 'EXAM_OFFICER'],
  DEPARTMENT: ['SUPER_ADMIN', 'ADMIN', 'HOD', 'COORDINATOR'],
  PROGRAM: ['SUPER_ADMIN', 'ADMIN', 'PROGRAM_INCHARGE', 'COORDINATOR', 'HOD'],
  BATCH: ['SUPER_ADMIN', 'ADMIN', 'COORDINATOR', 'HOD'],
  SECTION: ['COORDINATOR', 'HOD'],
}
export function canPublish(actor, scopeOrg) {
  const allowed = BOARD_PUBLISHERS[scopeOrg.type] ?? []
  // office heads (Student Affairs, Exam Cell) are assigned at their office but publish campus-wide
  const OFFICE_WIDE = ['SA_HEAD', 'EXAM_OFFICER']
  // everything else only counts when the role's assignment covers the scope (HOD of CS can't publish for EE)
  return allowed.some((r) => (OFFICE_WIDE.includes(r) && scopeOrg.type === 'CAMPUS' ? has(actor, r) : holds(actor, r, scopeOrg._id))) ? allow() : deny('BOARD_SCOPE', { scope: scopeOrg.code })
}

export function canRelay(actor, sourceGroup, targetGroup) {
  if (!sourceGroup || !targetGroup) return deny('NOT_CR')
  if (sourceGroup.kind !== 'CR_LINE' && !(sourceGroup.kind === 'ROLE' && sourceGroup.template === 'CRS')) return deny('NOT_CR')
  if (targetGroup.kind !== 'CLASS') return deny('NOT_CR')
  const batch = strId(targetGroup.orgUnitId)
  // a CR line relays within its own batch; the CRs group relays to the CR's own batch
  if (sourceGroup.kind === 'CR_LINE' && strId(sourceGroup.orgUnitId) !== batch) return deny('NOT_CR')
  return (actor.roles ?? []).some((r) => r.role === 'CR' && strId(r.orgUnitId) === batch) ? allow() : deny('NOT_CR', { batch })
}

/** Board scope visibility: who can *see* announcements for a scope. */
export function scopeIdsFor(actor) {
  const ids = new Set()
  const addPath = (orgId) => (org.get(orgId)?.path ?? []).forEach((p) => ids.add(String(p)))
  if (actor.batchId) addPath(actor.batchId)
  if (actor.departmentId) addPath(actor.departmentId)
  for (const r of actor.roles) addPath(r.orgUnitId)
  const campus = org.campus()
  if (campus) ids.add(String(campus._id))
  return ids
}
export const canSeeScope = (actor, scopeId) => scopeIdsFor(actor).has(strId(scopeId)) || holdsAny(actor, ['ADMIN', 'SUPER_ADMIN'], null)

/** Role assignment rules (screens-flows §1, §2). */
const ASSIGNERS = {
  ADMIN: ['SUPER_ADMIN'], CAMPUS_INCHARGE: ['SUPER_ADMIN'], SA_HEAD: ['ADMIN', 'SUPER_ADMIN'],
  SA_OFFICER: ['ADMIN', 'SA_HEAD', 'SUPER_ADMIN'], HOD: ['ADMIN', 'SUPER_ADMIN'],
  PROGRAM_INCHARGE: ['ADMIN', 'HOD', 'SUPER_ADMIN'], COORDINATOR: ['ADMIN', 'HOD', 'SUPER_ADMIN'],
  TEACHER: ['ADMIN', 'HOD', 'SUPER_ADMIN'], CR: ['ADMIN', 'HOD', 'COORDINATOR', 'SUPER_ADMIN'],
  LIBRARIAN: ['ADMIN', 'SUPER_ADMIN'], LIBRARY_STAFF: ['ADMIN', 'LIBRARIAN', 'SUPER_ADMIN'],
  CAFE_MANAGER: ['ADMIN', 'SUPER_ADMIN'], CAFE_STAFF: ['ADMIN', 'CAFE_MANAGER', 'SUPER_ADMIN'],
  PUBLISHER: ['ADMIN', 'SA_HEAD', 'SUPER_ADMIN'], SOCIETY_LEAD: ['SA_HEAD', 'SA_OFFICER', 'ADMIN', 'SUPER_ADMIN'],
  EXAM_OFFICER: ['ADMIN', 'SUPER_ADMIN'],
}
import { RANK, rankOf } from './roles.js'
export function assertCanAssign(actor, role, orgUnitId, targetUserId) {
  if (role === 'SUPER_ADMIN') return deny('RANK_VIOLATION', { reason: 'Super Admin is created only by a server command.' })
  if (strId(targetUserId) === actor.id) return deny('SELF_ASSIGNMENT')
  if ((RANK[role] ?? 0) >= rankOf(actor)) return deny('RANK_VIOLATION')
  const assigners = ASSIGNERS[role]
  if (!assigners) return deny('FORBIDDEN')
  const dept = org.departmentOf(orgUnitId)
  const ok = assigners.some((r) => {
    if (r === 'SUPER_ADMIN' || r === 'ADMIN') return has(actor, r)
    if (r === 'SA_HEAD' || r === 'LIBRARIAN' || r === 'CAFE_MANAGER') return has(actor, r)
    return dept ? holds(actor, r, dept._id) : false // department-scoped assigners (HOD, Coordinator)
  })
  if (!ok) return deny(dept && assigners.some((r) => ['HOD', 'COORDINATOR'].includes(r)) && (has(actor, 'HOD') || has(actor, 'COORDINATOR')) ? 'DEPARTMENT_BOUNDARY' : 'FORBIDDEN')
  return allow()
}
