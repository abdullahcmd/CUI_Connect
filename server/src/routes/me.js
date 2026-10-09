import { Router } from 'express'
import { z } from 'zod'
import { User, Notification, Announcement, ChannelPost, Message } from '../models/index.js'
import { asyncH } from '../lib/util.js'
import { parse } from '../lib/http.js'
import { AppError } from '../lib/errors.js'
import { buildMe, buildSidebar } from '../services/sidebar.js'
import { loadActors, publicCard } from '../services/actors.js'
import { toUser } from '../lib/realtime.js'
import { directory } from '../services/users.js'
import { dmContext } from '../services/messages.js'

const r = Router()

r.get('/me', asyncH(async (req, res) => res.json(await buildMe(req.actor))))
r.get('/me/sidebar', asyncH(async (req, res) => res.json(await buildSidebar(req.actor))))

r.patch('/me/settings', asyncH(async (req, res) => {
  const s = parse(z.object({ theme: z.enum(['light', 'dark', 'system']).optional(), density: z.enum(['default', 'compact']).optional(), language: z.enum(['en', 'ur']).optional(), quietHours: z.object({ start: z.string(), end: z.string() }).optional(), notifications: z.record(z.enum(['all', 'mentions', 'off'])).optional() }), req.body)
  const upd = {}
  for (const [k, v] of Object.entries(s)) {
    if (k === 'notifications') {
      // board posts and escalations can never be fully muted
      for (const [section, mode] of Object.entries(v)) { if (['board', 'escalations'].includes(section) && mode === 'off') throw new AppError('VALIDATION_FAILED', 422, { reason: 'Announcements and escalations can’t be fully muted.' }); upd[`settings.notifications.${section}`] = mode }
    } else upd[`settings.${k}`] = v
  }
  await User.updateOne({ _id: req.actor._id }, { $set: upd })
  toUser(req.actor.id, 'settings:changed', s)
  res.json({ ok: true })
}))

r.get('/me/blocked', asyncH(async (req, res) => {
  const actors = await loadActors(req.actor.blocked)
  res.json(actors.map(publicCard))
}))
r.post('/blocks/:userId', asyncH(async (req, res) => { await User.updateOne({ _id: req.actor._id }, { $addToSet: { blocked: req.params.userId } }); res.json({ ok: true }) }))
r.delete('/blocks/:userId', asyncH(async (req, res) => { await User.updateOne({ _id: req.actor._id }, { $pull: { blocked: req.params.userId } }); res.json({ ok: true }) }))

// ---- notifications / activity (APP-03)
r.get('/notifications', asyncH(async (req, res) => {
  const items = await Notification.find({ userId: req.actor._id }).sort({ createdAt: -1 }).limit(Math.min(Number(req.query.limit ?? 50), 100)).lean()
  res.json({ items: items.map((n) => ({ id: String(n._id), type: n.type, title: n.title, body: n.body, link: n.link, read: !!n.readAt, mutable: n.mutable, at: n.createdAt })), unread: items.filter((n) => !n.readAt).length })
}))
r.post('/notifications/read', asyncH(async (req, res) => {
  const ids = req.body?.ids
  await Notification.updateMany({ userId: req.actor._id, readAt: null, ...(ids ? { _id: { $in: ids } } : {}) }, { readAt: new Date() })
  res.json({ ok: true })
}))

// ---- saved items (APP-11)
r.get('/me/saved', asyncH(async (req, res) => {
  const u = await User.findById(req.actor._id).lean()
  const out = []
  for (const s of u.saved ?? []) {
    if (s.kind === 'announcement') { const a = await Announcement.findById(s.refId).lean(); if (a) out.push({ kind: 'announcement', id: String(a._id), title: a.title, at: s.at }) }
    if (s.kind === 'message') { const m = await Message.findById(s.refId).lean(); if (m && !m.deletedAt) out.push({ kind: 'message', id: String(m._id), groupId: String(m.groupId), snippet: m.body.slice(0, 140), at: s.at }) }
  }
  const posts = await ChannelPost.find({ savedBy: req.actor._id }).lean()
  for (const p of posts) out.push({ kind: 'channelPost', id: String(p._id), title: p.title, applyBy: p.applyBy })
  res.json(out)
}))
r.post('/me/saved', asyncH(async (req, res) => {
  const { kind, refId } = parse(z.object({ kind: z.enum(['announcement', 'message']), refId: z.string() }), req.body)
  await User.updateOne({ _id: req.actor._id, 'saved.refId': { $ne: refId } }, { $push: { saved: { kind, refId } } })
  res.json({ ok: true })
}))
r.delete('/me/saved/:refId', asyncH(async (req, res) => { await User.updateOne({ _id: req.actor._id }, { $pull: { saved: { refId: req.params.refId } } }); res.json({ ok: true }) }))

// ---- people picker / profile card
r.get('/people', asyncH(async (req, res) => res.json(await directory(req.actor, { q: String(req.query.q ?? ''), limit: Number(req.query.limit ?? 20) }, await dmContext()))))
r.get('/people/:id', asyncH(async (req, res) => {
  const [t] = await loadActors([req.params.id])
  if (!t) throw new AppError('NOT_FOUND', 404)
  const { canDM } = await import('../policy/index.js')
  const v = await canDM(req.actor, t, await dmContext())
  res.json({ ...publicCard(t), dm: { allowed: v.allow, route: v.meta?.route } })
}))

export default r
