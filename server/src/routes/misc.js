import { Router } from 'express'
import multer from 'multer'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { asyncH, sha256 } from '../lib/util.js'
import { AppError } from '../lib/errors.js'
import { encryptBuffer, decryptBuffer } from '../lib/crypto.js'
import { search } from '../services/search.js'

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../uploads')
fs.mkdirSync(dir, { recursive: true })
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 5 } })

/** Content sniffing: type is decided by magic bytes, never by the file name. */
function sniff(buf) {
  if (buf.length > 4 && buf.subarray(0, 4).toString('latin1') === '%PDF') return { mime: 'application/pdf', ext: 'pdf', kind: 'pdf' }
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: 'png', kind: 'image' }
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg', kind: 'image' }
  return null
}

export const router = Router()
router.get('/search', asyncH(async (req, res) => res.json(await search(req.actor, { q: String(req.query.q ?? ''), scope: String(req.query.scope ?? 'all') }))))

router.post('/uploads', upload.array('files', 5), asyncH(async (req, res) => {
  if (!req.files?.length) throw new AppError('VALIDATION_FAILED', 422, { reason: 'No file attached.' })
  const out = []
  for (const f of req.files) {
    const type = sniff(f.buffer)
    if (!type) throw new AppError('VALIDATION_FAILED', 422, { reason: `${f.originalname}: only PDF, PNG and JPG files are accepted.` })
    const id = `${crypto.randomBytes(16).toString('hex')}.${type.ext}`
    fs.writeFileSync(path.join(dir, id), encryptBuffer(f.buffer))
    out.push({ id, name: path.basename(f.originalname).slice(0, 120), size: f.size, mime: type.mime, kind: type.kind, url: `/api/files/${id}`, sha256: sha256(f.buffer.toString('latin1')).slice(0, 64) })
  }
  res.status(201).json({ files: out })
}))

router.get('/files/:id', (req, res, next) => {
  const id = path.basename(req.params.id)
  const p = path.join(dir, id)
  if (!fs.existsSync(p)) return next(new AppError('NOT_FOUND', 404))
  const type = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg' }[id.split('.').pop()] ?? 'application/octet-stream'
  res.type(type).set('Content-Disposition', 'inline').send(decryptBuffer(fs.readFileSync(p))) // files are encrypted on disk
})

export default router
