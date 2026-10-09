import { Router } from 'express'
import { z } from 'zod'
import { asyncH } from '../lib/util.js'
import { parse } from '../lib/http.js'
import { console_, dispatch, breakdown, remind, validateKeypad } from '../services/exam.js'

const r = Router()
r.get('/exam/console', asyncH(async (req, res) => res.json(await console_(req.actor, { filter: String(req.query.filter ?? 'ALL').toUpperCase() }))))
r.post('/exam/circulars', asyncH(async (req, res) => res.status(201).json(await dispatch(req.actor, parse(z.object({ title: z.string().min(3), body: z.string(), category: z.string().optional(), batchCodes: z.array(z.string()).optional(), audienceLabel: z.string().optional(), attachments: z.array(z.any()).optional(), expiresAt: z.coerce.date().optional(), mandatoryAck: z.boolean().optional(), pinned: z.boolean().optional(), refNo: z.string().optional() }), req.body))))) 
r.get('/exam/circulars/:id/breakdown', asyncH(async (req, res) => res.json(await breakdown(req.actor, req.params.id))))
r.post('/exam/circulars/:id/remind', asyncH(async (req, res) => res.json(await remind(req.actor, req.params.id))))
r.post('/exam/keypad/validate', asyncH(async (req, res) => res.json(await validateKeypad(req.actor, req.body ?? {}))))
export default r
