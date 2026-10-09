import { Group, Membership, CourseOffering, Term } from '../models/index.js'
import { org } from './org.js'
import { loadAllActors } from './actors.js'
import { holds, holdsUnder } from '../policy/roles.js'
import { strId } from '../lib/util.js'
import { joinUser, leaveUser, toUser } from '../lib/realtime.js'

// ---------- templates ----------
const TEMPLATES = {
  TEACHERS: (dept) => ({
    name: `Teachers — ${dept.code}`, kind: 'ROLE', template: 'TEACHERS', orgUnitId: dept._id, glyph: '#', restricted: true,
    description: `Official notices, faculty council minutes and academic circulars for ${dept.name}.`,
    mandate: 'Official notices, faculty council meeting minutes, and academic circulars regarding instruction.',
    manager: { role: 'HOD', orgUnitId: dept._id }, announceOnly: true, posters: ['COORDINATOR'],
    membershipRule: ['TEACHER', 'HOD', 'PROGRAM_INCHARGE', 'COORDINATOR'].map((role) => ({ role, within: dept._id })),
    rules: ['Faculty only', 'Announcements are announce-only; raise matters at the Coordinator Desk'],
  }),
  CRS: (dept) => ({
    name: `CRs — ${dept.code}`, kind: 'ROLE', template: 'CRS', orgUnitId: dept._id, glyph: '#',
    description: `Coordinators speak to every Class Representative in ${dept.name} here.`,
    manager: { role: 'COORDINATOR', orgUnitId: dept._id }, posters: [],
    membershipRule: [{ role: 'CR', within: dept._id }, { role: 'COORDINATOR', within: dept._id }, { role: 'HOD', within: dept._id }],
    rules: ['Relay official updates to your class group using "Relay to class"'],
  }),
  DEPT_MGMT: (dept) => ({
    name: `Dept Management — ${dept.code}`, kind: 'ROLE', template: 'DEPT_MGMT', orgUnitId: dept._id, glyph: '#', restricted: true,
    description: `${dept.name} leadership room.`, manager: { role: 'HOD', orgUnitId: dept._id },
    membershipRule: ['HOD', 'PROGRAM_INCHARGE', 'COORDINATOR'].map((role) => ({ role, within: dept._id })),
  }),
}

export async function createDeptGroups(dept) {
  const out = []
  for (const k of ['TEACHERS', 'CRS', 'DEPT_MGMT']) {
    const exists = await Group.findOne({ template: k, orgUnitId: dept._id })
    out.push(exists ?? await Group.create(TEMPLATES[k](dept)))
  }
  return out
}

export async function createCampusGroups() {
  const campus = org.campus()
  const sa = org.byCode('SA')
  const defs = [
    { template: 'COORDINATORS', name: 'Coordinators — CUI', kind: 'ROLE', orgUnitId: campus._id, glyph: '#', manager: { flag: 'coordinatorsGroupManager' },
      description: 'All department coordinators across campus, with the Admin who runs the group.',
      membershipRule: [{ role: 'COORDINATOR', within: campus._id }, { role: 'ADMIN', flag: 'coordinatorsGroupManager' }] },
    { template: 'HODS', name: 'HODs — CUI', kind: 'ROLE', orgUnitId: campus._id, glyph: '#', restricted: true, manager: { role: 'CAMPUS_INCHARGE', orgUnitId: campus._id },
      description: 'Heads of department and the Campus Incharge.',
      membershipRule: [{ role: 'HOD', within: campus._id }, { role: 'CAMPUS_INCHARGE', within: campus._id }] },
    { template: 'SA_STAFF', name: 'Student Affairs staff', kind: 'ROLE', orgUnitId: sa._id, glyph: '#', manager: { role: 'SA_HEAD', orgUnitId: sa._id },
      description: 'Student Affairs Head and officers (including Financial Aid).',
      membershipRule: [{ role: 'SA_HEAD', within: sa._id }, { role: 'SA_OFFICER', within: sa._id }] },
  ]
  for (const d of defs) if (!(await Group.findOne({ template: d.template }))) await Group.create(d)
}

export async function createBatchGroups(batch) {
  const dept = org.departmentOf(batch._id)
  const program = org.programOf(batch._id)
  const grants = [
    { role: 'HOD', at: dept._id, access: 'READ_POST' }, { role: 'COORDINATOR', at: dept._id, access: 'READ_POST' },
  ]
  let cls = await Group.findOne({ template: 'CLASS', orgUnitId: batch._id })
  if (!cls) {
    cls = await Group.create({
      name: `${batch.code} Class`, slug: `class-${batch.code.toLowerCase()}`, kind: 'CLASS', template: 'CLASS', orgUnitId: batch._id, glyph: '#',
      description: `Class group for ${batch.code}.`, manager: { role: 'COORDINATOR', orgUnitId: dept._id },
      membershipRule: [{ students: batch._id }, { role: 'CR', within: batch._id, groupRole: 'MODERATOR' }],
      visibilityGrants: [...grants, { role: 'PROGRAM_INCHARGE', at: program._id, access: 'READ' }],
      rules: ['Be respectful', 'Official updates arrive through your CR'],
    })
  }
  let crl = await Group.findOne({ template: 'CR_LINE', orgUnitId: batch._id })
  if (!crl) {
    crl = await Group.create({
      name: `${batch.code} CR Line`, slug: `cr-line-${batch.code.toLowerCase()}`, kind: 'CR_LINE', template: 'CR_LINE', orgUnitId: batch._id, glyph: '#', restricted: true,
      description: `Official liaison line for ${batch.code}. Teachers reach the class through the appointed Class Representatives.`,
      mandate: 'Designated administrative conduit bridging faculty members and the class. Direct broadcast bypass is restricted per Registrar Policy §12-B.',
      manager: { role: 'COORDINATOR', orgUnitId: dept._id },
      membershipRule: [{ role: 'CR', within: batch._id }, { teachersOf: batch._id }],
      visibilityGrants: [...grants, { role: 'PROGRAM_INCHARGE', at: program._id, access: 'READ_POST' }],
      rules: ['Relay policy: immediate broadcast', 'Escalation: CS Coordination Desk', 'Session: current term'],
    })
  }
  return [cls, crl]
}

// ---------- membership sync ----------
async function teachersByBatch() {
  const term = await Term.findOne({ current: true }).lean()
  const map = new Map()
  if (!term) return map
  for (const o of await CourseOffering.find({ termId: term._id }).lean()) {
    const k = String(o.batchId)
    if (!map.has(k)) map.set(k, new Set())
    map.get(k).add(String(o.teacherId))
  }
  return map
}

function ruleMatches(rule, a, teach) {
  if (a.status === 'INACTIVE') return null
  if (rule.students) return a.kind === 'STUDENT' && a.batchId === strId(rule.students) ? 'MEMBER' : null
  if (rule.teachersOf) return teach.get(strId(rule.teachersOf))?.has(a.id) ? 'MEMBER' : null
  if (rule.role) {
    const hit = a.roles.find((r) => r.role === rule.role && (!rule.within || org.isWithin(r.orgUnitId, rule.within)) && (!rule.flag || r.flags?.[rule.flag]))
    return hit ? (rule.groupRole ?? 'MEMBER') : null
  }
  return null
}

function managerMatches(group, a) {
  const m = group.manager
  if (!m) return false
  if (m.userId && strId(m.userId) === a.id) return true
  if (m.flag) return a.roles.some((r) => r.flags?.[m.flag])
  if (m.role) return a.roles.some((r) => r.role === m.role && (!m.orgUnitId || org.isWithin(r.orgUnitId, m.orgUnitId) || org.isWithin(m.orgUnitId, r.orgUnitId)))
  return false
}

export async function syncGroup(group, actors, teach, { live = true } = {}) {
  if (['CUSTOM', 'DIRECT'].includes(group.kind) || group.archived) return { added: 0, removed: 0 }
  const desired = new Map()
  for (const a of actors) {
    let gr = null
    for (const rule of group.membershipRule ?? []) {
      const m = ruleMatches(rule, a, teach)
      if (m) { gr = gr === 'MODERATOR' || m === 'MODERATOR' ? 'MODERATOR' : 'MEMBER' }
    }
    if (gr) desired.set(a.id, managerMatches(group, a) ? 'MANAGER' : gr)
  }
  const existing = await Membership.find({ groupId: group._id, source: 'RULE' }).lean()
  const have = new Map(existing.map((m) => [String(m.userId), m]))
  let added = 0, removed = 0
  const ops = []
  for (const [uid, groupRole] of desired) {
    const cur = have.get(uid)
    if (!cur) {
      ops.push({ insertOne: { document: { groupId: group._id, userId: uid, groupRole, source: 'RULE', lastReadAt: new Date() } } })
      added++
      if (live) { joinUser(uid, [`group:${group._id}`]); toUser(uid, 'membership:changed', { groupId: String(group._id), action: 'joined', name: group.name }) }
    } else if (cur.groupRole !== groupRole) {
      ops.push({ updateOne: { filter: { _id: cur._id }, update: { groupRole } } })
    }
  }
  for (const [uid, cur] of have) {
    if (!desired.has(uid)) {
      ops.push({ deleteOne: { filter: { _id: cur._id } } })
      removed++
      if (live) { leaveUser(uid, [`group:${group._id}`]); toUser(uid, 'membership:changed', { groupId: String(group._id), action: 'left', name: group.name }) }
    }
  }
  if (ops.length) await Membership.bulkWrite(ops)
  return { added, removed }
}

export async function syncAll(opts) {
  const [groups, actors, teach] = await Promise.all([Group.find({ archived: { $ne: true } }).lean(), loadAllActors(), teachersByBatch()])
  const out = { added: 0, removed: 0 }
  for (const g of groups) { const r = await syncGroup(g, actors, teach, opts); out.added += r.added; out.removed += r.removed }
  return out
}

/** Re-run membership rules after any structural change (role, batch, offering, term) and push live updates. */
export async function resync() {
  const r = await syncAll({ live: true })
  const { refreshAllRooms } = await import('../sockets/rooms.js')
  await refreshAllRooms().catch(() => {})
  return r
}

// ---------- visibility ----------
/** Groups a user can open: memberships plus grant-based visibility (HOD/coordinator see every class). */
export async function groupsVisibleTo(actor) {
  const [mine, all] = await Promise.all([
    Membership.find({ userId: actor._id }).lean(),
    Group.find({ kind: { $in: ['CLASS', 'CR_LINE', 'ROLE'] }, archived: { $ne: true }, 'visibilityGrants.0': { $exists: true } }).lean(),
  ])
  const mem = new Map(mine.map((m) => [String(m.groupId), m]))
  const granted = all.filter((g) => !mem.has(String(g._id)) && g.visibilityGrants.some((gr) => holds(actor, gr.role, gr.at)))
  return { memberships: mem, grantedGroups: granted }
}

export const getGroup = (id) => Group.findById(id).lean()
export const getMembership = (groupId, userId) => Membership.findOne({ groupId, userId }).lean()

export async function archiveBatchGroups(batchId) {
  const gs = await Group.find({ orgUnitId: batchId, kind: { $in: ['CLASS', 'CR_LINE'] } })
  for (const g of gs) {
    g.archived = true
    await g.save()
    const ms = await Membership.find({ groupId: g._id }).lean()
    for (const m of ms) toUser(String(m.userId), 'membership:changed', { groupId: String(g._id), action: 'archived', name: g.name })
  }
}
