import crypto from 'node:crypto'
import { env } from '../config/env.js'

/**
 * Encryption at rest: AES-256-GCM with a random 96-bit IV per value (authenticated, so tampering is detected).
 * The key lives in MESSAGE_KEY (64 hex chars), never in the database. Values are stored as "enc1:<base64(iv|tag|ciphertext)>".
 * decrypt() passes plain text through untouched, so old rows keep working until they are re-saved.
 */
const PREFIX = 'enc1:'
const MAGIC = Buffer.from('CUIENC1\0')

function loadKey() {
  const hex = process.env.MESSAGE_KEY
  if (hex && /^[0-9a-fA-F]{64}$/.test(hex)) return Buffer.from(hex, 'hex')
  if (env.isProd) throw new Error('MESSAGE_KEY (64 hex characters) is required in production. Generate one with: npm run keygen')
  console.warn('⚠  MESSAGE_KEY not set: deriving a development key from JWT_SECRET. Run `npm run keygen` and put the result in .env.')
  return crypto.scryptSync(env.jwtSecret, 'cui-connect-dev-message-key', 32)
}
const KEY = loadKey()

export function encrypt(text) {
  if (text == null || text === '' || String(text).startsWith(PREFIX)) return text
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv)
  const ct = Buffer.concat([c.update(String(text), 'utf8'), c.final()])
  return PREFIX + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64')
}

export function decrypt(value) {
  if (typeof value !== 'string' || !value.startsWith(PREFIX)) return value
  try {
    const raw = Buffer.from(value.slice(PREFIX.length), 'base64')
    const d = crypto.createDecipheriv('aes-256-gcm', KEY, raw.subarray(0, 12))
    d.setAuthTag(raw.subarray(12, 28))
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8')
  } catch {
    return '[unreadable: wrong key or corrupted data]'
  }
}

export function encryptBuffer(buf) {
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv)
  const ct = Buffer.concat([c.update(buf), c.final()])
  return Buffer.concat([MAGIC, iv, c.getAuthTag(), ct])
}

/** Files written before encryption was switched on (no magic header) are returned as they are. */
export function decryptBuffer(buf) {
  if (buf.length < MAGIC.length + 28 || !buf.subarray(0, MAGIC.length).equals(MAGIC)) return buf
  const o = MAGIC.length
  const d = crypto.createDecipheriv('aes-256-gcm', KEY, buf.subarray(o, o + 12))
  d.setAuthTag(buf.subarray(o + 12, o + 28))
  return Buffer.concat([d.update(buf.subarray(o + 28)), d.final()])
}

/** Schema helper: transparent encrypt-on-write / decrypt-on-read for hydrated docs, plus lean() results. */
export function encryptedFields(schema, paths) {
  for (const p of paths) schema.path(p).set(encrypt).get(decrypt)
  const fix = (doc) => {
    if (!doc || Object.getPrototypeOf(doc) !== Object.prototype) return // hydrated docs use the getter
    for (const p of paths) {
      const parts = p.split('.')
      const apply = (obj, i) => {
        if (obj == null) return
        if (Array.isArray(obj)) return obj.forEach((x) => apply(x, i))
        if (i === parts.length - 1) { if (typeof obj[parts[i]] === 'string') obj[parts[i]] = decrypt(obj[parts[i]]); return }
        apply(obj[parts[i]], i + 1)
      }
      apply(doc, 0)
    }
  }
  schema.post(['find', 'findOne', 'findOneAndUpdate'], function (res) { Array.isArray(res) ? res.forEach(fix) : fix(res) })
}
