import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { env } from '../config/env.js'
import { AppError } from './errors.js'
import { loadActor } from '../services/actors.js'
import { asyncH } from './util.js'

export const signAccess = (user) => jwt.sign({ sub: String(user._id) }, env.jwtSecret, { expiresIn: env.accessTtl })
export const verifyAccess = (token) => jwt.verify(token, env.jwtSecret)
export const hashPassword = (pw) => bcrypt.hash(pw, 10)
export const checkPassword = (pw, hash) => bcrypt.compare(pw, hash)

export const COMMON_PASSWORDS = ['password', 'password123', '1234567890', 'qwertyuiop', 'letmein123', 'comsats123']
export function assertStrongPassword(pw, uid) {
  if (!pw || pw.length < 10) throw new AppError('VALIDATION_FAILED', 422, { field: 'password', reason: 'At least 10 characters.' })
  if (uid && pw.toLowerCase().includes(String(uid).toLowerCase())) throw new AppError('VALIDATION_FAILED', 422, { field: 'password', reason: "Can't contain your ID." })
  if (COMMON_PASSWORDS.includes(pw.toLowerCase())) throw new AppError('VALIDATION_FAILED', 422, { field: 'password', reason: 'Too common.' })
}

/** Express middleware: verifies the bearer token and attaches req.actor (user + role assignments). */
export const requireAuth = asyncH(async (req, _res, next) => {
  const h = req.headers.authorization ?? ''
  const token = h.startsWith('Bearer ') ? h.slice(7) : req.query.token
  if (!token) throw new AppError('UNAUTHENTICATED', 401)
  let payload
  try { payload = verifyAccess(token) } catch { throw new AppError('UNAUTHENTICATED', 401) }
  const actor = await loadActor(payload.sub)
  if (!actor) throw new AppError('UNAUTHENTICATED', 401)
  if (actor.status === 'SUSPENDED') throw new AppError('ACCOUNT_SUSPENDED', 403)
  req.actor = actor
  next()
})

export const requireRole = (...roles) => (req, _res, next) =>
  roles.some((r) => req.actor.roles.some((x) => x.role === r)) ? next() : next(new AppError('FORBIDDEN', 403))
