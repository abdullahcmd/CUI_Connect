import { Server } from 'socket.io'
import { z } from 'zod'
import { env } from '../config/env.js'
import { verifyAccess } from '../lib/auth.js'
import { loadActor } from '../services/actors.js'
import { setIo, toRoom } from '../lib/realtime.js'
import { desiredRooms } from './rooms.js'
import { User, Group, Membership, Message, Desk } from '../models/index.js'
import { on } from './guard.js'
import { AppError } from '../lib/errors.js'
import { canRead, canPost, isManager } from '../policy/index.js'
import { hasAny } from '../policy/roles.js'
import { listMessages, sendMessage, relayMessage, editMessage, deleteMessage, markRead, openDm, toggleReaction, togglePin, serializeMessage } from '../services/messages.js'
import { groupSummary } from '../services/sidebar.js'
import { publishAnnouncement, acknowledge, forwardAnnouncement } from '../services/board.js'
import { createTicket, replyTicket, escalateTicket, resolveTicket, assignTicket, ticketDetail, reopenTicket } from '../services/tickets.js'
import { submitPost, follow, toggleInterest } from '../services/channels.js'
import { desksFor } from '../services/sidebar.js'
import { hit } from '../lib/util.js'
import { onlineUserIds } from '../lib/realtime.js'
import { Report, User as U, Ticket } from '../models/index.js'

const id = z.string().min(12)
const att = z.object({ id: z.string().optional(), name: z.string(), size: z.number().optional(), mime: z.string().optional(), url: z.string(), sha256: z.string().optional() })
const S = {
  open: z.object({ groupId: id, limit: z.number().int().min(1).max(100).optional() }),
  send: z.object({ groupId: id, body: z.string().max(8000).default(''), attachments: z.array(att).max(10).optional(), replyTo: id.optional(), threadOf: id.optional(), mentions: z.array(id).optional(), clientId: z.string().max(80).optional() }),
  relay: z.object({ messageId: id, toGroupId: id, note: z.string().max(500).optional(), confirm: z.boolean().optional() }),
  edit: z.object({ messageId: id, body: z.string().min(1).max(8000) }),
  del: z.object({ messageId: id, reason: z.string().max(300).optional() }),
  read: z.object({ groupId: id, lastMessageId: id.optional() }),
  typing: z.object({ groupId: id, state: z.enum(['start', 'stop']) }),
  announce: z.object({ groupId: id, on: z.boolean() }),
  dm: z.object({ userId: id }),
  react: z.object({ messageId: id, emoji: z.string().min(1).max(8) }),
  pin: z.object({ messageId: id }),
  publish: z.object({ scopeId: id, category: z.string().default('GENERAL'), title: z.string().min(3).max(300), body: z.string().default(''), attachments: z.array(att).optional(), effectiveFrom: z.coerce.date().optional(), expiresAt: z.coerce.date().optional(), pinned: z.boolean().optional(), mandatoryAck: z.boolean().optional(), forwardToCRs: z.boolean().optional() }),
  ann: z.object({ announcementId: id }),
  forward: z.object({ announcementId: id, groupId: id.optional() }),
  tcreate: z.object({ deskSlug: z.string(), category: z.string(), subject: z.string().min(3), description: z.string().optional(), attachments: z.array(att).optional(), force: z.boolean().optional() }),
  topen: z.object({ ticketId: id }),
  treply: z.object({ ticketId: id, body: z.string().default(''), internal: z.boolean().optional(), attachments: z.array(att).optional() }),
  tesc: z.object({ ticketId: id, reason: z.string().min(3) }),
  tres: z.object({ ticketId: id, note: z.string().min(3) }),
  tassign: z.object({ ticketId: id, assigneeId: id.optional() }),
  cpub: z.object({ channelId: id, title: z.string().min(3), body: z.string().optional(), target: z.any().optional(), applyBy: z.coerce.date().optional(), eligibility: z.string().optional(), attachments: z.array(att).optional() }),
  cfollow: z.object({ channelId: id, on: z.boolean() }),
  cint: z.object({ postId: id }),
}

export async function initSockets(httpServer) {
  const io = new Server(httpServer, { cors: { origin: env.clientUrl, credentials: true }, pingInterval: 20000, pingTimeout: 20000 })
  if (env.redisUrl) {
    try {
      const { createClient } = await import('redis')
      const { createAdapter } = await import('@socket.io/redis-adapter')
      const pub = createClient({ url: env.redisUrl }); const sub = pub.duplicate()
      await Promise.all([pub.connect(), sub.connect()])
      io.adapter(createAdapter(pub, sub))
      console.log('socket.io: redis adapter on')
    } catch (e) { console.warn('redis adapter unavailable, continuing single-node:', e.message) }
  }
  setIo(io)

  // handshake: no valid JWT → no socket
  io.use(async (socket, next) => {
    try {
      const payload = verifyAccess(socket.handshake.auth?.token)
      const actor = await loadActor(payload.sub)
      if (!actor || ['SUSPENDED', 'INACTIVE'].includes(actor.status)) return next(new Error('UNAUTHENTICATED'))
      if (actor.mustChangePassword) return next(new Error('ACTIVATION_REQUIRED'))
      socket.data.user = actor
      next()
    } catch { next(new Error('UNAUTHENTICATED')) }
  })

  io.on('connection', async (socket) => {
    const user = socket.data.user
    // handlers are registered synchronously below; the async room setup runs after them so an early client emit is never dropped

    // ---- groups & messages
    on(socket, 'group:open', S.open, async (u, { groupId, limit }) => {
      const sum = await groupSummary(u, groupId) // throws NOT_MEMBER / canRead denial
      socket.join(`group:${groupId}`) // server-side join only after canRead
      const { items, hasMore } = await listMessages(u, groupId, { limit: limit ?? 30 })
      return { summary: sum, messages: items, hasMore }
    })
    on(socket, 'message:send', S.send, (u, p) => sendMessage(u, p))
    on(socket, 'message:relay', S.relay, (u, p) => relayMessage(u, p))
    on(socket, 'message:edit', S.edit, (u, p) => editMessage(u, p.messageId, p.body))
    on(socket, 'message:delete', S.del, (u, p) => deleteMessage(u, p.messageId, p.reason))
    on(socket, 'message:read', S.read, (u, p) => markRead(u, p.groupId, p.lastMessageId))
    on(socket, 'message:react', S.react, (u, p) => toggleReaction(u, p.messageId, p.emoji))
    on(socket, 'message:pin', S.pin, (u, p) => togglePin(u, p.messageId))
    on(socket, 'typing', S.typing, async (u, { groupId, state }) => {
      if (!hit(`typing:${u.id}:${groupId}`, 4, 5000)) return { throttled: true }
      const g = await Group.findById(groupId).lean(); const m = await Membership.findOne({ groupId, userId: u._id }).lean()
      if (!g || !canPost(u, g, m).allow) return { ok: false }
      socket.to(`group:${groupId}`).emit('typing', { groupId, userId: u.id, name: u.name, state })
      return { ok: true }
    })
    on(socket, 'group:announceOnly', S.announce, async (u, { groupId, on: flag }) => {
      const g = await Group.findById(groupId); const m = await Membership.findOne({ groupId, userId: u._id }).lean()
      if (!g) throw new AppError('NOT_FOUND', 404)
      if (!isManager(u, g, m)) throw new AppError('FORBIDDEN', 403)
      g.announceOnly = flag; await g.save()
      toRoom(`group:${groupId}`, 'group:changed', { groupId, announceOnly: flag, manager: g.manager })
      return { ok: true }
    })
    on(socket, 'dm:open', S.dm, (u, p) => openDm(u, p.userId))

    // ---- board
    on(socket, 'board:publish', S.publish, (u, p) => publishAnnouncement(u, p))
    on(socket, 'board:acknowledge', S.ann, (u, p) => acknowledge(u, p.announcementId))
    on(socket, 'board:forward', S.forward, (u, p) => forwardAnnouncement(u, p.announcementId))

    // ---- desks & tickets
    on(socket, 'ticket:create', S.tcreate, async (u, p) => { const out = await createTicket(u, p); socket.join(`ticket:${out.ticket.id}`); return out })
    on(socket, 'ticket:open', S.topen, async (u, p) => { const d = await ticketDetail(u, p.ticketId); socket.join(`ticket:${p.ticketId}`); return d })
    on(socket, 'ticket:reply', S.treply, (u, p) => replyTicket(u, p.ticketId, p))
    on(socket, 'ticket:escalate', S.tesc, (u, p) => escalateTicket(u, p.ticketId, p.reason))
    on(socket, 'ticket:resolve', S.tres, (u, p) => resolveTicket(u, p.ticketId, p.note))
    on(socket, 'ticket:assign', S.tassign, (u, p) => assignTicket(u, p.ticketId, p.assigneeId))
    on(socket, 'ticket:reopen', S.topen, (u, p) => reopenTicket(u, p.ticketId))

    // ---- channels
    on(socket, 'channel:publish', S.cpub, (u, p) => submitPost(u, p.channelId, p))
    on(socket, 'channel:follow', S.cfollow, async (u, p) => { const r = await follow(u, p.channelId, p.on); if (p.on) socket.join(`channel:${p.channelId}`); else socket.leave(`channel:${p.channelId}`); return r })
    on(socket, 'channel:interest', S.cint, async (u, p) => toggleInterest(u, p.postId, 'interest'))
    on(socket, 'channel:save', S.cint, async (u, p) => toggleInterest(u, p.postId, 'save'))

    ;(async () => {
      const rooms = await desiredRooms(user)
      socket.join([...rooms])
      const desks = await desksFor(user)
      for (const d of desks.filter((x) => x.mode === 'agent')) socket.join(`desk:${d.id}:agents`)
      socket.emit('ready', { userId: user.id, rooms: [...rooms].length })
      broadcastPresence(io, socket, user, true)
    })().catch((e) => console.error('socket setup failed', e))

    socket.on('presence:who', async (_p, ack) => ack?.({ ok: true, data: [...(await onlineUserIds())] }))

    socket.on('disconnect', async () => {
      await U.updateOne({ _id: user._id }, { lastSeenAt: new Date() })
      const stillOnline = (await io.in(`user:${user.id}`).fetchSockets()).length > 0
      if (!stillOnline) broadcastPresence(io, socket, user, false)
    })
  })

  // /admin namespace: live counters for the console
  const adminNs = io.of('/admin')
  adminNs.use(async (socket, next) => {
    try {
      const actor = await loadActor(verifyAccess(socket.handshake.auth?.token).sub)
      if (!actor || !hasAny(actor, ['ADMIN', 'SUPER_ADMIN'])) return next(new Error('FORBIDDEN'))
      socket.data.user = actor; next()
    } catch { next(new Error('UNAUTHENTICATED')) }
  })
  adminNs.on('connection', async (socket) => {
    const send = async () => socket.emit('admin:counters', { online: (await onlineUserIds()).size, openReports: await Report.countDocuments({ status: { $in: ['OPEN', 'IN_REVIEW', 'ESCALATED'] } }), openTickets: await Ticket.countDocuments({ status: { $in: ['OPEN', 'IN_PROGRESS', 'ESCALATED'] } }) })
    await send(); const t = setInterval(send, 10_000); socket.on('disconnect', () => clearInterval(t))
  })
  return io
}

function broadcastPresence(io, socket, user, online) {
  for (const r of socket.rooms) if (r.startsWith('group:')) socket.to(r).emit('presence', { userId: user.id, online })
}
