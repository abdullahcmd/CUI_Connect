import { Group, Membership } from '../models/index.js'
import { loadActors, loadActor, publicCard } from './actors.js'
import { canDM } from '../policy/index.js'
import { dmContext } from './messages.js'
import { AppError } from '../lib/errors.js'
import { sanitize, strId, uniq } from '../lib/util.js'
import { joinUser, leaveUser, toUser, toGroup } from '../lib/realtime.js'
import { audit } from '../lib/audit.js'
import { notify } from '../lib/notify.js'

const LIMITS = { STAFF: 50, STUDENT: 15 }
const STUDENT_MAX_GROUPS = 5

async function eligible(actor, ids) {
  const ctx = await dmContext()
  const targets = await loadActors(ids)
  const bad = []
  for (const t of targets) { const v = await canDM(actor, t, ctx); if (!v.allow) bad.push({ id: t.id, name: t.name, route: v.meta?.route }) }
  return { targets, bad }
}

export async function createCustomGroup(actor, { name, purpose, memberIds = [] }) {
  const n = sanitize(name)
  if (!n) throw new AppError('VALIDATION_FAILED', 422, { field: 'name' })
  const ids = uniq(memberIds).filter((i) => i !== actor.id)
  const max = LIMITS[actor.kind]
  if (ids.length + 1 > max) throw new AppError('VALIDATION_FAILED', 422, { reason: `Limit reached: ${max} members.`, limit: max })
  if (actor.kind === 'STUDENT') {
    const owned = await Group.countDocuments({ kind: 'CUSTOM', ownerId: actor._id, archived: { $ne: true } })
    if (owned >= STUDENT_MAX_GROUPS) throw new AppError('VALIDATION_FAILED', 422, { reason: `Students can own ${STUDENT_MAX_GROUPS} custom groups.`, limit: STUDENT_MAX_GROUPS })
  }
  const { targets, bad } = await eligible(actor, ids)
  if (bad.length) throw new AppError('FORBIDDEN_DM', 403, { reason: 'You can only add people you may message.', rejected: bad })
  const g = await Group.create({ name: n, kind: 'CUSTOM', glyph: '#', description: sanitize(purpose ?? ''), ownerId: actor._id, manager: { userId: actor._id }, maxMembers: max, slug: n.toLowerCase().replace(/\W+/g, '-') })
  await Membership.insertMany([{ groupId: g._id, userId: actor._id, groupRole: 'MANAGER', source: 'MANUAL' }, ...targets.map((t) => ({ groupId: g._id, userId: t._id, source: 'MANUAL' }))])
  for (const t of [actor, ...targets]) { await joinUser(t.id, [`group:${g._id}`]); if (t.id !== actor.id) { toUser(t.id, 'membership:changed', { groupId: String(g._id), action: 'joined', name: n }); notify(t.id, { type: 'group', title: `${actor.name} added you to ${n}`, link: `/groups/${g._id}` }) } }
  await audit(actor, 'group.create', { category: 'content', target: { kind: 'group', id: String(g._id), label: n } })
  return { id: String(g._id), name: n, memberCount: targets.length + 1 }
}

export async function updateCustomMembers(actor, groupId, { add = [], remove = [] }) {
  const g = await Group.findById(groupId)
  if (!g || g.kind !== 'CUSTOM') throw new AppError('NOT_FOUND', 404)
  if (strId(g.ownerId) !== actor.id) throw new AppError('FORBIDDEN', 403)
  const current = await Membership.countDocuments({ groupId })
  if (current + add.length - remove.length > g.maxMembers) throw new AppError('VALIDATION_FAILED', 422, { reason: `Limit reached: ${g.maxMembers} members.` })
  const { targets, bad } = await eligible(actor, add)
  if (bad.length) throw new AppError('FORBIDDEN_DM', 403, { reason: 'You can only add people you may message.', rejected: bad })
  for (const t of targets) { await Membership.updateOne({ groupId, userId: t._id }, { $setOnInsert: { source: 'MANUAL', groupRole: 'MEMBER' } }, { upsert: true }); await joinUser(t.id, [`group:${groupId}`]); toUser(t.id, 'membership:changed', { groupId, action: 'joined', name: g.name }) }
  for (const r of remove) { if (r === actor.id) continue; await Membership.deleteOne({ groupId, userId: r }); await leaveUser(r, [`group:${groupId}`]); toUser(r, 'membership:changed', { groupId, action: 'left', name: g.name }) }
  toGroup(groupId, 'group:changed', { groupId })
  return { ok: true }
}

export async function leaveGroup(actor, groupId) {
  const g = await Group.findById(groupId)
  if (!g || !['CUSTOM'].includes(g.kind)) throw new AppError('FORBIDDEN', 403, { reason: 'Membership in this group follows your role and cannot be left.' })
  await Membership.deleteOne({ groupId, userId: actor._id })
  await leaveUser(actor.id, [`group:${groupId}`])
  if (strId(g.ownerId) === actor.id) { const next = await Membership.findOne({ groupId }); if (next) { g.ownerId = next.userId; g.manager = { userId: next.userId }; await g.save(); await Membership.updateOne({ _id: next._id }, { groupRole: 'MANAGER' }) } else { g.archived = true; await g.save() } }
  return { ok: true }
}

export async function archiveCustomGroup(actor, groupId) {
  const g = await Group.findById(groupId)
  if (!g || g.kind !== 'CUSTOM') throw new AppError('NOT_FOUND', 404)
  const { hasAny } = await import('../policy/roles.js')
  if (strId(g.ownerId) !== actor.id && !hasAny(actor, ['ADMIN', 'SUPER_ADMIN'])) throw new AppError('FORBIDDEN', 403)
  g.archived = true; await g.save(); toGroup(groupId, 'group:changed', { groupId, archived: true })
  return { ok: true }
}
