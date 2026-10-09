import { Desk, Ticket, Message, User } from '../models/index.js'
import { org } from './org.js'
import { loadAllActors, loadActors, loadActor, publicCard } from './actors.js'
import { has, hasAny, holds, deptIdOf } from '../policy/roles.js'
import { AppError } from '../lib/errors.js'
import { strId, sanitize, uniq, addHours } from '../lib/util.js'
import { toRoom, toUser } from '../lib/realtime.js'
import { notify, notifyMany } from '../lib/notify.js'
import { audit } from '../lib/audit.js'
import { decrypt } from '../lib/crypto.js'
import { snapshotFor, serializeMessage } from './messages.js'

const OPEN_STATES = ['OPEN', 'IN_PROGRESS', 'ESCALATED']

// ---- who works a desk -------------------------------------------------------
async function chainHolders(desk, ticket, level) {
  const step = desk.chain?.find((c) => c.level === level)
  if (!step) return []
  const actors = await loadAllActors()
  return actors.filter((a) => {
    if (a.status !== 'ACTIVE') return false
    if (step.scope === 'PROGRAM_OF_REQUESTER') {
      const prog = ticket?.programId
      return a.roles.some((r) => r.role === step.role && prog && org.isWithin(prog, r.orgUnitId) && org.isWithin(r.orgUnitId, org.departmentOf(prog)?._id))
    }
    if (step.scope === 'CAMPUS') return has(a, step.role)
    return a.roles.some((r) => r.role === step.role && (!desk.orgUnitId || org.isWithin(r.orgUnitId, desk.orgUnitId) || org.isWithin(desk.orgUnitId, r.orgUnitId)))
  })
}

export async function agentLevelOf(actor, desk, ticket) {
  if ((desk.agentIds ?? []).some((a) => strId(a) === actor.id)) return 1
  for (const step of [...(desk.chain ?? [])].sort((a, b) => a.level - b.level)) {
    const hs = await chainHolders(desk, ticket, step.level)
    if (hs.some((h) => h.id === actor.id)) return step.level
  }
  if ((desk.headIds ?? []).some((a) => strId(a) === actor.id)) return Math.max(1, ...(desk.chain ?? []).map((c) => c.level))
  return 0
}

export async function isAgent(actor, desk) { return (await agentLevelOf(actor, desk, null)) > 0 }

async function getDesk(slugOrId) {
  const d = await Desk.findOne(String(slugOrId).match(/^[0-9a-f]{24}$/i) ? { _id: slugOrId } : { slug: slugOrId }).lean()
  if (!d) throw new AppError('NOT_FOUND', 404)
  return d
}

// ---- profile ----------------------------------------------------------------
export async function deskProfile(actor, slug) {
  const d = await getDesk(slug)
  const level = await agentLevelOf(actor, d, null)
  const openCount = await Ticket.countDocuments({ deskId: d._id, status: { $in: OPEN_STATES } })
  const counters = await Promise.all((d.counters ?? []).map(async (c) => ({ ...c, id: undefined, open: await Ticket.countDocuments({ deskId: d._id, counterNo: c.no, status: { $in: OPEN_STATES } }) })))
  return {
    id: String(d._id), slug: d.slug, name: d.name, prefix: d.prefix, kind: d.kind, description: d.description, location: d.location, hours: d.hours, block: d.block, online: d.online,
    categories: d.categories, counters: counters.map(({ agentId, ...c }) => c), contacts: d.contacts, advisory: d.advisory, safeguard: d.safeguard, checklist: d.checklist, requestForm: d.requestForm,
    chain: d.chain, targetReplyHours: d.targetReplyHours, autoAssign: d.autoAssign, me: { isAgent: level > 0, level, canSettings: (d.headIds ?? []).some((h) => strId(h) === actor.id) || hasAny(actor, ['ADMIN', 'SUPER_ADMIN']) || (d.kind === 'COORDINATOR' && holds(actor, 'HOD', d.orgUnitId)) },
    stats: { open: openCount },
  }
}

// ---- create -----------------------------------------------------------------
export async function createTicket(actor, { deskSlug, category, subject, description, attachments = [], linkedPostId, force = false }) {
  const d = await getDesk(deskSlug)
  const subj = sanitize(subject)
  if (!subj || !category) throw new AppError('VALIDATION_FAILED', 422, { field: !subj ? 'subject' : 'category' })
  if (d.kind === 'COORDINATOR' && actor.kind === 'STUDENT' && deptIdOf(actor) !== strId(d.orgUnitId)) throw new AppError('DEPARTMENT_BOUNDARY', 403)
  const dup = await Ticket.findOne({ deskId: d._id, requesterId: actor._id, category, status: { $in: OPEN_STATES } }).lean()
  if (dup && !force) throw new AppError('CONFLICT', 409, { reason: 'DUPLICATE_OPEN_TICKET', ticketId: String(dup._id), code: dup.code, message: `You already have an open ${category} ticket (${dup.code}).` })
  d.seq = (await Desk.findOneAndUpdate({ _id: d._id }, { $inc: { seq: 1 } }, { new: true })).seq
  const prog = actor.batchId ? org.programOf(actor.batchId) : null
  const t = await Ticket.create({
    code: `${d.prefix}-${d.seq}`, deskId: d._id, requesterId: actor._id, category, subject: subj, description: sanitize(description ?? ''), attachments, linkedPostId,
    history: [{ by: actor._id, action: 'created', to: 'OPEN' }], programId: prog?._id,
  })
  // auto-assign to the counter that handles this category
  const counter = d.autoAssign && d.counters?.find((c) => c.categories?.includes(category))
  if (counter?.agentId) { t.assigneeId = counter.agentId; t.counterNo = counter.no; t.history.push({ action: 'auto-assigned', note: `Counter ${counter.no} · ${counter.name}`, to: strId(counter.agentId) }); await t.save() }
  const agents = await chainHolders(d, { programId: prog?._id }, 1)
  const agentIds = uniq([...(d.agentIds ?? []), ...agents.map((a) => a.id), t.assigneeId].filter(Boolean))
  await notifyMany(agentIds.filter((x) => x !== actor.id), { type: 'ticket', title: `New ticket ${t.code}: ${t.subject}`, body: `${actor.name} · ${category}`, link: `/tickets/${t._id}` })
  const dto = await presentTicket(t.toObject(), actor, d)
  toRoom(`desk:${d._id}:agents`, 'ticket:created', dto)
  await audit(actor, 'ticket.create', { category: 'content', target: { kind: 'ticket', id: String(t._id), label: t.code } })
  return { ticket: dto, expectedReplyHours: d.targetReplyHours, routedTo: counter ? `Counter ${counter.no} (${counter.name})` : d.name }
}

// ---- presentation -----------------------------------------------------------
export async function presentTicket(t, actor, desk, actorsMap) {
  t = { ...t, description: decrypt(t.description), resolution: decrypt(t.resolution) }
  desk = desk ?? (await Desk.findById(t.deskId).lean())
  const ids = uniq([t.requesterId, t.assigneeId].filter(Boolean))
  const actors = actorsMap ?? new Map((await loadActors(ids)).map((a) => [a.id, a]))
  const req = actors.get(strId(t.requesterId)); const asg = t.assigneeId ? actors.get(strId(t.assigneeId)) : null
  const chainLen = desk.chain?.length ?? 1
  const levelLabel = desk.chain?.find((c) => c.level === t.level)?.label
  return {
    id: String(t._id), code: t.code, deskId: String(desk._id), deskSlug: desk.slug, deskName: desk.name, category: t.category, subject: t.subject, description: t.description, attachments: t.attachments,
    status: t.status, priority: t.priority, level: t.level, levelLabel, levelOf: chainLen, requester: req ? { id: req.id, uid: req.uid, name: req.name, batch: org.get(req.batchId)?.code } : undefined,
    assignee: asg ? { id: asg.id, name: asg.name } : undefined, counterNo: t.counterNo, overdue: t.overdue, resolution: t.resolution, createdAt: t.createdAt, resolvedAt: t.resolvedAt, closedAt: t.closedAt,
    lastActivityAt: t.lastActivityAt, canReopen: t.status === 'RESOLVED' && !t.reopened && t.resolvedAt && Date.now() - new Date(t.resolvedAt) < 72 * 3600_000 && strId(t.requesterId) === actor.id,
    ageHours: Math.round((Date.now() - new Date(t.createdAt)) / 3600_000), linkedPostId: t.linkedPostId ? String(t.linkedPostId) : undefined,
    steps: (desk.chain ?? []).map((c) => ({ level: c.level, label: c.label, state: c.level < t.level ? 'past' : c.level === t.level ? 'current' : 'future' })),
  }
}

export async function myTickets(actor) {
  const ts = await Ticket.find({ requesterId: actor._id }).sort({ createdAt: -1 }).lean()
  const desks = new Map((await Desk.find({ _id: { $in: ts.map((t) => t.deskId) } }).lean()).map((d) => [String(d._id), d]))
  const asgIds = uniq(ts.map((t) => t.assigneeId).filter(Boolean))
  const actors = new Map((await loadActors([...asgIds, actor._id])).map((a) => [a.id, a]))
  return Promise.all(ts.map((t) => presentTicket(t, actor, desks.get(String(t.deskId)), actors)))
}

async function loadTicketFor(actor, id) {
  const t = await Ticket.findById(id).lean()
  if (!t) throw new AppError('NOT_FOUND', 404)
  const d = await Desk.findById(t.deskId).lean()
  const isReq = strId(t.requesterId) === actor.id
  const lvl = await agentLevelOf(actor, d, { programId: t.programId })
  if (!isReq && !lvl) throw new AppError('TICKET_SCOPE', 403)
  return { t, d, isReq, lvl }
}

export async function ticketDetail(actor, id) {
  const { t, d, isReq, lvl } = await loadTicketFor(actor, id)
  const q = { ticketId: t._id }
  if (isReq && !lvl) q.internal = { $ne: true }
  const msgs = await Message.find(q).sort({ createdAt: 1 }).lean()
  return {
    ticket: await presentTicket(t, actor, d), thread: msgs.map((m) => serializeMessage(m, { me: actor.id })),
    history: lvl ? t.history : t.history.filter((h) => !['note'].includes(h.action)).map((h) => ({ at: h.at, action: h.action, note: h.note })),
    me: { isRequester: isReq, isAgent: lvl > 0, level: lvl, canEscalate: lvl > 0 && t.level < (d.chain?.length ?? 1) && ['OPEN', 'IN_PROGRESS', 'ESCALATED'].includes(t.status), canResolve: lvl > 0 && t.status !== 'RESOLVED' && t.status !== 'CLOSED' },
  }
}

export async function replyTicket(actor, id, { body, internal = false, attachments = [] }) {
  const { t, d, isReq, lvl } = await loadTicketFor(actor, id)
  if (t.status === 'CLOSED') throw new AppError('FORBIDDEN', 403, { reason: 'This ticket is closed. Open a new ticket and reference it.' })
  if (internal && !lvl) throw new AppError('FORBIDDEN', 403)
  const text = sanitize(body)
  if (!text && !attachments.length) throw new AppError('VALIDATION_FAILED', 422)
  const m = await Message.create({ ticketId: t._id, senderId: actor._id, body: text, attachments, internal: !!internal, senderSnapshot: snapshotFor(actor) })
  const patch = { lastActivityAt: new Date() }
  if (lvl && !isReq) {
    if (!t.firstReplyAt && !internal) patch.firstReplyAt = new Date()
    if (['OPEN', 'ESCALATED'].includes(t.status)) { patch.status = 'IN_PROGRESS'; if (!t.assigneeId) patch.assigneeId = actor._id }
  }
  await Ticket.updateOne({ _id: t._id }, patch)
  const out = serializeMessage(m)
  if (internal) toRoom(`desk:${d._id}:agents`, 'ticket:message', out)
  else toRoom(`ticket:${t._id}`, 'ticket:message', out)
  if (!internal) {
    const other = isReq ? t.assigneeId : t.requesterId
    if (other) notify(other, { type: 'ticket', title: `${t.code}: new reply`, body: text.slice(0, 120), link: `/tickets/${t._id}` })
  }
  if (patch.status) toRoom(`ticket:${t._id}`, 'ticket:updated', { id: String(t._id), status: patch.status })
  return out
}

export async function assignTicket(actor, id, assigneeId) {
  const { t, d, lvl } = await loadTicketFor(actor, id)
  if (!lvl) throw new AppError('TICKET_SCOPE', 403)
  const to = assigneeId ?? actor.id
  const target = await loadActor(to)
  if (!(await isAgent(target, d))) throw new AppError('VALIDATION_FAILED', 422, { reason: 'That person is not an agent on this desk.' })
  const upd = { assigneeId: to, status: t.status === 'OPEN' ? 'IN_PROGRESS' : t.status, lastActivityAt: new Date() }
  await Ticket.updateOne({ _id: t._id }, { ...upd, $push: { history: { by: actor._id, action: 'assigned', note: target.name, to: to } } })
  const dto = await presentTicket({ ...t, ...upd }, actor, d)
  toRoom(`ticket:${t._id}`, 'ticket:updated', dto); toRoom(`desk:${d._id}:agents`, 'ticket:updated', dto)
  if (strId(to) !== actor.id) notify(to, { type: 'ticket', title: `Assigned to you: ${t.code}`, link: `/tickets/${t._id}` })
  return dto
}

export async function escalateTicket(actor, id, reason) {
  const { t, d, lvl } = await loadTicketFor(actor, id)
  if (!lvl) throw new AppError('TICKET_SCOPE', 403)
  if (!reason?.trim()) throw new AppError('VALIDATION_FAILED', 422, { field: 'reason' })
  const next = t.level + 1
  const step = d.chain?.find((c) => c.level === next)
  if (!step) throw new AppError('VALIDATION_FAILED', 422, { reason: 'Top level reached.' })
  const holders = await chainHolders(d, { programId: t.programId }, next)
  const assignee = holders[0]
  await Ticket.updateOne({ _id: t._id }, { level: next, status: 'ESCALATED', assigneeId: assignee?.id ?? null, lastActivityAt: new Date(), $push: { history: { by: actor._id, action: 'escalated', note: reason, from: `L${t.level}`, to: `L${next} ${step.label}` } } })
  const m = await Message.create({ ticketId: t._id, senderId: actor._id, kind: 'SYSTEM', body: `Escalated to level ${next} · ${step.label}. Reason: ${sanitize(reason)}`, senderSnapshot: snapshotFor(actor), internal: false })
  toRoom(`ticket:${t._id}`, 'ticket:message', serializeMessage(m))
  const fresh = await Ticket.findById(t._id).lean()
  const dto = await presentTicket(fresh, actor, d)
  toRoom(`ticket:${t._id}`, 'ticket:updated', dto); toRoom(`desk:${d._id}:agents`, 'ticket:updated', dto)
  await notifyMany(uniq([t.requesterId, ...holders.map((h) => h.id)]), { type: 'ticket', title: `${t.code} escalated to ${step.label}`, link: `/tickets/${t._id}` })
  await audit(actor, 'ticket.escalate', { category: 'content', target: { kind: 'ticket', id, label: t.code }, meta: { reason, level: next } })
  return dto
}

export async function resolveTicket(actor, id, note) {
  const { t, d, lvl } = await loadTicketFor(actor, id)
  if (!lvl) throw new AppError('TICKET_SCOPE', 403)
  if (!note?.trim()) throw new AppError('VALIDATION_FAILED', 422, { field: 'note' })
  await Ticket.updateOne({ _id: t._id }, { status: 'RESOLVED', resolution: sanitize(note), resolvedAt: new Date(), lastActivityAt: new Date(), assigneeId: t.assigneeId ?? actor._id, $push: { history: { by: actor._id, action: 'resolved', note, to: 'RESOLVED' } } })
  const fresh = await Ticket.findById(t._id).lean()
  const dto = await presentTicket(fresh, actor, d)
  toRoom(`ticket:${t._id}`, 'ticket:updated', dto); toRoom(`desk:${d._id}:agents`, 'ticket:updated', dto)
  notify(t.requesterId, { type: 'ticket', title: `${t.code} resolved`, body: note.slice(0, 120), link: `/tickets/${t._id}` })
  return dto
}

export async function reopenTicket(actor, id) {
  const t = await Ticket.findById(id)
  if (!t || strId(t.requesterId) !== actor.id) throw new AppError('TICKET_SCOPE', 403)
  if (t.status !== 'RESOLVED' || t.reopened || Date.now() - new Date(t.resolvedAt) > 72 * 3600_000) throw new AppError('FORBIDDEN', 403, { reason: 'A ticket can be reopened once within 72 hours of resolution. Raise a new ticket instead.' })
  t.status = 'IN_PROGRESS'; t.reopened = true; t.reopenedAt = new Date(); t.history.push({ by: actor._id, action: 'reopened', to: 'IN_PROGRESS' })
  await t.save()
  const d = await Desk.findById(t.deskId).lean()
  const dto = await presentTicket(t.toObject(), actor, d)
  toRoom(`ticket:${t._id}`, 'ticket:updated', dto); toRoom(`desk:${d._id}:agents`, 'ticket:updated', dto)
  if (t.assigneeId) notify(t.assigneeId, { type: 'ticket', title: `${t.code} reopened`, link: `/tickets/${t._id}` })
  return dto
}

// ---- queue & reports --------------------------------------------------------
export async function queue(actor, slug, { status, category, assignee, q, sort = '-createdAt', page = 1, limit = 50 } = {}) {
  const d = await getDesk(slug)
  const lvl = await agentLevelOf(actor, d, null)
  if (!lvl) throw new AppError('TICKET_SCOPE', 403)
  const f = { deskId: d._id }
  if (status && status !== 'ALL') f.status = status
  if (category) f.category = category
  if (assignee === 'me') f.assigneeId = actor._id; else if (assignee === 'unassigned') f.assigneeId = null
  let rows = await Ticket.find(f).sort(sort.startsWith('-') ? { [sort.slice(1)]: -1 } : { [sort]: 1 }).lean()
  // higher-level agents only see tickets that reached their level (or are assigned to them)
  if (lvl > 1) rows = rows.filter((t) => t.level >= lvl || strId(t.assigneeId) === actor.id)
  const actors = new Map((await loadActors(uniq([...rows.map((r) => r.requesterId), ...rows.map((r) => r.assigneeId).filter(Boolean)]))).map((a) => [a.id, a]))
  let dtos = await Promise.all(rows.map((t) => presentTicket(t, actor, d, actors)))
  if (q) { const s = q.toLowerCase(); dtos = dtos.filter((t) => `${t.code} ${t.subject} ${t.requester?.name} ${t.requester?.uid}`.toLowerCase().includes(s)) }
  const total = dtos.length
  return { items: dtos.slice((page - 1) * limit, page * limit), total, page, counts: Object.fromEntries(['OPEN', 'IN_PROGRESS', 'ESCALATED', 'RESOLVED', 'CLOSED'].map((s) => [s, rows.filter((r) => r.status === s).length])) }
}

export async function deskReports(actor, slug) {
  const d = await getDesk(slug)
  const prof = await deskProfile(actor, slug)
  if (!prof.me.isAgent) throw new AppError('TICKET_SCOPE', 403)
  const ts = await Ticket.find({ deskId: d._id }).lean()
  const open = ts.filter((t) => OPEN_STATES.includes(t.status))
  const replied = ts.filter((t) => t.firstReplyAt)
  const avg = replied.length ? replied.reduce((s, t) => s + (new Date(t.firstReplyAt) - new Date(t.createdAt)), 0) / replied.length / 3600_000 : 0
  const byCat = {}
  for (const t of ts) byCat[t.category] = (byCat[t.category] ?? 0) + 1
  return { open: open.length, overdue: open.filter((t) => t.overdue).length, resolved: ts.filter((t) => t.status === 'RESOLVED').length, avgFirstReplyHours: Math.round(avg * 10) / 10, byCategory: byCat, slaResolution: ts.length ? Math.round((ts.filter((t) => ['RESOLVED', 'CLOSED'].includes(t.status)).length / ts.length) * 1000) / 10 : 100 }
}

export async function updateDeskSettings(actor, slug, patch) {
  const d = await Desk.findOne({ slug })
  if (!d) throw new AppError('NOT_FOUND', 404)
  const prof = await deskProfile(actor, slug)
  if (!prof.me.canSettings) throw new AppError('FORBIDDEN', 403)
  for (const k of ['categories', 'agentIds', 'autoAssign', 'targetReplyHours', 'advisory', 'online']) if (patch[k] !== undefined) d[k] = patch[k]
  if (patch.counters) d.counters = patch.counters
  await d.save()
  await audit(actor, 'desk.settings', { category: 'structure', target: { kind: 'desk', id: String(d._id), label: d.name } })
  return deskProfile(actor, slug)
}

/** Scheduled: mark overdue tickets, close old resolved ones, return orphaned tickets to the queue. */
export async function runTicketJobs() {
  const desks = await Desk.find().lean()
  let overdue = 0
  for (const d of desks) {
    const cutoff = addHours(new Date(), -d.targetReplyHours)
    const ts = await Ticket.find({ deskId: d._id, status: { $in: ['OPEN', 'ESCALATED'] }, firstReplyAt: null, createdAt: { $lt: cutoff }, overdue: false })
    for (const t of ts) {
      t.overdue = true; await t.save(); overdue++
      if (d.headIds?.length) await notifyMany(d.headIds, { type: 'ticket', title: `Overdue: ${t.code}`, link: `/tickets/${t._id}`, mutable: false })
    }
  }
  const closed = await Ticket.updateMany({ status: 'RESOLVED', resolvedAt: { $lt: addHours(new Date(), -72) } }, { status: 'CLOSED', closedAt: new Date() })
  return { overdue, closed: closed.modifiedCount }
}

/** When an agent leaves a desk, their open tickets return to the queue. */
export async function releaseAgentTickets(userId) {
  const r = await Ticket.updateMany({ assigneeId: userId, status: { $in: OPEN_STATES } }, { assigneeId: null, status: 'OPEN' })
  return r.modifiedCount
}
