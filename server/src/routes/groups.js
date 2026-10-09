import { Router } from 'express'
import { z } from 'zod'
import { Group, Membership, Message, Announcement } from '../models/index.js'
import { asyncH, strId } from '../lib/util.js'
import { parse } from '../lib/http.js'
import { AppError } from '../lib/errors.js'
import { groupSummary, groupMembers, buildSidebar } from '../services/sidebar.js'
import { listMessages, sendMessage, editMessage, deleteMessage, toggleReaction, togglePin, relayMessage, markRead, openDm, serializeMessage, unreadCounts } from '../services/messages.js'
import { createCustomGroup, updateCustomMembers, leaveGroup, archiveCustomGroup } from '../services/customGroups.js'
import { createReport } from '../services/reports.js'
import { isManager, isModerator, canRead } from '../policy/index.js'
import { toGroup } from '../lib/realtime.js'
import { audit } from '../lib/audit.js'

const r = Router()
const att = z.object({ id: z.string().optional(), name: z.string(), size: z.number().optional(), mime: z.string().optional(), url: z.string(), sha256: z.string().optional(), label: z.string().optional() })
const SendBody = z.object({ body: z.string().max(8000).default(''), attachments: z.array(att).max(10).optional(), replyTo: z.string().optional(), threadOf: z.string().optional(), mentions: z.array(z.string()).optional(), clientId: z.string().optional() })

r.get('/groups', asyncH(async (req, res) => res.json(await buildSidebar(req.actor))))
r.get('/groups/:id', asyncH(async (req, res) => res.json(await groupSummary(req.actor, req.params.id))))
r.get('/groups/:id/messages', asyncH(async (req, res) => res.json(await listMessages(req.actor, req.params.id, { before: req.query.before, limit: Number(req.query.limit ?? 30), threadOf: req.query.threadOf }))))
r.post('/groups/:id/messages', asyncH(async (req, res) => res.status(201).json(await sendMessage(req.actor, { groupId: req.params.id, ...parse(SendBody, req.body) }))))
r.get('/groups/:id/members', asyncH(async (req, res) => res.json(await groupMembers(req.actor, req.params.id))))
r.get('/groups/:id/pins', asyncH(async (req, res) => { const s = await groupSummary(req.actor, req.params.id); res.json(s.pinned) }))
r.get('/groups/:id/files', asyncH(async (req, res) => { const s = await groupSummary(req.actor, req.params.id); res.json(s.files) }))
r.post('/groups/:id/read', asyncH(async (req, res) => res.json(await markRead(req.actor, req.params.id, req.body?.lastMessageId))))
r.get('/unread', asyncH(async (req, res) => res.json(await unreadCounts(req.actor))))

r.patch('/groups/:id/settings', asyncH(async (req, res) => {
  const p = parse(z.object({ announceOnly: z.boolean().optional(), slowModeSeconds: z.union([z.literal(0), z.literal(30), z.literal(60), z.literal(300)]).optional(), name: z.string().min(1).max(80).optional(), description: z.string().max(500).optional(), notify: z.enum(['all', 'mentions', 'off']).optional() }), req.body)
  const g = await Group.findById(req.params.id)
  const m = await Membership.findOne({ groupId: g?._id, userId: req.actor._id }).lean()
  if (!g) throw new AppError('NOT_FOUND', 404)
  if (p.notify) { await Membership.updateOne({ groupId: g._id, userId: req.actor._id }, { notify: p.notify }); return res.json({ ok: true }) }
  if (!isManager(req.actor, g, m)) throw new AppError('FORBIDDEN', 403)
  if (['ROLE', 'CLASS', 'CR_LINE'].includes(g.kind) && (p.name || p.description) && g.kind !== 'CUSTOM') throw new AppError('FORBIDDEN', 403, { reason: 'Name and description of automatic groups are managed by the system.' })
  for (const [k, v] of Object.entries(p)) if (k !== 'notify') g[k] = v
  await g.save()
  toGroup(g._id, 'group:changed', { groupId: String(g._id), announceOnly: g.announceOnly, slowModeSeconds: g.slowModeSeconds, manager: g.manager })
  await audit(req.actor, 'group.settings', { category: 'content', target: { kind: 'group', id: String(g._id), label: g.name }, after: p })
  res.json({ ok: true, announceOnly: g.announceOnly, slowModeSeconds: g.slowModeSeconds })
}))

// mute a member for up to 24h (managers only; never removes members of automatic groups)
r.post('/groups/:id/members/:userId/mute', asyncH(async (req, res) => {
  const g = await Group.findById(req.params.id).lean()
  const m = await Membership.findOne({ groupId: g._id, userId: req.actor._id }).lean()
  if (!isManager(req.actor, g, m)) throw new AppError('FORBIDDEN', 403)
  const hours = Math.min(Number(req.body?.hours ?? 24), 24)
  await Membership.updateOne({ groupId: g._id, userId: req.params.userId }, { mutedUntil: new Date(Date.now() + hours * 3600_000) })
  await audit(req.actor, 'group.mute', { category: 'content', target: { kind: 'user', id: req.params.userId }, meta: { group: g.name, hours } })
  res.json({ ok: true })
}))

// messages
r.patch('/messages/:id', asyncH(async (req, res) => res.json(await editMessage(req.actor, req.params.id, parse(z.object({ body: z.string().min(1).max(8000) }), req.body).body))))
r.delete('/messages/:id', asyncH(async (req, res) => res.json(await deleteMessage(req.actor, req.params.id, req.body?.reason))))
r.post('/messages/:id/react', asyncH(async (req, res) => res.json(await toggleReaction(req.actor, req.params.id, parse(z.object({ emoji: z.string().min(1).max(8) }), req.body).emoji))))
r.post('/messages/:id/pin', asyncH(async (req, res) => res.json(await togglePin(req.actor, req.params.id))))
r.post('/messages/:id/relay', asyncH(async (req, res) => res.status(201).json(await relayMessage(req.actor, { messageId: req.params.id, ...parse(z.object({ toGroupId: z.string(), note: z.string().max(500).optional(), confirm: z.boolean().optional() }), req.body) }))))
r.post('/messages/:id/report', asyncH(async (req, res) => {
  const m = await Message.findById(req.params.id).lean()
  if (!m) throw new AppError('NOT_FOUND', 404)
  const p = parse(z.object({ reason: z.string(), note: z.string().max(1000).optional(), messageIds: z.array(z.string()).max(5).optional() }), req.body)
  res.status(201).json(await createReport(req.actor, { groupId: String(m.groupId), messageIds: p.messageIds?.length ? p.messageIds : [req.params.id], reason: p.reason, note: p.note }))
}))
r.post('/messages/:id/save', asyncH(async (req, res) => { const { User } = await import('../models/index.js'); await User.updateOne({ _id: req.actor._id, 'saved.refId': { $ne: req.params.id } }, { $push: { saved: { kind: 'message', refId: req.params.id } } }); res.json({ ok: true }) }))

// CR relay status (MSG-17): which messages were relayed, by whom, when
r.get('/groups/:id/relay-status', asyncH(async (req, res) => {
  const g = await Group.findById(req.params.id).lean()
  const m = await Membership.findOne({ groupId: g._id, userId: req.actor._id }).lean()
  const v = canRead(req.actor, g, m)
  if (!v.allow) throw new AppError(v.code, 403)
  const msgs = await Message.find({ groupId: g._id, 'relayedTo.0': { $exists: true } }).sort({ createdAt: -1 }).limit(50).lean()
  const unrelayed = await Message.find({ groupId: g._id, relayedTo: { $size: 0 }, deletedAt: null, threadOf: null, kind: 'TEXT' }).sort({ createdAt: -1 }).limit(10).lean()
  res.json({ relayed: msgs.map((x) => ({ ...serializeMessage(x), relayedTo: x.relayedTo })), pending: unrelayed.map((x) => serializeMessage(x)) })
}))
// coordinators nudging CRs: which CRs relayed an announcement forwarded to CRs — CS (F-17)
r.get('/messages/:id/relays', asyncH(async (req, res) => {
  const src = await Message.findById(req.params.id).lean()
  if (!src) throw new AppError('NOT_FOUND', 404)
  const g = await Group.findById(src.groupId).lean()
  const m = await Membership.findOne({ groupId: g._id, userId: req.actor._id }).lean()
  if (!canRead(req.actor, g, m).allow) throw new AppError('NOT_MEMBER', 403)
  const copies = await Message.find({ 'relayOf.messageId': src._id }).lean()
  res.json({ relayedBatches: copies.map((c) => ({ groupId: String(c.groupId), by: c.senderSnapshot?.name, at: c.createdAt })) })
}))

// DMs & custom groups
r.post('/dm/open', asyncH(async (req, res) => res.json(await openDm(req.actor, parse(z.object({ userId: z.string() }), req.body).userId))))
r.post('/groups', asyncH(async (req, res) => res.status(201).json(await createCustomGroup(req.actor, parse(z.object({ name: z.string().min(1).max(80), purpose: z.string().max(300).optional(), memberIds: z.array(z.string()).default([]) }), req.body))))) // MSG-16
r.put('/groups/:id/members', asyncH(async (req, res) => res.json(await updateCustomMembers(req.actor, req.params.id, parse(z.object({ add: z.array(z.string()).default([]), remove: z.array(z.string()).default([]) }), req.body)))))
r.post('/groups/:id/leave', asyncH(async (req, res) => res.json(await leaveGroup(req.actor, req.params.id))))
r.post('/groups/:id/archive', asyncH(async (req, res) => res.json(await archiveCustomGroup(req.actor, req.params.id))))

export default r
