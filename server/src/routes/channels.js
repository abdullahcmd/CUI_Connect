import { Router } from 'express'
import { z } from 'zod'
import { asyncH } from '../lib/util.js'
import { parse } from '../lib/http.js'
import { AppError } from '../lib/errors.js'
import { Channel } from '../models/index.js'
import { browse, feed, channelDetail, follow, setMute, submitPost, moderationQueue, reviewPost, mySubmissions, toggleInterest, insights, audienceCount, canManageChannel } from '../services/channels.js'
import { org } from '../services/org.js'
import { audit } from '../lib/audit.js'

const r = Router()
const att = z.object({ id: z.string().optional(), name: z.string(), size: z.number().optional(), mime: z.string().optional(), url: z.string(), label: z.string().optional() })
const Target = z.object({ programs: z.array(z.string()).optional(), intakes: z.array(z.enum(['FA', 'SP'])).optional(), years: z.array(z.number()).optional(), batchCodes: z.array(z.string()).optional(), semesterMin: z.number().optional(), semesterMax: z.number().optional(), all: z.boolean().optional() })
const PostBody = z.object({ title: z.string().min(3).max(300), body: z.string().max(10000).optional(), attachments: z.array(att).max(5).optional(), target: Target.optional(), eligibility: z.string().optional(), checklist: z.array(z.string()).optional(), applyBy: z.coerce.date().optional(), urgent: z.boolean().optional(), eventDate: z.coerce.date().optional(), cutoff: z.coerce.date().optional(), refNo: z.string().optional(), scopeNote: z.string().optional() })
const normTarget = (t) => t && ({ ...t, batchIds: (t.batchCodes ?? []).map((c) => org.byCode(c)?._id).filter(Boolean) })

r.get('/channels', asyncH(async (req, res) => res.json(await browse(req.actor))))
r.get('/channels/feed', asyncH(async (req, res) => res.json(await feed(req.actor, { before: req.query.before }))))
r.get('/channels/moderation', asyncH(async (req, res) => res.json(await moderationQueue(req.actor))))
r.get('/channels/submissions', asyncH(async (req, res) => res.json(await mySubmissions(req.actor))))
r.post('/channels/audience', asyncH(async (req, res) => res.json({ count: await audienceCount(normTarget(parse(Target, req.body))) })))
r.get('/channels/:slug', asyncH(async (req, res) => res.json(await channelDetail(req.actor, req.params.slug))))
r.get('/channels/:slug/insights', asyncH(async (req, res) => res.json(await insights(req.actor, req.params.slug))))
r.post('/channels/:id/follow', asyncH(async (req, res) => res.json(await follow(req.actor, req.params.id, true))))
r.delete('/channels/:id/follow', asyncH(async (req, res) => res.json(await follow(req.actor, req.params.id, false))))
r.post('/channels/:id/mute', asyncH(async (req, res) => res.json(await setMute(req.actor, req.params.id, req.body?.muted !== false))))
r.post('/channels/:id/posts', asyncH(async (req, res) => { const b = parse(PostBody, req.body); res.status(201).json(await submitPost(req.actor, req.params.id, { ...b, target: normTarget(b.target) })) }))
r.post('/channel-posts/:id/interest', asyncH(async (req, res) => res.json(await toggleInterest(req.actor, req.params.id, 'interest'))))
r.post('/channel-posts/:id/save', asyncH(async (req, res) => res.json(await toggleInterest(req.actor, req.params.id, 'save'))))
r.post('/channel-posts/:id/approve', asyncH(async (req, res) => res.json(await reviewPost(req.actor, req.params.id, { action: 'approve', edits: req.body?.edits }))))
r.post('/channel-posts/:id/reject', asyncH(async (req, res) => res.json(await reviewPost(req.actor, req.params.id, { action: 'reject', reason: parse(z.object({ reason: z.string().min(2) }), req.body).reason }))))
r.patch('/channels/:id/settings', asyncH(async (req, res) => {
  const c = await Channel.findById(req.params.id)
  if (!c) throw new AppError('NOT_FOUND', 404)
  if (!canManageChannel(req.actor, c)) throw new AppError('FORBIDDEN', 403)
  const p = parse(z.object({ name: z.string().optional(), description: z.string().optional(), joinMode: z.enum(['AUTO_LOCKED', 'AUTO_MUTE', 'OPT_IN']).optional(), requireApproval: z.boolean().optional(), publisherIds: z.array(z.string()).optional(), contact: z.any().optional() }), req.body)
  Object.assign(c, p); await c.save()
  await audit(req.actor, 'channel.settings', { category: 'structure', target: { kind: 'channel', id: String(c._id), label: c.name } })
  res.json({ ok: true })
}))
export default r
