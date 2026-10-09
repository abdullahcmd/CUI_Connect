import { Announcement, Group, Message, User } from '../models/index.js'
import { org } from './org.js'
import { loadAllActors, loadActor, publicCard } from './actors.js'
import { canPublish, canSeeScope, scopeIdsFor } from '../policy/index.js'
import { has, hasAny, holds, roleLabel, badgesOf } from '../policy/roles.js'
import { AppError } from '../lib/errors.js'
import { sha256, strId, sanitize, addHours } from '../lib/util.js'
import { toRoom, toGroup } from '../lib/realtime.js'
import { notifyMany, notify } from '../lib/notify.js'
import { audit } from '../lib/audit.js'
import { snapshotFor, serializeMessage } from './messages.js'

const PIN_LIMIT = 3
const fmtDay = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }).toUpperCase()

export async function audienceOf(a) {
  const actors = await loadAllActors()
  let aud = actors.filter((x) => x.status !== 'INACTIVE' && scopeIdsFor(x).has(strId(a.scopeId)))
  if (a.targetBatchIds?.length) { const set = new Set(a.targetBatchIds.map(String)); aud = aud.filter((x) => x.kind === 'STUDENT' && set.has(x.batchId)) }
  return aud
}

async function presentOne(a, actor, authors) {
  const scope = org.get(a.scopeId)
  const author = authors.get(String(a.authorId))
  const scopeLabel = `${a.scopeType === 'CAMPUS' ? 'UNIVERSITY' : (scope?.type ?? '')} · ${(a.officeLabel ?? author?.designation ?? '').toUpperCase()} · ${fmtDay(a.createdAt)}`
  const own = strId(a.authorId) === actor.id
  const canManage = own || (scope ? canPublish(actor, scope).allow : false)
  return {
    id: String(a._id), kind: a.kind, scope: { id: String(a.scopeId), type: a.scopeType, code: scope?.code, name: scope?.name },
    scopeLine: scopeLabel, category: a.category, refNo: a.refNo, number: a.number, title: a.title, body: a.body, attachments: a.attachments,
    effectiveFrom: a.effectiveFrom, expiresAt: a.expiresAt, pinned: a.pinned, mandatoryAck: a.mandatoryAck, status: a.status,
    author: author ? { id: author.id, name: author.name, badges: badgesOf(author) } : undefined, officeLabel: a.officeLabel,
    ackCount: a.acks.length, audienceCount: a.audienceCount, acknowledged: a.acks.some((x) => String(x.userId) === actor.id),
    canManage, editedAt: a.versions?.length ? a.versions.at(-1).at : undefined, versionCount: a.versions?.length ?? 0,
    digest: a.kind === 'GAZETTE' ? a.digest : undefined, signed: a.signed, locked: a.lockedAt ? new Date() > a.lockedAt : false,
    createdAt: a.createdAt, helpDesk: { slug: 'student-affairs', label: 'Questions? Ask the Student Affairs Desk' },
  }
}

export async function presentMany(rows, actor) {
  const actors = await loadAllActors()
  const authors = new Map(actors.filter((x) => rows.some((r) => String(r.authorId) === x.id)).map((x) => [x.id, x]))
  return Promise.all(rows.map((r) => presentOne(r, actor, authors)))
}

export async function listBoard(actor, { scope, category, before, limit = 30, archive = false } = {}) {
  const scopes = [...scopeIdsFor(actor)]
  const q = { scopeId: { $in: scopes }, status: archive ? 'ARCHIVED' : 'PUBLISHED' }
  const now = new Date()
  if (!archive) q.$and = [{ $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] }]
  if (category) q.category = category
  if (scope && scope !== 'all') {
    const type = { university: 'CAMPUS', department: 'DEPARTMENT', program: 'PROGRAM', batch: 'BATCH' }[String(scope).toLowerCase()]
    if (type) q.scopeType = type
  }
  if (before) q._id = { $lt: before }
  const rows = await Announcement.find(q).sort({ pinned: -1, createdAt: -1 }).limit(Math.min(limit, 100)).lean()
  const items = await presentMany(rows, actor)
  return { pinned: items.filter((i) => i.pinned).slice(0, PIN_LIMIT), latest: items.filter((i) => !i.pinned || items.filter((x) => x.pinned).indexOf(i) >= PIN_LIMIT), items }
}

export async function getAnnouncement(actor, id) {
  const a = await Announcement.findById(id).lean()
  if (!a || !canSeeScope(actor, a.scopeId)) throw new AppError(a ? 'NOT_MEMBER' : 'NOT_FOUND', a ? 403 : 404)
  return (await presentMany([a], actor))[0]
}

async function nextGazetteNo() {
  const last = await Announcement.findOne({ kind: 'GAZETTE' }).sort({ number: -1 }).lean()
  return (last?.number ?? 100) + 1
}

export async function publishAnnouncement(actor, p) {
  const scope = org.get(p.scopeId)
  if (!scope) throw new AppError('NOT_FOUND', 404)
  const v = canPublish(actor, scope)
  if (!v.allow) throw new AppError(v.code, 403, v.meta)
  if (p.pinned && (await Announcement.countDocuments({ pinned: true, status: 'PUBLISHED', scopeId: scope._id })) >= PIN_LIMIT)
    throw new AppError('VALIDATION_FAILED', 422, { reason: `Only ${PIN_LIMIT} notices can be pinned per scope. Unpin one first.` })
  const gazette = p.kind === 'GAZETTE' || has(actor, 'EXAM_OFFICER')
  const number = gazette ? await nextGazetteNo() : undefined
  const now = new Date()
  const doc = new Announcement({
    kind: gazette ? 'GAZETTE' : 'CIRCULAR', scopeId: scope._id, scopeType: scope.type, category: p.category ?? 'GENERAL',
    refNo: p.refNo ?? (gazette ? `CUI/ISB/EXAM/26-${800 + (number % 100)}` : undefined), number,
    title: sanitize(p.title), body: sanitize(p.body ?? ''), attachments: p.attachments ?? [], effectiveFrom: p.effectiveFrom ?? now, expiresAt: p.expiresAt,
    pinned: !!p.pinned, mandatoryAck: !!p.mandatoryAck, forwardToCRs: !!p.forwardToCRs, authorId: actor._id,
    officeLabel: p.officeLabel ?? (has(actor, 'EXAM_OFFICER') ? 'EXAMINATION CELL' : has(actor, 'ADMIN') ? 'ADMIN OFFICE' : actor.designation),
    targetBatchIds: p.targetBatchIds ?? [], audienceLabel: p.audienceLabel,
    status: p.draft ? 'DRAFT' : 'PUBLISHED', signed: gazette, lockedAt: gazette ? addHours(now, 1) : addHours(now, 1),
  })
  doc.digest = sha256(`${doc.title}\n${doc.body}`)
  const aud = await audienceOf(doc)
  doc.audienceCount = aud.length
  await doc.save()
  if (doc.status === 'PUBLISHED') await fanOut(doc, actor, aud)
  await audit(actor, 'board.publish', { category: 'content', target: { kind: 'announcement', id: String(doc._id), label: doc.title }, meta: { scope: scope.code, audience: aud.length } })
  return (await presentMany([doc.toObject()], actor))[0]
}

async function fanOut(doc, actor, aud) {
  const card = (await presentMany([doc.toObject ? doc.toObject() : doc], actor))[0]
  toRoom(`board:${doc.scopeId}`, 'board:new', { ...card, acknowledged: false })
  await notifyMany(aud.filter((x) => x.id !== actor.id).map((x) => x.id), { type: 'board', title: `${doc.officeLabel ?? 'Announcement'}: ${doc.title}`, body: doc.body.slice(0, 120), link: `/board/${doc._id}`, mutable: false })
  if (doc.forwardToCRs && (has(actor, 'HOD') || has(actor, 'COORDINATOR'))) {
    const dept = org.departmentOf(doc.scopeId) ?? org.departmentOf(actor.roles.find((r) => org.departmentOf(r.orgUnitId))?.orgUnitId)
    if (dept) await forwardToCRs(actor, doc, dept._id).catch(() => {})
  }
}

export async function forwardToCRs(actor, doc, deptId) {
  if (!(has(actor, 'HOD') || has(actor, 'COORDINATOR'))) throw new AppError('FORBIDDEN', 403)
  const dept = deptId ?? org.departmentOf(actor.roles.find((r) => ['HOD', 'COORDINATOR'].includes(r.role))?.orgUnitId)?._id
  if (!holds(actor, 'COORDINATOR', dept) && !holds(actor, 'HOD', dept)) throw new AppError('DEPARTMENT_BOUNDARY', 403)
  const g = await Group.findOne({ template: 'CRS', orgUnitId: dept }).lean()
  if (!g) throw new AppError('NOT_FOUND', 404)
  const a = doc.toObject ? doc.toObject() : doc
  const m = await Message.create({ groupId: g._id, senderId: actor._id, body: `${a.title}\n\n${(a.body ?? '').slice(0, 300)}`, kind: 'TEXT', forwardOf: { announcementId: a._id, title: a.title }, senderSnapshot: snapshotFor(actor), postedAs: 'FORWARD' })
  await Announcement.updateOne({ _id: a._id }, { $push: { forwards: { groupId: g._id, by: actor._id, at: new Date() } } })
  toGroup(g._id, 'message:new', serializeMessage(m))
  return { ok: true, groupId: String(g._id), messageId: String(m._id) }
}

export async function forwardAnnouncement(actor, id) {
  const a = await Announcement.findById(id)
  if (!a || !canSeeScope(actor, a.scopeId)) throw new AppError('NOT_FOUND', 404)
  return forwardToCRs(actor, a)
}

export async function editAnnouncement(actor, id, patch) {
  const a = await Announcement.findById(id)
  if (!a) throw new AppError('NOT_FOUND', 404)
  const scope = org.get(a.scopeId)
  if (!(strId(a.authorId) === actor.id || canPublish(actor, scope).allow)) throw new AppError('BOARD_SCOPE', 403)
  if (a.kind === 'GAZETTE' && a.lockedAt && new Date() > a.lockedAt) throw new AppError('FORBIDDEN', 403, { reason: 'LEDGER_LOCKED', message: 'Gazette circulars are committed to the immutable registrar ledger after 60 minutes. Publish a new gazette entry to supersede.' })
  a.versions.push({ title: a.title, body: a.body, editedBy: actor._id })
  for (const k of ['title', 'body', 'category', 'expiresAt', 'effectiveFrom', 'mandatoryAck']) if (patch[k] !== undefined) a[k] = k === 'title' || k === 'body' ? sanitize(patch[k]) : patch[k]
  if (patch.pinned !== undefined) {
    if (patch.pinned && !a.pinned && (await Announcement.countDocuments({ pinned: true, status: 'PUBLISHED', scopeId: a.scopeId })) >= PIN_LIMIT) throw new AppError('VALIDATION_FAILED', 422, { reason: `Only ${PIN_LIMIT} notices can be pinned.` })
    a.pinned = patch.pinned
  }
  a.digest = sha256(`${a.title}\n${a.body}`)
  await a.save()
  const card = (await presentMany([a.toObject()], actor))[0]
  toRoom(`board:${a.scopeId}`, 'board:updated', card)
  const touched = a.acks.map((x) => x.userId)
  await notifyMany(touched, { type: 'board', title: `Updated: ${a.title}`, link: `/board/${a._id}` })
  await audit(actor, 'board.edit', { category: 'content', target: { kind: 'announcement', id: String(a._id), label: a.title } })
  return card
}

export async function deleteAnnouncement(actor, id) {
  const a = await Announcement.findById(id)
  if (!a) throw new AppError('NOT_FOUND', 404)
  const scope = org.get(a.scopeId)
  if (!(strId(a.authorId) === actor.id || canPublish(actor, scope).allow)) throw new AppError('BOARD_SCOPE', 403)
  const age = Date.now() - new Date(a.createdAt)
  if (age > 3600_000) { a.status = 'ARCHIVED'; a.pinned = false; await a.save(); toRoom(`board:${a.scopeId}`, 'board:updated', (await presentMany([a.toObject()], actor))[0]); return { ok: true, archived: true, reason: 'After 1 hour a notice can only be archived.' } }
  await a.deleteOne()
  toRoom(`board:${a.scopeId}`, 'board:deleted', { id })
  await audit(actor, 'board.delete', { category: 'content', target: { kind: 'announcement', id, label: a.title } })
  return { ok: true, archived: false }
}

export async function acknowledge(actor, id) {
  const a = await Announcement.findById(id)
  if (!a || !canSeeScope(actor, a.scopeId)) throw new AppError('NOT_FOUND', 404)
  if (!a.acks.some((x) => String(x.userId) === actor.id)) { a.acks.push({ userId: actor._id }); await a.save() }
  toRoom(`board:${a.scopeId}`, 'board:ack', { id, count: a.acks.length, audienceCount: a.audienceCount })
  return { ok: true, count: a.acks.length }
}

export async function ackReport(actor, id) {
  const a = await Announcement.findById(id).lean()
  if (!a) throw new AppError('NOT_FOUND', 404)
  const scope = org.get(a.scopeId)
  if (!(strId(a.authorId) === actor.id || canPublish(actor, scope).allow)) throw new AppError('BOARD_SCOPE', 403)
  const aud = await audienceOf(a)
  const ackedAt = new Map(a.acks.map((x) => [String(x.userId), x.at]))
  const rows = aud.map((u) => ({ ...publicCard(u), batch: org.get(u.batchId)?.code ?? '', acknowledged: ackedAt.has(u.id), at: ackedAt.get(u.id) }))
  // cohort breakdown by batch
  const byBatch = new Map()
  for (const r of rows.filter((x) => x.batch)) {
    const b = byBatch.get(r.batch) ?? { code: r.batch, total: 0, acked: 0 }
    b.total++; if (r.acknowledged) b.acked++
    byBatch.set(r.batch, b)
  }
  const cohorts = [...byBatch.values()].map((b) => ({ ...b, rate: Math.round((b.acked / b.total) * 1000) / 10, status: b.acked / b.total >= 0.9 ? 'OK' : b.acked / b.total >= 0.7 ? 'WATCH' : 'LAG' })).sort((x, y) => y.rate - x.rate)
  const total = rows.length, acked = rows.filter((r) => r.acknowledged).length
  return { id, title: a.title, total, acked, remaining: total - acked, rate: total ? Math.round((acked / total) * 1000) / 10 : 0, deadline: a.expiresAt, cohorts, people: rows.sort((x, y) => Number(x.acknowledged) - Number(y.acknowledged) || x.name.localeCompare(y.name)) }
}

export async function ackCsv(actor, id) {
  const r = await ackReport(actor, id)
  const esc = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`
  return ['uid,name,batch,acknowledged,at', ...r.people.map((p) => [p.uid, p.name, p.batch, p.acknowledged, p.at?.toISOString() ?? ''].map(esc).join(','))].join('\n')
}

/** Post a reminder into the CR line of every batch below the target rate. */
export async function nudgeViaCrLine(actor, id, { threshold = 90 } = {}) {
  const a = await Announcement.findById(id)
  if (!a) throw new AppError('NOT_FOUND', 404)
  const scope = org.get(a.scopeId)
  if (!(strId(a.authorId) === actor.id || canPublish(actor, scope).allow)) throw new AppError('BOARD_SCOPE', 403)
  const rep = await ackReport(actor, id)
  const lagging = rep.cohorts.filter((c) => c.rate < threshold)
  const sent = []
  for (const c of lagging) {
    const batch = org.byCode(c.code)
    const g = batch && (await Group.findOne({ template: 'CR_LINE', orgUnitId: batch._id }).lean())
    if (!g) continue
    const m = await Message.create({ groupId: g._id, senderId: actor._id, kind: 'SYSTEM', senderSnapshot: snapshotFor(actor), postedAs: 'NUDGE',
      body: `Reminder: ${c.total - c.acked} of ${c.total} students in ${c.code} have not acknowledged "${a.title}". Please remind your class.` })
    toGroup(g._id, 'message:new', serializeMessage(m)); sent.push(c.code)
  }
  return { ok: true, nudged: sent }
}

export async function remindNonAcked(actor, id) {
  const a = await Announcement.findById(id)
  if (!a) throw new AppError('NOT_FOUND', 404)
  const scope = org.get(a.scopeId)
  if (!(strId(a.authorId) === actor.id || canPublish(actor, scope).allow)) throw new AppError('BOARD_SCOPE', 403)
  const aud = await audienceOf(a)
  const acked = new Set(a.acks.map((x) => String(x.userId)))
  const todo = aud.filter((u) => !acked.has(u.id))
  await notifyMany(todo.map((u) => u.id), { type: 'reminder', title: `Please acknowledge: ${a.title}`, link: `/board/${a._id}`, mutable: false })
  a.remindedAt = new Date(); await a.save()
  return { ok: true, reminded: todo.length }
}

export async function versions(actor, id) {
  const a = await Announcement.findById(id).lean()
  if (!a || !canSeeScope(actor, a.scopeId)) throw new AppError('NOT_FOUND', 404)
  const eds = await loadAllActors()
  const by = new Map(eds.map((e) => [e.id, e.name]))
  return [{ title: a.title, body: a.body, current: true, at: a.updatedAt }, ...[...a.versions].reverse().map((v) => ({ title: v.title, body: v.body, by: by.get(String(v.editedBy)), at: v.at }))]
}

export async function expireDue() {
  const r = await Announcement.updateMany({ status: 'PUBLISHED', expiresAt: { $lte: new Date(), $ne: null } }, { status: 'ARCHIVED', pinned: false })
  return r.modifiedCount
}
