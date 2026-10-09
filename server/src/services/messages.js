import { Group, Membership, Message } from '../models/index.js'
import { AppError } from '../lib/errors.js'
import { decrypt } from '../lib/crypto.js'
import { sanitize, hit, strId, addDays } from '../lib/util.js'
import { canPost, canRead, canRelay, canDM, isManager, isModerator } from '../policy/index.js'
import { badgesOf, deptIdOf } from '../policy/roles.js'
import { org } from './org.js'
import { loadActor, loadActors, publicCard, teachesBatch } from './actors.js'
import { toGroup, toUser, toRoom, joinUser } from '../lib/realtime.js'
import { notify } from '../lib/notify.js'
import { audit } from '../lib/audit.js'

const EDIT_WINDOW_MIN = 15
const PIN_LIMIT = 10

export function snapshotFor(actor, extra = {}) {
  return { name: actor.name, uid: actor.uid, badges: badgesOf(actor), dept: org.get(deptIdOf(actor))?.code, ...extra }
}

export function serializeMessage(m, { me } = {}) {
  const o = m.toObject ? m.toObject() : m
  o.body = decrypt(o.body) // toObject() skips getters; never let ciphertext reach a client
  const deleted = !!o.deletedAt
  return {
    id: String(o._id), groupId: o.groupId ? String(o.groupId) : undefined, ticketId: o.ticketId ? String(o.ticketId) : undefined,
    sender: { id: String(o.senderId), ...o.senderSnapshot, initials: (o.senderSnapshot?.name ?? '').replace(/^(Dr\.|Prof\.|Engr\.)\s*/i, '').split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() },
    body: deleted ? '' : o.body, deleted, deletedAt: o.deletedAt, deleteReason: deleted ? o.deleteReason : undefined,
    kind: o.kind, attachments: deleted ? [] : o.attachments, replyTo: o.replyTo ? String(o.replyTo) : undefined,
    threadOf: o.threadOf ? String(o.threadOf) : undefined, threadCount: o.threadCount ?? 0,
    mentions: (o.mentions ?? []).map(String),
    relayOf: o.relayOf?.messageId ? { messageId: String(o.relayOf.messageId), groupId: String(o.relayOf.groupId), sourceName: o.relayOf.sourceName, course: o.relayOf.course, by: String(o.relayOf.byUserId) } : undefined,
    relayedTo: (o.relayedTo ?? []).map((r) => ({ groupId: String(r.groupId), groupName: r.groupName, byName: r.byName, at: r.at })),
    forwardOf: o.forwardOf?.announcementId ? { announcementId: String(o.forwardOf.announcementId), title: o.forwardOf.title } : undefined,
    reactions: (o.reactions ?? []).map((r) => ({ emoji: r.emoji, count: r.userIds.length, mine: me ? r.userIds.some((u) => String(u) === me) : false })),
    pinned: o.pinned, postedAs: o.postedAs, internal: o.internal, editedAt: o.editedAt,
    clientId: o.clientId, createdAt: o.createdAt,
  }
}

const rateOk = (userId) => hit(`msg:${userId}`, 10, 10_000)

async function ctxFor(groupId, actor) {
  const [group, membership] = await Promise.all([Group.findById(groupId).lean(), Membership.findOne({ groupId, userId: actor._id }).lean()])
  if (!group) throw new AppError('NOT_FOUND', 404)
  return { group, membership }
}

export async function checkCanPost(actor, groupId) {
  const { group, membership } = await ctxFor(groupId, actor)
  return canPost(actor, group, membership)
}

export async function sendMessage(actor, { groupId, body = '', attachments = [], replyTo, threadOf, mentions = [], clientId, kind = 'TEXT', forwardOf, course }) {
  const { group, membership } = await ctxFor(groupId, actor)
  const verdict = canPost(actor, group, membership)
  if (!verdict.allow) throw new AppError(verdict.code, 403, verdict.meta)
  if (!rateOk(actor.id)) throw new AppError('RATE_LIMITED', 429)
  const text = sanitize(body)
  if (!text && !attachments.length) throw new AppError('VALIDATION_FAILED', 422, { field: 'body' })
  if (group.slowModeSeconds && !isModerator(actor, group, membership)) {
    const last = await Message.findOne({ groupId, senderId: actor._id, threadOf: null }).sort({ createdAt: -1 }).lean()
    const wait = last ? group.slowModeSeconds - (Date.now() - new Date(last.createdAt)) / 1000 : 0
    if (wait > 0) throw new AppError('RATE_LIMITED', 429, { retryAfter: Math.ceil(wait), reason: 'slow-mode' })
  }
  // only people who can read the group are ever mentioned
  const validMentions = []
  for (const uid of mentions.slice(0, 20)) {
    const m = await Membership.findOne({ groupId, userId: uid }).lean()
    if (m) validMentions.push(uid)
  }
  const msg = await Message.create({
    groupId, senderId: actor._id, body: text, attachments, replyTo, threadOf, kind, mentions: validMentions, clientId,
    forwardOf: forwardOf ? { announcementId: forwardOf.announcementId, title: forwardOf.title } : undefined,
    postedAs: verdict.meta?.postedAs, senderSnapshot: snapshotFor(actor, course ? { course } : {}),
  })
  if (threadOf) await Message.updateOne({ _id: threadOf }, { $inc: { threadCount: 1 } })
  else await Group.updateOne({ _id: groupId }, { lastMessageAt: msg.createdAt })
  const out = serializeMessage(msg)
  toGroup(groupId, 'message:new', out)
  if (threadOf) toGroup(groupId, 'message:thread', { messageId: String(threadOf), threadCount: (await Message.findById(threadOf).lean())?.threadCount })
  // notifications
  for (const uid of validMentions) if (uid !== actor.id) notify(uid, { type: 'mention', title: `${actor.name} mentioned you in ${group.name}`, body: text.slice(0, 140), link: `/groups/${groupId}` })
  if (group.kind === 'DIRECT') {
    const peers = await Membership.find({ groupId, userId: { $ne: actor._id } }).lean()
    for (const p of peers) notify(p.userId, { type: 'dm', title: actor.name, body: text.slice(0, 140), link: `/dm/${groupId}` })
  }
  return out
}

export async function editMessage(actor, messageId, body) {
  const m = await Message.findById(messageId)
  if (!m || m.deletedAt) throw new AppError('NOT_FOUND', 404)
  if (strId(m.senderId) !== actor.id) throw new AppError('FORBIDDEN', 403)
  if (Date.now() - new Date(m.createdAt) > EDIT_WINDOW_MIN * 60_000) throw new AppError('FORBIDDEN', 403, { reason: `Messages can be edited within ${EDIT_WINDOW_MIN} minutes.` })
  m.body = sanitize(body)
  m.editedAt = new Date()
  await m.save()
  const out = serializeMessage(m)
  toRoom(m.groupId ? `group:${m.groupId}` : `ticket:${m.ticketId}`, 'message:updated', out)
  return out
}

export async function deleteMessage(actor, messageId, reason) {
  const m = await Message.findById(messageId)
  if (!m || m.deletedAt) throw new AppError('NOT_FOUND', 404)
  const own = strId(m.senderId) === actor.id
  if (!own) {
    const { group, membership } = await ctxFor(m.groupId, actor)
    if (!isModerator(actor, group, membership)) throw new AppError('FORBIDDEN', 403)
    if (!reason) throw new AppError('VALIDATION_FAILED', 422, { field: 'reason', reason: 'A reason is required to remove a message.' })
    notify(m.senderId, { type: 'moderation', title: `A moderator removed your message in ${group.name}`, body: reason, link: `/groups/${group._id}`, mutable: false })
    await audit(actor, 'message.remove', { category: 'content', target: { kind: 'message', id: String(m._id) }, meta: { reason, groupId: String(m.groupId) } })
  }
  m.deletedAt = new Date(); m.deletedBy = actor._id; m.deleteReason = own ? undefined : reason; m.purgeAt = addDays(new Date(), 30)
  await m.save()
  toRoom(m.groupId ? `group:${m.groupId}` : `ticket:${m.ticketId}`, 'message:deleted', { messageId: String(m._id), groupId: String(m.groupId), deletedAt: m.deletedAt, reason: m.deleteReason })
  return { ok: true }
}

export async function toggleReaction(actor, messageId, emoji) {
  const m = await Message.findById(messageId)
  if (!m || m.deletedAt) throw new AppError('NOT_FOUND', 404)
  const { group, membership } = await ctxFor(m.groupId, actor)
  if (!canRead(actor, group, membership).allow) throw new AppError('NOT_MEMBER', 403)
  let r = m.reactions.find((x) => x.emoji === emoji)
  if (!r) { m.reactions.push({ emoji, userIds: [actor._id] }) }
  else if (r.userIds.some((u) => String(u) === actor.id)) { r.userIds = r.userIds.filter((u) => String(u) !== actor.id); if (!r.userIds.length) m.reactions = m.reactions.filter((x) => x.emoji !== emoji) }
  else r.userIds.push(actor._id)
  await m.save()
  toGroup(m.groupId, 'message:reactions', { messageId: String(m._id), reactions: m.reactions.map((x) => ({ emoji: x.emoji, count: x.userIds.length, userIds: x.userIds.map(String) })) })
  return { reactions: serializeMessage(m, { me: actor.id }).reactions }
}

export async function togglePin(actor, messageId) {
  const m = await Message.findById(messageId)
  if (!m || m.deletedAt) throw new AppError('NOT_FOUND', 404)
  const { group, membership } = await ctxFor(m.groupId, actor)
  if (!isModerator(actor, group, membership)) throw new AppError('FORBIDDEN', 403)
  const g = await Group.findById(group._id)
  if (!m.pinned) {
    if (g.pins.length >= PIN_LIMIT) throw new AppError('VALIDATION_FAILED', 422, { reason: `A group can have ${PIN_LIMIT} pins.` })
    g.pins.push(m._id); m.pinned = true
  } else { g.pins = g.pins.filter((p) => String(p) !== String(m._id)); m.pinned = false }
  await Promise.all([g.save(), m.save()])
  toGroup(group._id, 'group:changed', { groupId: String(group._id), pins: g.pins.map(String) })
  toGroup(group._id, 'message:updated', serializeMessage(m))
  return { pinned: m.pinned }
}

export async function relayMessage(actor, { messageId, toGroupId, note, confirm = false }) {
  const source = await Message.findById(messageId)
  if (!source || source.deletedAt) throw new AppError('NOT_FOUND', 404)
  const [srcGroup, tgtGroup] = await Promise.all([Group.findById(source.groupId).lean(), Group.findById(toGroupId).lean()])
  const verdict = canRelay(actor, srcGroup, tgtGroup)
  if (!verdict.allow) throw new AppError(verdict.code, 403, verdict.meta)
  const prior = source.relayedTo.find((r) => String(r.groupId) === String(toGroupId))
  if (prior && !confirm) throw new AppError('CONFLICT', 409, { reason: 'ALREADY_RELAYED', byName: prior.byName, at: prior.at, message: `Already relayed by ${prior.byName} at ${prior.at.toISOString().slice(11, 16)}` })
  const body = [sanitize(note ?? ''), source.body].filter(Boolean).join('\n\n')
  const msg = await Message.create({
    groupId: toGroupId, senderId: actor._id, body, attachments: source.attachments, kind: 'TEXT', postedAs: 'RELAY',
    relayOf: { messageId: source._id, groupId: srcGroup._id, sourceName: source.senderSnapshot?.name, course: source.senderSnapshot?.course, byUserId: actor._id },
    senderSnapshot: snapshotFor(actor),
  })
  source.relayedTo.push({ groupId: tgtGroup._id, groupName: tgtGroup.name, byUserId: actor._id, byName: actor.name, at: new Date(), messageId: msg._id })
  await source.save()
  await Group.updateOne({ _id: toGroupId }, { lastMessageAt: msg.createdAt })
  const out = serializeMessage(msg)
  toGroup(toGroupId, 'message:new', out)
  toGroup(srcGroup._id, 'message:updated', serializeMessage(source))
  toGroup(srcGroup._id, 'relay:status', { messageId: String(source._id), relayedTo: serializeMessage(source).relayedTo })
  const members = await Membership.find({ groupId: toGroupId, userId: { $ne: actor._id } }).lean()
  for (const mem of members.slice(0, 500)) notify(mem.userId, { type: 'relay', title: `${actor.name} (CR) relayed an update`, body: body.slice(0, 120), link: `/groups/${toGroupId}`, mutable: false })
  return out
}

export async function listMessages(actor, groupId, { before, limit = 30, threadOf } = {}) {
  const { group, membership } = await ctxFor(groupId, actor)
  const v = canRead(actor, group, membership)
  if (!v.allow) throw new AppError(v.code, 403, v.meta)
  const q = { groupId, threadOf: threadOf ?? null }
  if (before) q._id = { $lt: before }
  const rows = await Message.find(q).sort({ _id: -1 }).limit(Math.min(limit, 100)).lean()
  const items = rows.reverse().map((m) => serializeMessage(m, { me: actor.id }))
  return { items, hasMore: rows.length === Math.min(limit, 100), group: { id: String(group._id), name: group.name } }
}

export async function markRead(actor, groupId, lastMessageId) {
  const upd = { lastReadAt: new Date() }
  if (lastMessageId) upd.lastReadMessageId = lastMessageId
  await Membership.updateOne({ groupId, userId: actor._id }, upd)
  toUser(actor.id, 'group:read', { groupId, at: upd.lastReadAt })
  return { ok: true }
}

export async function unreadCounts(actor) {
  const mems = await Membership.find({ userId: actor._id }).lean()
  const out = {}
  await Promise.all(mems.map(async (m) => {
    out[String(m.groupId)] = await Message.countDocuments({ groupId: m.groupId, threadOf: null, deletedAt: null, senderId: { $ne: actor._id }, createdAt: { $gt: m.lastReadAt ?? 0 } })
  }))
  return out
}

// ---------- direct messages ----------
export async function dmContext() {
  return {
    crOf: async (batchId) => {
      const { RoleAssignment } = await import('../models/index.js')
      const rows = await RoleAssignment.find({ role: 'CR', orgUnitId: batchId }).lean()
      const actors = await loadActors(rows.map((r) => r.userId))
      return actors.map((a) => ({ id: a.id, name: a.name }))
    },
  }
}

export async function openDm(actor, targetId) {
  const target = await loadActor(targetId)
  if (!target) throw new AppError('NOT_FOUND', 404)
  const v = await canDM(actor, target, await dmContext())
  if (!v.allow) throw new AppError('FORBIDDEN_DM', 403, v.meta)
  const key = [actor.id, target.id].sort().join(':')
  let g = await Group.findOne({ directKey: key })
  if (!g) {
    g = await Group.create({ name: `${actor.name} & ${target.name}`, kind: 'DIRECT', directKey: key, glyph: '@' })
    await Membership.insertMany([{ groupId: g._id, userId: actor._id }, { groupId: g._id, userId: target._id }])
  }
  await joinUser(actor.id, [`group:${g._id}`]); await joinUser(target.id, [`group:${g._id}`])
  toUser(target.id, 'membership:changed', { groupId: String(g._id), action: 'joined', name: actor.name })
  return { groupId: String(g._id), peer: publicCard(target) }
}
