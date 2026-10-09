import { Router } from 'express'
import { z } from 'zod'
import { asyncH } from '../lib/util.js'
import { parse } from '../lib/http.js'
import { listBoard, getAnnouncement, publishAnnouncement, editAnnouncement, deleteAnnouncement, acknowledge, ackReport, ackCsv, forwardAnnouncement, nudgeViaCrLine, remindNonAcked, versions, audienceOf } from '../services/board.js'
import { publishableScopes } from '../services/sidebar.js'
import { Announcement } from '../models/index.js'
import { org } from '../services/org.js'
import { CATEGORIES } from '../models/board.js'

const r = Router()
const att = z.object({ id: z.string().optional(), name: z.string(), size: z.number().optional(), mime: z.string().optional(), url: z.string(), sha256: z.string().optional() })
const PublishBody = z.object({
  scopeId: z.string(), category: z.enum(CATEGORIES).default('GENERAL'), title: z.string().min(3).max(300), body: z.string().max(20000).default(''), attachments: z.array(att).max(10).optional(),
  effectiveFrom: z.coerce.date().optional(), expiresAt: z.coerce.date().optional(), pinned: z.boolean().optional(), mandatoryAck: z.boolean().optional(), forwardToCRs: z.boolean().optional(),
  refNo: z.string().optional(), draft: z.boolean().optional(), batchCodes: z.array(z.string()).optional(),
})

r.get('/board', asyncH(async (req, res) => res.json(await listBoard(req.actor, { scope: req.query.scope, category: req.query.category, before: req.query.before, limit: Number(req.query.limit ?? 30) }))))
r.get('/board/archive', asyncH(async (req, res) => res.json(await listBoard(req.actor, { archive: true, category: req.query.category }))))
r.get('/board/scopes', asyncH(async (req, res) => {
  const scopes = await publishableScopes(req.actor)
  const out = []
  for (const s of scopes) { const a = await audienceOf({ scopeId: s.id }); out.push({ ...s, audienceCount: a.length }) }
  res.json({ scopes: out, categories: CATEGORIES })
}))
r.post('/board/audience', asyncH(async (req, res) => { const a = await audienceOf({ scopeId: req.body.scopeId, targetBatchIds: (req.body.batchCodes ?? []).map((c) => org.byCode(c)?._id).filter(Boolean) }); res.json({ count: a.length }) }))
r.get('/board/telemetry', asyncH(async (req, res) => {
  // active circulars the user published (BRD-05 right rail)
  const mine = await Announcement.find({ authorId: req.actor._id, status: 'PUBLISHED' }).sort({ createdAt: -1 }).limit(5).lean()
  const list = []
  for (const a of mine) list.push(await ackReport(req.actor, String(a._id)).then((rep) => ({ id: String(a._id), title: a.title, refNo: a.refNo, number: a.number, createdAt: a.createdAt, ...rep, people: undefined })))
  res.json(list)
}))
r.post('/board', asyncH(async (req, res) => {
  const b = parse(PublishBody, req.body)
  const targetBatchIds = (b.batchCodes ?? []).map((c) => org.byCode(c)?._id).filter(Boolean)
  res.status(201).json(await publishAnnouncement(req.actor, { ...b, targetBatchIds }))
}))
r.get('/board/:id', asyncH(async (req, res) => res.json(await getAnnouncement(req.actor, req.params.id))))
r.patch('/board/:id', asyncH(async (req, res) => res.json(await editAnnouncement(req.actor, req.params.id, parse(PublishBody.partial(), req.body)))))
r.delete('/board/:id', asyncH(async (req, res) => res.json(await deleteAnnouncement(req.actor, req.params.id))))
r.post('/board/:id/ack', asyncH(async (req, res) => res.json(await acknowledge(req.actor, req.params.id))))
r.get('/board/:id/acks', asyncH(async (req, res) => res.json(await ackReport(req.actor, req.params.id))))
r.get('/board/:id/acks.csv', asyncH(async (req, res) => { res.type('text/csv').attachment('acknowledgements.csv').send(await ackCsv(req.actor, req.params.id)) }))
r.get('/board/:id/versions', asyncH(async (req, res) => res.json(await versions(req.actor, req.params.id))))
r.post('/board/:id/forward', asyncH(async (req, res) => res.json(await forwardAnnouncement(req.actor, req.params.id))))
r.post('/board/:id/nudge', asyncH(async (req, res) => res.json(await nudgeViaCrLine(req.actor, req.params.id, req.body ?? {}))))
r.post('/board/:id/remind', asyncH(async (req, res) => res.json(await remindNonAcked(req.actor, req.params.id))))

export default r
