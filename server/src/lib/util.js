import crypto from 'node:crypto'

export const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)
export const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex')
export const randomToken = (n = 32) => crypto.randomBytes(n).toString('hex')
export const randomCode = (n = 6) => Array.from({ length: n }, () => crypto.randomInt(0, 10)).join('')
export const strId = (v) => (v == null ? null : String(v._id ?? v))
export const same = (a, b) => strId(a) === strId(b)
export const uniq = (arr) => [...new Set(arr.map(strId).filter(Boolean))]

/** Strip HTML tags and control chars from user text (messages are rendered as text on the client). */
export function sanitize(text = '') {
  return String(text).replace(/<[^>]*>/g, '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim()
}

export const initials = (name = '') =>
  name.replace(/^(Dr\.|Prof\.|Engr\.|Mr\.|Ms\.)\s*/i, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()

export const addHours = (d, h) => new Date(new Date(d).getTime() + h * 3600_000)
export const addDays = (d, n) => addHours(d, n * 24)

/** Parse a registration number like FA23-BCS-014. */
export const REG_RE = /^(FA|SP)(\d{2})-([A-Z]{2,4})-(\d{3})$/
export function parseReg(reg) {
  const m = REG_RE.exec(String(reg).trim().toUpperCase())
  if (!m) return null
  return { intake: m[1], year: 2000 + Number(m[2]), yy: m[2], program: m[3], roll: m[4], batchCode: `${m[1]}${m[2]}-${m[3]}` }
}

export const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]))

/** Tiny in-memory fixed-window limiter (replaces Redis counters on a single node). */
const buckets = new Map()
export function hit(key, limit, windowMs) {
  const now = Date.now()
  const b = buckets.get(key)
  if (!b || b.reset < now) { buckets.set(key, { n: 1, reset: now + windowMs }); return true }
  b.n += 1
  return b.n <= limit
}
setInterval(() => { const n = Date.now(); for (const [k, v] of buckets) if (v.reset < n) buckets.delete(k) }, 60_000).unref()
