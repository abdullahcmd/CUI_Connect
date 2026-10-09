import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import { env } from './config/env.js'
import { requireAuth } from './lib/auth.js'
import { errorHandler } from './lib/http.js'
import { AppError } from './lib/errors.js'
import { asyncH } from './lib/util.js'
import { Mail, Setting } from './models/index.js'
import { has } from './policy/roles.js'
import authRoutes from './routes/auth.js'
import meRoutes from './routes/me.js'
import groupRoutes from './routes/groups.js'
import boardRoutes from './routes/board.js'
import channelRoutes from './routes/channels.js'
import deskRoutes from './routes/desks.js'
import examRoutes from './routes/exam.js'
import deptRoutes from './routes/dept.js'
import adminRoutes from './routes/admin.js'
import miscRoutes from './routes/misc.js'

export function createApp() {
  const app = express()
  app.set('trust proxy', 1)
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' }, hsts: env.isProd || !!env.tlsCert ? { maxAge: 31536000, includeSubDomains: true } : false }))
  app.use(cors({ origin: env.clientUrl, credentials: true }))
  app.use(express.json({ limit: '1mb' }))
  if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'))

  app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'cui-connect', time: new Date().toISOString() }))

  // dev-only outbox so activation mails and password codes are readable without SMTP
  app.get('/api/dev/mailbox', asyncH(async (req, res) => {
    if (env.isProd) throw new AppError('NOT_FOUND', 404)
    const q = req.query.to ? { to: String(req.query.to) } : {}
    res.json((await Mail.find(q).sort({ createdAt: -1 }).limit(30).lean()).map((m) => ({ to: m.to, subject: m.subject, body: m.body, at: m.createdAt })))
  }))

  app.get('/api/status', asyncH(async (_req, res) => { // AUTH-10: lets the client show the maintenance page before sign-in
    const sys = (await Setting.findOne({ key: 'system' }).lean())?.value
    res.json({ maintenance: !!sys?.maintenance?.enabled, message: sys?.maintenance?.message ?? '', term: 'FA26' })
  }))
  app.use('/api/auth', authRoutes)

  const api = express.Router()
  api.use(requireAuth)
  api.use(asyncH(async (req, res, next) => { // maintenance + forced activation
    const sys = (await Setting.findOne({ key: 'system' }).lean())?.value
    if (sys?.maintenance?.enabled && !has(req.actor, 'SUPER_ADMIN')) throw new AppError('MAINTENANCE', 503, { message: sys.maintenance.message || 'CUI Connect is under maintenance.' })
    if (req.actor.mustChangePassword && !req.path.startsWith('/me')) throw new AppError('ACTIVATION_REQUIRED', 403, { message: 'Set a new password to continue.' })
    next()
  }))
  for (const r of [meRoutes, groupRoutes, boardRoutes, channelRoutes, deskRoutes, examRoutes, deptRoutes, adminRoutes, miscRoutes]) api.use(r)
  app.use('/api', api)

  app.use((_req, _res, next) => next(new AppError('NOT_FOUND', 404)))
  app.use(errorHandler)
  return app
}
