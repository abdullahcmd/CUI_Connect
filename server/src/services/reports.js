import { Report, Message, Group, Membership, User } from '../models/index.js'
import { org } from './org.js'
import { loadActor, loadActors, publicCard } from './actors.js'
import { has, hasAny, holds, deptIdOf } from '../policy/roles.js'
import { AppError } from '../lib/errors.js'
import { strId, uniq } from '../lib/util.js'
import { audit } from '../lib/audit.js'
import { notify } from '../lib/notify.js'
import { toGroup } from '../lib/realtime.js'
import { setStatus } from './users.js'
import { deleteMessage } from './messages.js'

export async function createReport(actor, { groupId, messageIds = [], reason, note, kind }) {
  const group = await Group.findById(groupId).lean()
  if (!group) throw new AppError('NOT_FOUND', 404)
  if (!(await Membership.findOne({ groupId, userId: actor._id }))) throw new AppError('NOT_MEMBER', 403)
  if (!messageIds.length) throw new AppError('VALIDATION_FAILED', 422, { reason: 'Choose at least one message to include.' })
  const msgs = await Message.find({ _id: { $in: messageIds.slice(0, 5) }, groupId, deletedAt: null }).sort({ createdAt: 1 }).lean()
  if (!msgs.length) throw new AppError('NOT_FOUND', 404)
  const targets = uniq(msgs.map((m) => m.senderId)).filter((id) => id !== actor.id)
  const targetUser = targets[0] ? await loadActor(targets[0]) : null
  // routing (screens-flows F-29)
  let route = 'ADMIN', routeOrgId = org.campus()._id
  if (targetUser && targetUser.kind === 'STAFF') route = 'ADMIN'
  else if (group.kind === 'DIRECT') { route = 'STUDENT_AFFAIRS'; routeOrgId = org.byCode('SA')?._id }
  else if (group.kind === 'ROLE') { route = 'GROUP_MANAGER'; routeOrgId = group.orgUnitId }
  else { route = 'COORDINATOR'; routeOrgId = (org.departmentOf(group.orgUnitId) ?? org.departmentOf(deptIdOf(actor)))?._id ?? org.campus()._id }
  const count = await Report.countDocuments()
  const r = await Report.create({
    code: `REP-${100 + count + 1}`, reporterId: actor._id, targetUserId: targetUser?.id, groupId, kind: kind ?? (reason === 'harassment' ? 'HARASSMENT' : reason === 'spam' ? 'SPAM' : 'OTHER'), reason, note,
    priority: ['harassment'].includes(String(reason).toLowerCase()) ? 'HIGH' : 'NORMAL', route, routeOrgId,
    evidence: msgs.map((m) => ({ messageId: m._id, senderName: m.senderSnapshot?.name, senderUid: m.senderSnapshot?.uid, body: m.body, at: m.createdAt, context: group.kind === 'DIRECT' ? 'Direct message' : group.name })),
    history: [{ by: actor._id, action: 'filed' }],
  })
  const { loadAllActors } = await import('./actors.js')
  const reviewers = (await loadAllActors()).filter((a) => canReview(a, r))
  for (const rv of reviewers) notify(rv.id, { type: 'report', title: `New report ${r.code}`, link: `/admin/reports/${r._id}`, mutable: false })
  await audit(actor, 'report.create', { category: 'content', target: { kind: 'report', id: String(r._id), label: r.code } })
  return { id: String(r._id), code: r.code, route }
}

export function canReview(actor, r) {
  if (hasAny(actor, ['ADMIN', 'SUPER_ADMIN'])) return r.route === 'ADMIN' || r.status === 'ESCALATED'
  if (r.route === 'STUDENT_AFFAIRS') return hasAny(actor, ['SA_HEAD', 'SA_OFFICER'])
  if (['COORDINATOR', 'GROUP_MANAGER'].includes(r.route)) return holds(actor, 'COORDINATOR', r.routeOrgId) || holds(actor, 'HOD', r.routeOrgId)
  return false
}

const ago = (d) => { const m = Math.round((Date.now() - new Date(d)) / 60000); return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} hrs ago` : `${Math.round(m / 1440)}d ago` }

export async function listReports(actor, { tab = 'all' } = {}) {
  const all = await Report.find().sort({ createdAt: -1 }).lean()
  const mine = all.filter((r) => canReview(actor, r))
  if (!mine.length && !hasAny(actor, ['ADMIN', 'SUPER_ADMIN', 'SA_HEAD', 'SA_OFFICER', 'HOD', 'COORDINATOR'])) throw new AppError('FORBIDDEN', 403)
  const groups = new Map((await Group.find({ _id: { $in: mine.map((r) => r.groupId) } }).lean()).map((g) => [String(g._id), g]))
  const people = new Map((await loadActors(uniq(mine.flatMap((r) => [r.reporterId, r.targetUserId].filter(Boolean))))).map((a) => [a.id, a]))
  const filt = mine.filter((r) => tab === 'all' || (tab === 'direct' && groups.get(String(r.groupId))?.kind === 'DIRECT') || (tab === 'class' && groups.get(String(r.groupId))?.kind === 'CLASS') || (tab === 'custom' && groups.get(String(r.groupId))?.kind === 'CUSTOM'))
  const open = mine.filter((r) => ['OPEN', 'IN_REVIEW'].includes(r.status))
  const resolved30 = mine.filter((r) => ['RESOLVED', 'DISMISSED'].includes(r.status) && Date.now() - new Date(r.updatedAt) < 30 * 86400_000)
  return {
    kpis: {
      unresolved: open.length, slaBreach: open.filter((r) => Date.now() - new Date(r.createdAt) > 24 * 3600_000).length, resolved30d: resolved30.length,
      medianTurnaroundHours: resolved30.length ? Math.round((resolved30.reduce((s, r) => s + (new Date(r.updatedAt) - new Date(r.createdAt)), 0) / resolved30.length / 3600_000) * 10) / 10 : 0,
      escalatedToCdc: mine.filter((r) => r.status === 'ESCALATED').length, dataLeakage: 0,
    },
    tabCounts: { all: mine.length, custom: mine.filter((r) => groups.get(String(r.groupId))?.kind === 'CUSTOM').length, class: mine.filter((r) => groups.get(String(r.groupId))?.kind === 'CLASS').length, direct: mine.filter((r) => groups.get(String(r.groupId))?.kind === 'DIRECT').length },
    items: filt.map((r) => ({
      id: String(r._id), code: r.code, kind: r.kind, priority: r.priority, status: r.status, route: r.route, subject: `${r.reason ?? 'Report'}${r.note ? ' — ' + r.note.slice(0, 40) : ''}`, target: people.get(strId(r.targetUserId))?.uid, targetName: people.get(strId(r.targetUserId))?.name,
      group: groups.get(String(r.groupId))?.name, evidenceCount: r.evidence.length, ago: ago(r.createdAt), createdAt: r.createdAt,
    })),
  }
}

export async function reportDetail(actor, id) {
  const r = await Report.findById(id).lean()
  if (!r) throw new AppError('NOT_FOUND', 404)
  if (!canReview(actor, r)) throw new AppError('FORBIDDEN', 403)
  const [rep, tgt] = await Promise.all([r.reporterId ? loadActor(r.reporterId) : null, r.targetUserId ? loadActor(r.targetUserId) : null])
  const g = await Group.findById(r.groupId).lean()
  const priors = tgt ? await Report.countDocuments({ targetUserId: tgt.id, status: 'RESOLVED', _id: { $ne: r._id } }) : 0
  return {
    id: String(r._id), code: r.code, kind: r.kind, priority: r.priority, status: r.status, reason: r.reason, route: r.route, createdAt: r.createdAt, group: g?.name, groupKind: g?.kind,
    // the reporter's identity is shown to the reviewer only as "protected" — never revealed to the reported person
    reporter: rep ? { uid: rep.uid.replace(/\d{3}$/, '***'), batch: org.get(rep.batchId)?.code, role: rep.roles.some((x) => x.role === 'CR') ? 'Class Rep Witness Verified' : 'Student', protected: true } : null,
    target: tgt ? { ...publicCard(tgt), semester: tgt.semester, priorInfractions: priors } : null, statement: r.note,
    evidence: r.evidence.map((e) => ({ messageId: String(e.messageId), senderName: e.senderName, senderUid: e.senderUid, body: e.body, at: e.at, tag: e.tag, context: e.context })), history: r.history, outcome: r.outcome,
    actions: ['dismiss', 'warn', 'mute', 'escalate'],
  }
}

export async function reportAction(actor, id, { action, note, messageId }) {
  const r = await Report.findById(id)
  if (!r) throw new AppError('NOT_FOUND', 404)
  if (!canReview(actor, r)) throw new AppError('FORBIDDEN', 403)
  const target = r.targetUserId ? await loadActor(r.targetUserId) : null
  let outcome
  if (action === 'dismiss') { r.status = 'DISMISSED'; outcome = 'No action' }
  else if (action === 'warn') { if (target) notify(target.id, { type: 'moderation', title: 'Formal warning issued', body: note ?? 'Your conduct was reported and a formal warning was recorded.', mutable: false }); r.status = 'RESOLVED'; outcome = 'Action taken: formal warning' }
  else if (action === 'mute') {
    if (!r.groupId || !target) throw new AppError('VALIDATION_FAILED', 422)
    await Membership.updateOne({ groupId: r.groupId, userId: target.id }, { mutedUntil: new Date(Date.now() + 24 * 3600_000) })
    notify(target.id, { type: 'moderation', title: 'You were muted for 24 hours', mutable: false }); r.status = 'RESOLVED'; outcome = 'Action taken: muted 24h'
  } else if (action === 'remove') {
    if (!messageId) throw new AppError('VALIDATION_FAILED', 422)
    await deleteMessage(actor, messageId, note ?? 'Removed after report review'); outcome = 'Message removed'; r.status = 'RESOLVED'
  } else if (action === 'escalate') { r.status = 'ESCALATED'; r.route = 'ADMIN'; outcome = 'Escalated to Admin / disciplinary committee' }
  else throw new AppError('VALIDATION_FAILED', 422)
  r.actionTaken = action; r.outcome = outcome; r.reviewedBy = actor._id; r.history.push({ by: actor._id, action, note })
  await r.save()
  if (r.reporterId) notify(r.reporterId, { type: 'report', title: `Report ${r.code}: ${outcome}`, mutable: false })
  await audit(actor, `report.${action}`, { category: 'content', target: { kind: 'report', id, label: r.code }, meta: { note } })
  return { ok: true, status: r.status, outcome }
}

export async function suspendFromReport(actor, id, reason) {
  const r = await Report.findById(id)
  if (!r || !r.targetUserId) throw new AppError('NOT_FOUND', 404)
  if (!hasAny(actor, ['ADMIN', 'SUPER_ADMIN'])) throw new AppError('FORBIDDEN', 403)
  await setStatus(actor, strId(r.targetUserId), 'SUSPENDED', reason ?? `Disciplinary: ${r.code}`)
  r.status = 'RESOLVED'; r.outcome = 'Account suspended'; r.history.push({ by: actor._id, action: 'suspend', note: reason }); await r.save()
  return { ok: true }
}
