import fs from 'node:fs'
import path from 'node:path'
import { encryptBuffer } from './crypto.js'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../uploads')

/** Minimal one-page PDF so seeded attachments open in the PDF viewer. */
export function writePdf(title, lines = []) {
  const esc = (s) => String(s).replace(/[()\\]/g, '\\$&')
  const content = ['BT /F1 18 Tf 60 760 Td (' + esc(title) + ') Tj ET', ...lines.map((l, i) => `BT /F1 11 Tf 60 ${730 - i * 18} Td (${esc(l)}) Tj ET`)].join('\n')
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let out = '%PDF-1.4\n'; const offs = []
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n` })
  const xref = out.length
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('') + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  fs.mkdirSync(dir, { recursive: true })
  const id = `${crypto.randomBytes(16).toString('hex')}.pdf`
  fs.writeFileSync(path.join(dir, id), encryptBuffer(Buffer.from(out, 'latin1')))
  return { id, size: Buffer.byteLength(out), url: `/api/files/${id}`, mime: 'application/pdf' }
}
