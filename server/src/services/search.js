import { Announcement, ChannelPost, Channel, ChannelFollow, Ticket, Desk, Group, Membership, User, Message } from '../models/index.js'
import { org } from './org.js'
import { scopeIdsFor } from '../policy/index.js'
import { postTargetsUser } from './channels.js'
import { loadActors, publicCard } from './actors.js'
import { canDM } from '../policy/index.js'
import { dmContext } from './messages.js'
import { has } from '../policy/roles.js'
import { strId, uniq } from '../lib/util.js'

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Search only what the user can read now; report how many entities were excluded by the boundary (APP-04). */
export async function search(actor, { q = '', scope = 'all' }) {
  const text = q.trim()
  if (!text) return { query: q, scopes: { all: 0 }, people: [], circulars: [], channels: [], tickets: [], groups: [], excluded: 0 }
  const rx = new RegExp(esc(text), 'i')
  const ctx = await dmContext()
  // people
  const users = await User.find({ status: { $nin: ['INACTIVE'] }, _id: { $ne: actor._id }, $or: [{ name: rx }, { uid: rx }] }).limit(40).lean()
  const actors = await loadActors(users.map((u) => u._id))
  const people = []
  let excluded = 0
  for (const t of actors) {
    const v = await canDM(actor, t, ctx)
    const card = publicCard(t)
    const teacher = t.roles.some((r) => r.role === 'TEACHER')
    // cross-batch students and other-department private directories stay quarantined
    if (t.kind === 'STUDENT' && actor.kind === 'STUDENT' && t.batchId !== actor.batchId) { excluded++; people.push({ ...card, restricted: true, restriction: 'CROSS-BATCH PRIVACY RESTRICTED' }); continue }
    const crName = actor.kind === 'STUDENT' && teacher ? (await ctx.crOf(actor.batchId))[0] : null
    people.push({ ...card, email: teacher ? t.email : undefined, cabin: t.cabin, dm: { allowed: v.allow, route: v.meta?.route }, restricted: !v.allow, route: !v.allow && crName ? { type: 'CR', userId: crName.id, label: `Route via ${crName.name} (CR)`, deskLabel: 'File Course Inquiry at Desk' } : v.meta?.route })
  }
  // circulars: only visible scopes
  const visible = [...scopeIdsFor(actor)]
  const circ = await Announcement.find({ scopeId: { $in: visible }, status: 'PUBLISHED', $or: [{ title: rx }, { body: rx }, { refNo: rx }] }).sort({ createdAt: -1 }).limit(10).lean()
  const hiddenCirc = await Announcement.countDocuments({ scopeId: { $nin: visible }, status: 'PUBLISHED', $or: [{ title: rx }, { body: rx }] })
  excluded += hiddenCirc
  const circulars = circ.map((a) => ({ id: String(a._id), refNo: a.refNo, title: a.title, scopeType: a.scopeType, scope: org.get(a.scopeId)?.code, snippet: a.body.slice(0, 180), createdAt: a.createdAt, acknowledged: a.acks.some((x) => String(x.userId) === actor.id), category: a.category, officeLabel: a.officeLabel }))
  // channel posts targeting the user
  const follows = await ChannelFollow.find({ userId: actor._id }).lean()
  const posts = (await ChannelPost.find({ channelId: { $in: follows.map((f) => f.channelId) }, status: 'PUBLISHED', $or: [{ title: rx }, { body: rx }] }).limit(20).lean()).filter((p) => postTargetsUser(p, actor))
  const chs = new Map((await Channel.find({ _id: { $in: posts.map((p) => p.channelId) } }).lean()).map((c) => [String(c._id), c]))
  const channels = posts.slice(0, 10).map((p) => ({ id: String(p._id), title: p.title, channel: chs.get(String(p.channelId))?.name, slug: chs.get(String(p.channelId))?.slug, applyBy: p.applyBy, snippet: (p.body ?? '').slice(0, 140) }))
  // own tickets / desk tickets
  const mine = await Ticket.find({ requesterId: actor._id, $or: [{ subject: rx }, { code: rx }] }).limit(10).lean()
  const tickets = mine.map((t) => ({ id: String(t._id), code: t.code, subject: t.subject, status: t.status }))
  // groups the user is a member of
  const memberships = await Membership.find({ userId: actor._id }).lean()
  const grs = await Group.find({ _id: { $in: memberships.map((m) => m.groupId) }, name: rx, kind: { $ne: 'DIRECT' } }).limit(10).lean()
  const groups = grs.map((g) => ({ id: String(g._id), name: g.name, kind: g.kind }))
  // messages in groups the user belongs to
  // bodies are encrypted at rest, so the database can't match them: decrypt recent messages of groups the user is in and filter here
  const recent = await Message.find({ groupId: { $in: memberships.map((m) => m.groupId) }, deletedAt: null }).sort({ createdAt: -1 }).limit(600).lean()
  const msgs = recent.filter((m) => rx.test(m.body)).slice(0, 10)
  const messages = msgs.map((m) => ({ id: String(m._id), groupId: String(m.groupId), snippet: m.body.slice(0, 160), sender: m.senderSnapshot?.name, at: m.createdAt }))
  const faculty = people.filter((p) => p.roles?.includes('TEACHER') || p.badges?.includes('TEACHER'))
  const scopes = { all: people.length + circulars.length + channels.length + tickets.length + groups.length + messages.length, faculty: faculty.length, circulars: circulars.length, helpDesk: tickets.length, channels: channels.length, groups: groups.length, messages: messages.length }
  const pick = (k) => (scope === 'all' ? true : scope === k)
  return { query: q, scopes, excluded, people: pick('people') || scope === 'faculty' ? (scope === 'faculty' ? faculty : people) : [], circulars: pick('circulars') ? circulars : [], channels: pick('channels') ? channels : [], tickets: pick('helpDesk') ? tickets : [], groups: pick('groups') ? groups : [], messages: pick('messages') ? messages : [] }
}
