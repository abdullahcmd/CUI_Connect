import { Router } from 'express'
import { z } from 'zod'
import { asyncH } from '../lib/util.js'
import { parse } from '../lib/http.js'
import { desksFor } from '../services/sidebar.js'
import { deskProfile, createTicket, myTickets, ticketDetail, replyTicket, assignTicket, escalateTicket, resolveTicket, reopenTicket, queue, deskReports, updateDeskSettings } from '../services/tickets.js'

const r = Router()
const att = z.object({ id: z.string().optional(), name: z.string(), size: z.number().optional(), mime: z.string().optional(), url: z.string() })

r.get('/desks', asyncH(async (req, res) => res.json(await desksFor(req.actor))))
r.get('/desks/:slug', asyncH(async (req, res) => res.json(await deskProfile(req.actor, req.params.slug))))
r.get('/desks/:slug/queue', asyncH(async (req, res) => res.json(await queue(req.actor, req.params.slug, { status: req.query.status, category: req.query.category, assignee: req.query.assignee, q: req.query.q, sort: req.query.sort, page: Number(req.query.page ?? 1) }))))
r.get('/desks/:slug/reports', asyncH(async (req, res) => res.json(await deskReports(req.actor, req.params.slug))))
r.patch('/desks/:slug/settings', asyncH(async (req, res) => res.json(await updateDeskSettings(req.actor, req.params.slug, req.body))))

r.get('/tickets/mine', asyncH(async (req, res) => res.json(await myTickets(req.actor))))
r.post('/tickets', asyncH(async (req, res) => res.status(201).json(await createTicket(req.actor, parse(z.object({ deskSlug: z.string(), category: z.string().min(2), subject: z.string().min(3).max(200), description: z.string().max(8000).optional(), attachments: z.array(att).max(5).optional(), linkedPostId: z.string().optional(), force: z.boolean().optional() }), req.body)))))
r.get('/tickets/:id', asyncH(async (req, res) => res.json(await ticketDetail(req.actor, req.params.id))))
r.post('/tickets/:id/reply', asyncH(async (req, res) => res.status(201).json(await replyTicket(req.actor, req.params.id, parse(z.object({ body: z.string().max(8000).default(''), internal: z.boolean().optional(), attachments: z.array(att).optional() }), req.body)))))
r.post('/tickets/:id/assign', asyncH(async (req, res) => res.json(await assignTicket(req.actor, req.params.id, req.body?.assigneeId))))
r.post('/tickets/:id/escalate', asyncH(async (req, res) => res.json(await escalateTicket(req.actor, req.params.id, parse(z.object({ reason: z.string().min(3) }), req.body).reason))))
r.post('/tickets/:id/resolve', asyncH(async (req, res) => res.json(await resolveTicket(req.actor, req.params.id, parse(z.object({ note: z.string().min(3) }), req.body).note))))
r.post('/tickets/:id/reopen', asyncH(async (req, res) => res.json(await reopenTicket(req.actor, req.params.id))))
export default r
