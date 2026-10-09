import { Announcement, Setting, OrgUnit, User } from '../models/index.js'
import { org } from './org.js'
import { hasAny } from '../policy/roles.js'
import { AppError } from '../lib/errors.js'
import { sha256 } from '../lib/util.js'
import { audienceOf, publishAnnouncement, ackReport, remindNonAcked, presentMany } from './board.js'

const guard = (actor) => { if (!hasAny(actor, ['EXAM_OFFICER', 'ADMIN', 'SUPER_ADMIN'])) throw new AppError('FORBIDDEN', 403) }
const cfg = async () => (await Setting.findOne({ key: 'examCell' }).lean())?.value ?? {}

export async function console_(actor, { filter = 'ALL' } = {}) {
  guard(actor)
  const c = await cfg()
  const gazettes = await Announcement.find({ kind: 'GAZETTE' }).sort({ createdAt: -1 }).lean()
  const active = gazettes.filter((g) => g.status === 'PUBLISHED' && (!g.expiresAt || g.expiresAt > new Date()))
  let totalAcks = 0, totalAud = 0
  for (const g of active) { totalAcks += g.acks.length; totalAud += g.audienceCount }
  const rows = gazettes.filter((g) => (filter === 'ACTIVE' ? g.status === 'PUBLISHED' && (!g.expiresAt || g.expiresAt > new Date()) : filter === 'ARCHIVED' ? g.status === 'ARCHIVED' || (g.expiresAt && g.expiresAt <= new Date()) : true))
  const presented = await presentMany(rows, actor)
  return {
    header: { desk: 'OFFICIAL DESK', code: c.deskCode ?? 'SEC-EXAM-ISB-09', ledgerStatus: 'ACTIVE', title: 'Examination Cell — Gazette & Circular Publishing Console' },
    kpis: {
      activeCirculars: { count: active.length, queued: c.queuedForSeal ?? 2 },
      overallAckRate: { percent: totalAud ? Math.round((totalAcks / totalAud) * 1000) / 10 : 0, acked: totalAcks, roster: totalAud },
      examWindow: c.window ?? {}, auditRepository: c.auditRepo ?? {},
    },
    ledger: presented.map((p, i) => {
      const g = rows[i]
      return { ...p, number: g.number, digestShort: g.digest ? `${g.digest.slice(0, 4)}...${g.digest.slice(-4)}` : null, signatureVerified: g.signed, targetAudience: g.audienceLabel, streamState: g.status === 'PUBLISHED' && (!g.expiresAt || g.expiresAt > new Date()) ? 'ACTIVE STREAM' : 'CLOSED · ARCHIVED', pending: g.audienceCount - g.acks.length, progressPercent: g.audienceCount ? Math.round((g.acks.length / g.audienceCount) * 1000) / 10 : 0 }
    }),
    total: gazettes.length, protocol: c.protocol, token: c.token, halls: c.halls ?? [], contacts: c.contacts ?? [],
  }
}

export async function dispatch(actor, p) {
  guard(actor)
  const campus = org.campus()
  const targetBatchIds = (p.batchCodes ?? []).map((code) => org.byCode(code)?._id).filter(Boolean)
  const a = await publishAnnouncement(actor, { ...p, scopeId: p.scopeId ?? campus._id, kind: 'GAZETTE', category: p.category ?? 'EXAM', targetBatchIds, audienceLabel: p.audienceLabel ?? 'All Undergraduate Batches' })
  return a
}

export async function breakdown(actor, id) { guard(actor); return ackReport(actor, id) }
export async function remind(actor, id) { guard(actor); return remindNonAcked(actor, id) }

/** Simulated HSM keypad validation (the signing token is never stored). */
export async function validateKeypad(actor, { token }) {
  guard(actor)
  const c = await cfg()
  const ok = !!token && sha256(String(token)) === (c.token?.slotHash ?? sha256('HSM-SLOT-03'))
  return { ok, signatory: c.token?.signatory ?? 'Incharge Exam Cell', slot: c.token?.slot ?? 'CUI-HSM-SLOT-03', publicKeyExpires: c.token?.publicKeyExpires ?? '31 DEC 2026' }
}
