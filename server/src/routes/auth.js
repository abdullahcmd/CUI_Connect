import { Router } from 'express'
import { z } from 'zod'
import { User, RefreshToken, PasswordReset } from '../models/index.js'
import { signAccess, checkPassword, hashPassword, assertStrongPassword, requireAuth } from '../lib/auth.js'
import { AppError } from '../lib/errors.js'
import { asyncH, sha256, randomToken, randomCode, hit, addDays, addHours } from '../lib/util.js'
import { parse } from '../lib/http.js'
import { env } from '../config/env.js'
import { audit } from '../lib/audit.js'
import { sendMail } from '../services/users.js'
import { disconnectUser } from '../lib/realtime.js'
import { loadActor } from '../services/actors.js'

const r = Router()
const MAX_FAILS = 5

async function issueTokens(user, req) {
  const refresh = randomToken(32)
  await RefreshToken.create({ userId: user._id, tokenHash: sha256(refresh), device: String(req.headers['user-agent'] ?? '').slice(0, 120), ip: req.ip, expiresAt: addDays(new Date(), env.refreshDays) })
  return { accessToken: signAccess(user), refreshToken: refresh, expiresIn: 900 }
}

r.post('/login', asyncH(async (req, res) => {
  const { uid, password } = parse(z.object({ uid: z.string().min(3), password: z.string().min(1) }), req.body)
  const key = uid.trim().toUpperCase()
  if (!hit(`login:${key}`, 5, 60_000)) throw new AppError('RATE_LIMITED', 429)
  const user = await User.findOne({ uid: key })
  // identical response whether or not the ID exists
  const bad = () => new AppError('INVALID_CREDENTIALS', 401, { message: 'Wrong ID or password.' })
  if (!user) throw bad()
  if (user.lockedUntil && user.lockedUntil > new Date()) throw new AppError('ACCOUNT_LOCKED', 423, { until: user.lockedUntil, message: 'Too many attempts. Try again in 15 minutes.' })
  if (!(await checkPassword(password, user.passwordHash))) {
    user.failedLogins += 1
    if (user.failedLogins >= MAX_FAILS) { user.lockedUntil = addHours(new Date(), 0.25); user.failedLogins = 0; await audit(user, 'auth.locked', { category: 'security' }) }
    await user.save()
    throw bad()
  }
  if (user.status === 'SUSPENDED') throw new AppError('ACCOUNT_SUSPENDED', 403, { reason: user.suspendedReason, contact: 'Admin Office · it-support@comsats.edu.pk', message: 'Your account is suspended. Contact the Admin Office.' })
  if (user.status === 'INACTIVE') throw new AppError('ACCOUNT_SUSPENDED', 403, { message: 'This account is no longer active.' })
  if (user.mustChangePassword && user.tempPasswordExpires && user.tempPasswordExpires < new Date())
    throw new AppError('TEMP_PASSWORD_EXPIRED', 401, { message: 'Your temporary password expired. Ask the Admin Office to resend activation.' })
  user.failedLogins = 0; user.lockedUntil = null; user.lastLoginAt = new Date()
  await user.save()
  const tokens = await issueTokens(user, req)
  const actor = await loadActor(user._id)
  await audit(actor, 'auth.login', { category: 'security', ip: req.ip })
  res.json({ ...tokens, mustChangePassword: user.mustChangePassword, user: { id: String(user._id), uid: user.uid, name: user.name } })
}))

r.post('/refresh', asyncH(async (req, res) => {
  const { refreshToken } = parse(z.object({ refreshToken: z.string().min(10) }), req.body)
  const row = await RefreshToken.findOne({ tokenHash: sha256(refreshToken) })
  if (!row) throw new AppError('UNAUTHENTICATED', 401)
  if (row.revokedAt) { await RefreshToken.updateMany({ userId: row.userId, revokedAt: null }, { revokedAt: new Date() }); throw new AppError('UNAUTHENTICATED', 401) } // reuse detected
  if (row.expiresAt < new Date()) throw new AppError('UNAUTHENTICATED', 401)
  const user = await User.findById(row.userId)
  if (!user || ['SUSPENDED', 'INACTIVE'].includes(user.status)) throw new AppError('ACCOUNT_SUSPENDED', 403)
  row.revokedAt = new Date()
  const next = await issueTokens(user, req)
  row.replacedBy = sha256(next.refreshToken); await row.save()
  res.json(next)
}))

r.post('/logout', asyncH(async (req, res) => {
  const { refreshToken } = req.body ?? {}
  if (refreshToken) await RefreshToken.updateOne({ tokenHash: sha256(refreshToken) }, { revokedAt: new Date() })
  res.json({ ok: true })
}))

r.post('/activate', requireAuth, asyncH(async (req, res) => {
  const { currentPassword, newPassword, acceptPolicy } = parse(z.object({ currentPassword: z.string(), newPassword: z.string(), acceptPolicy: z.literal(true) }), req.body)
  const user = await User.findById(req.actor._id)
  if (!(await checkPassword(currentPassword, user.passwordHash))) throw new AppError('INVALID_CREDENTIALS', 401, { message: 'The temporary password is wrong.' })
  if (await checkPassword(newPassword, user.passwordHash)) throw new AppError('VALIDATION_FAILED', 422, { field: 'newPassword', reason: 'Choose a password you have not used before.' })
  assertStrongPassword(newPassword, user.uid)
  user.passwordHash = await hashPassword(newPassword); user.mustChangePassword = false; user.tempPasswordExpires = null
  await user.save()
  await audit(req.actor, 'auth.activate', { category: 'security' })
  res.json({ ok: true })
}))

r.post('/change-password', requireAuth, asyncH(async (req, res) => {
  const { currentPassword, newPassword } = parse(z.object({ currentPassword: z.string(), newPassword: z.string() }), req.body)
  const user = await User.findById(req.actor._id)
  if (!(await checkPassword(currentPassword, user.passwordHash))) throw new AppError('INVALID_CREDENTIALS', 401, { message: 'Current password is wrong.' })
  assertStrongPassword(newPassword, user.uid)
  user.passwordHash = await hashPassword(newPassword); await user.save()
  await audit(req.actor, 'auth.change-password', { category: 'security' })
  res.json({ ok: true })
}))

r.post('/forgot', asyncH(async (req, res) => {
  const { uid } = parse(z.object({ uid: z.string().min(3) }), req.body)
  if (!hit(`forgot:${req.ip}`, 10, 60_000)) throw new AppError('RATE_LIMITED', 429)
  const user = await User.findOne({ uid: uid.trim().toUpperCase() })
  if (user && !['SUSPENDED', 'INACTIVE'].includes(user.status)) {
    const code = randomCode(6)
    await PasswordReset.create({ userId: user._id, codeHash: sha256(code + user.uid), expiresAt: addHours(new Date(), 10 / 60) })
    await sendMail(user.email, 'Your CUI Connect verification code', `Code: ${code} (valid 10 minutes)`, { code, uid: user.uid })
  }
  res.json({ ok: true, message: 'If this account exists, a code was sent to its university email.', ...(env.isProd ? {} : { devHint: 'Local dev: open GET /api/dev/mailbox to read the code.' }) })
}))

r.post('/verify', asyncH(async (req, res) => {
  const { uid, code } = parse(z.object({ uid: z.string(), code: z.string().length(6) }), req.body)
  const user = await User.findOne({ uid: uid.trim().toUpperCase() })
  const pr = user && (await PasswordReset.findOne({ userId: user._id, usedAt: null }).sort({ createdAt: -1 }))
  if (!pr) throw new AppError('INVALID_CODE', 400, { message: 'That code is not valid.' })
  if (pr.expiresAt < new Date()) throw new AppError('CODE_EXPIRED', 400, { message: 'That code expired. Request a new one.' })
  if (pr.attempts >= 5) throw new AppError('RATE_LIMITED', 429, { message: 'Too many attempts. Request a new code.' })
  pr.attempts += 1
  if (pr.codeHash !== sha256(code + user.uid)) { await pr.save(); throw new AppError('INVALID_CODE', 400, { message: 'That code is not valid.', attemptsLeft: 5 - pr.attempts }) }
  pr.verifiedToken = randomToken(24); await pr.save()
  res.json({ ok: true, resetToken: pr.verifiedToken })
}))

r.post('/reset', asyncH(async (req, res) => {
  const { resetToken, password } = parse(z.object({ resetToken: z.string(), password: z.string() }), req.body)
  const pr = await PasswordReset.findOne({ verifiedToken: resetToken, usedAt: null })
  if (!pr || pr.expiresAt < new Date()) throw new AppError('CODE_EXPIRED', 400, { message: 'This reset link expired. Start again.' })
  const user = await User.findById(pr.userId)
  assertStrongPassword(password, user.uid)
  user.passwordHash = await hashPassword(password); user.mustChangePassword = false; user.failedLogins = 0; user.lockedUntil = null
  await user.save()
  pr.usedAt = new Date(); await pr.save()
  await RefreshToken.updateMany({ userId: user._id, revokedAt: null }, { revokedAt: new Date() })
  await disconnectUser(String(user._id))
  await audit(user, 'auth.reset-password', { category: 'security' })
  res.json({ ok: true, message: 'Password updated. All other sessions were signed out.' })
}))

r.get('/sessions', requireAuth, asyncH(async (req, res) => {
  const rows = await RefreshToken.find({ userId: req.actor._id, revokedAt: null, expiresAt: { $gt: new Date() } }).sort({ lastUsedAt: -1 }).lean()
  const logins = await (await import('../models/index.js')).AuditLog.find({ actorId: req.actor._id, action: 'auth.login' }).sort({ at: -1 }).limit(10).lean()
  res.json({ sessions: rows.map((s) => ({ id: String(s._id), device: s.device, ip: s.ip, createdAt: s.createdAt, lastUsedAt: s.lastUsedAt })), recentLogins: logins.map((l) => ({ at: l.at, ip: l.ip })) })
}))
r.delete('/sessions/:id', requireAuth, asyncH(async (req, res) => {
  await RefreshToken.updateOne({ _id: req.params.id, userId: req.actor._id }, { revokedAt: new Date() })
  res.json({ ok: true })
}))
r.post('/sessions/revoke-others', requireAuth, asyncH(async (req, res) => {
  const { refreshToken } = req.body ?? {}
  await RefreshToken.updateMany({ userId: req.actor._id, revokedAt: null, tokenHash: { $ne: refreshToken ? sha256(refreshToken) : '' } }, { revokedAt: new Date() })
  res.json({ ok: true })
}))

export default r
