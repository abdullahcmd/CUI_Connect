import { Channel, ChannelFollow, ChannelPost, User, Desk } from '../models/index.js'
import { org } from './org.js'
import { loadAllActors, loadActors } from './actors.js'
import { has, hasAny, holds, deptIdOf } from '../policy/roles.js'
import { AppError } from '../lib/errors.js'
import { strId, sanitize, uniq } from '../lib/util.js'
import { toRoom } from '../lib/realtime.js'
import { notify, notifyMany } from '../lib/notify.js'
import { audit } from '../lib/audit.js'

const SA_OWNED = (c) => org.get(c.ownerOfficeId)?.code === 'SA'

export function postTargetsUser(post, actor) {
  if (actor.kind !== 'STUDENT') return true
  const t = post.target ?? {}
  if (t.all) return true
  const batch = org.get(actor.batchId)
  if (!batch) return false
  const prog = org.programOf(batch._id)
  const checks = []
  if (t.programs?.length) checks.push(t.programs.includes(prog?.code))
  if (t.intakes?.length) checks.push(t.intakes.includes(batch.intake))
  if (t.years?.length) checks.push(t.years.includes(batch.year))
  if (t.batchIds?.length) checks.push(t.batchIds.some((b) => strId(b) === strId(batch._id)))
  if (t.semesterMin != null && actor.semester != null) checks.push(actor.semester >= t.semesterMin && actor.semester <= (t.semesterMax ?? 99))
  // multiple filters must all match (e.g. FA23/SP23 batches AND BSCS/BSE programs)
  return checks.length === 0 ? true : checks.every(Boolean)
}

export async function audienceCount(target) {
  const actors = await loadAllActors()
  return actors.filter((a) => a.kind === 'STUDENT' && a.status === 'ACTIVE' && postTargetsUser({ target }, a)).length
}

export function canManageChannel(actor, c) {
  if (hasAny(actor, ['ADMIN', 'SUPER_ADMIN'])) return true
  if (strId(c.leadId) === actor.id) return true
  if ((c.publisherIds ?? []).some((p) => strId(p) === actor.id)) return true
  if (SA_OWNED(c) && hasAny(actor, ['SA_HEAD', 'SA_OFFICER'])) return true
  if (c.scopeOrgId && (holds(actor, 'HOD', c.scopeOrgId) || holds(actor, 'COORDINATOR', c.scopeOrgId))) return true
  return false
}
export function canPublishChannel(actor, c) {
  if (c.kind === 'SOCIETY' && strId(c.leadId) === actor.id) return false // lead posts go to approval
  return canManageChannel(actor, c)
}
const canModerate = (actor, c) => hasAny(actor, ['ADMIN', 'SUPER_ADMIN']) || (c.kind === 'SOCIETY' ? hasAny(actor, ['SA_HEAD', 'SA_OFFICER']) : canManageChannel(actor, c))

const hoursLeft = (d) => (d ? Math.round((new Date(d) - Date.now()) / 3600_000) : null)
const fmtDay = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }).toUpperCase()

function presentPost(p, c, actor, authors) {
  const h = hoursLeft(p.applyBy)
  const author = authors?.get(String(p.authorId))
  return {
    id: String(p._id), channel: { id: String(c._id), slug: c.slug, name: c.name }, refNo: p.refNo, title: p.title, body: p.body, attachments: p.attachments, checklist: p.checklist,
    scopeLine: `${c.name.toUpperCase()} · ${(p.officeLabel ?? c.ownerLabel ?? '').toUpperCase()} · ${fmtDay(p.createdAt)}`,
    eligibility: p.eligibility, applyBy: p.applyBy, hoursLeft: h, daysLeft: h != null ? Math.ceil(h / 24) : null,
    urgent: p.urgent || (h != null && h > 0 && h <= 48), closed: p.closed || (h != null && h <= 0), status: p.status,
    interestedCount: p.interestedBy.length, interested: p.interestedBy.some((u) => String(u) === actor.id), saved: p.savedBy.some((u) => String(u) === actor.id),
    ask: { slug: p.askDeskSlug ?? c.deskSlug, label: p.askLabel ?? (c.deskSlug ? `Ask ${c.deskSlug === 'student-affairs' ? 'Student Affairs Desk' : 'the desk'}` : undefined) },
    author: author ? { id: author.id, name: author.name } : undefined, submission: p.submission, rejectReason: p.rejectReason, createdAt: p.createdAt,
    waitingApproval: p.status === 'PENDING',
  }
}

async function authorsFor(posts) {
  const as = await loadActors(uniq(posts.map((p) => p.authorId)))
  return new Map(as.map((a) => [a.id, a]))
}

export async function autoFollow(user) {
  const chs = await Channel.find({ joinMode: { $in: ['AUTO_LOCKED', 'AUTO_MUTE'] }, archived: { $ne: true } }).lean()
  for (const c of chs) {
    if (c.scopeOrgId && !(user.batchId ? org.isWithin(user.batchId, c.scopeOrgId) : true)) continue
    await ChannelFollow.updateOne({ channelId: c._id, userId: user._id }, { $setOnInsert: { muted: false } }, { upsert: true })
  }
}

export async function browse(actor) {
  const chs = await Channel.find({ archived: { $ne: true } }).sort({ kind: 1, name: 1 }).lean()
  const follows = await ChannelFollow.find({ userId: actor._id }).lean()
  const fmap = new Map(follows.map((f) => [String(f.channelId), f]))
  const counts = await ChannelFollow.aggregate([{ $group: { _id: '$channelId', n: { $sum: 1 } } }])
  const cm = new Map(counts.map((c) => [String(c._id), c.n]))
  const leadIds = uniq(chs.map((c) => c.leadId))
  const leads = await loadActors(leadIds)
  const lm = new Map(leads.map((l) => [l.id, l]))
  return chs.map((c) => ({
    id: String(c._id), slug: c.slug, code: c.code, name: c.name, initials: c.initials, kind: c.kind, tag: c.tag, description: c.description,
    subscribers: cm.get(String(c._id)) ?? 0, following: fmap.has(String(c._id)), muted: fmap.get(String(c._id))?.muted ?? false,
    joinMode: c.joinMode, immutable: c.joinMode === 'AUTO_LOCKED', canLeave: c.joinMode === 'OPT_IN', canMute: c.joinMode !== 'AUTO_LOCKED' || true,
    custodian: c.ownerLabel, lead: lm.get(strId(c.leadId))?.name, audience: c.audienceLabel, canPublish: canPublishChannel(actor, c), canManage: canManageChannel(actor, c),
    openSubmissions: c.openSubmissions,
  }))
}

export async function feed(actor, { limit = 40, before } = {}) {
  const follows = await ChannelFollow.find({ userId: actor._id, muted: { $ne: true } }).lean()
  const chs = await Channel.find({ _id: { $in: follows.map((f) => f.channelId) } }).lean()
  const cmap = new Map(chs.map((c) => [String(c._id), c]))
  const q = { channelId: { $in: chs.map((c) => c._id) }, status: 'PUBLISHED' }
  if (before) q._id = { $lt: before }
  const posts = (await ChannelPost.find(q).sort({ createdAt: -1 }).limit(limit * 3).lean()).filter((p) => postTargetsUser(p, actor)).slice(0, limit)
  const authors = await authorsFor(posts)
  return posts.map((p) => presentPost(p, cmap.get(String(p.channelId)), actor, authors))
}

export async function channelDetail(actor, slug) {
  const c = await Channel.findOne({ slug }).lean()
  if (!c) throw new AppError('NOT_FOUND', 404)
  const follow = await ChannelFollow.findOne({ channelId: c._id, userId: actor._id }).lean()
  const subscribers = await ChannelFollow.countDocuments({ channelId: c._id })
  const mine = { authorId: actor._id }
  const manage = canManageChannel(actor, c)
  const posts = (await ChannelPost.find({ channelId: c._id, $or: [{ status: 'PUBLISHED' }, mine, ...(manage ? [{ status: 'PENDING' }] : [])] }).sort({ createdAt: -1 }).limit(60).lean()).filter((p) => p.status !== 'PUBLISHED' || postTargetsUser(p, actor) || manage)
  const authors = await authorsFor(posts)
  const items = posts.map((p) => presentPost(p, c, actor, authors))
  const active = items.filter((i) => i.applyBy && !i.closed && i.status === 'PUBLISHED').sort((a, b) => new Date(a.applyBy) - new Date(b.applyBy))
  const lead = c.leadId ? (await loadActors([c.leadId]))[0] : null
  return {
    channel: { id: String(c._id), slug: c.slug, code: c.code, name: c.name, kind: c.kind, tag: c.tag, description: c.description, about: c.about, tags: c.tags, ownerLabel: c.ownerLabel, joinMode: c.joinMode, requireApproval: c.requireApproval, subscribers, contact: c.contact, deskSlug: c.deskSlug, lead: lead ? { id: lead.id, name: lead.name } : null },
    me: { following: !!follow, muted: follow?.muted ?? false, canLeave: c.joinMode === 'OPT_IN', canPublish: canPublishChannel(actor, c), canManage: manage, canSubmit: c.kind === 'SOCIETY' ? strId(c.leadId) === actor.id : c.openSubmissions && actor.kind === 'STUDENT' },
    posts: items.filter((i) => i.status === 'PUBLISHED' || i.status === 'PENDING' || i.status === 'REJECTED'),
    deadlines: active.map((i) => ({ id: i.id, title: i.title, applyBy: i.applyBy, hoursLeft: i.hoursLeft, daysLeft: i.daysLeft, urgent: i.urgent, place: i.checklist?.[0] ? undefined : undefined })),
    activeDeadlines: active.length,
  }
}

export async function follow(actor, channelId, on = true) {
  const c = await Channel.findById(channelId).lean()
  if (!c) throw new AppError('NOT_FOUND', 404)
  if (on) { await ChannelFollow.updateOne({ channelId, userId: actor._id }, { $setOnInsert: { muted: false } }, { upsert: true }); return { ok: true, following: true } }
  if (c.joinMode === 'AUTO_LOCKED') throw new AppError('FORBIDDEN', 403, { reason: "This is an official channel. You can't leave it." })
  if (c.joinMode === 'AUTO_MUTE') { await ChannelFollow.updateOne({ channelId, userId: actor._id }, { muted: true }); return { ok: true, following: true, muted: true } }
  await ChannelFollow.deleteOne({ channelId, userId: actor._id })
  return { ok: true, following: false }
}

export async function setMute(actor, channelId, muted) {
  const c = await Channel.findById(channelId).lean()
  if (c.joinMode === 'AUTO_LOCKED' && muted) throw new AppError('FORBIDDEN', 403, { reason: "Scholarship circulars can't be muted." })
  await ChannelFollow.updateOne({ channelId, userId: actor._id }, { muted })
  return { ok: true, muted }
}

export async function submitPost(actor, channelId, p) {
  const c = await Channel.findById(channelId).lean()
  if (!c) throw new AppError('NOT_FOUND', 404)
  const manage = canPublishChannel(actor, c)
  const submit = (c.kind === 'SOCIETY' && strId(c.leadId) === actor.id) || (c.openSubmissions && actor.kind === 'STUDENT')
  if (!manage && !submit) throw new AppError('FORBIDDEN', 403, { reason: 'You can’t post to this channel.' })
  const title = sanitize(p.title)
  if (!title) throw new AppError('VALIDATION_FAILED', 422, { field: 'title' })
  const status = manage && !c.requireApproval ? 'PUBLISHED' : manage ? 'PUBLISHED' : 'PENDING'
  const post = await ChannelPost.create({
    channelId, authorId: actor._id, title, body: sanitize(p.body ?? ''), attachments: p.attachments ?? [], target: p.target ?? { all: true }, eligibility: p.eligibility, checklist: p.checklist,
    applyBy: p.applyBy, urgent: !!p.urgent, officeLabel: p.officeLabel ?? c.ownerLabel, status, refNo: p.refNo, askDeskSlug: p.askDeskSlug,
    submission: status === 'PENDING' ? { regNo: actor.uid, eventDate: p.eventDate, cutoff: p.cutoff ?? p.applyBy, submitterName: actor.name, scopeNote: p.scopeNote } : undefined,
  })
  const authors = await authorsFor([post])
  const dto = presentPost(post.toObject(), c, actor, authors)
  if (status === 'PUBLISHED') await publishFanOut(post, c, actor)
  else await notifyModerators(c, post, actor)
  await audit(actor, status === 'PUBLISHED' ? 'channel.publish' : 'channel.submit', { category: 'content', target: { kind: 'channelPost', id: String(post._id), label: title } })
  return dto
}

async function publishFanOut(post, c, actor) {
  const p = post.toObject ? post.toObject() : post
  toRoom(`channel:${c._id}`, 'channel:post', { channelId: String(c._id), post: presentPost(p, c, actor, new Map([[actor.id, actor]])) })
  const follows = await ChannelFollow.find({ channelId: c._id, muted: { $ne: true } }).lean()
  const actors = await loadAllActors()
  const am = new Map(actors.map((a) => [a.id, a]))
  const targets = follows.map((f) => String(f.userId)).filter((u) => am.get(u) && postTargetsUser(p, am.get(u)) && u !== actor.id)
  await notifyMany(targets, { type: 'channel', title: `${c.name}: ${p.title}`, link: `/channels/${c.slug}`, mutable: c.joinMode !== 'AUTO_LOCKED' })
}

async function notifyModerators(c, post, actor) {
  const actors = await loadAllActors()
  const mods = actors.filter((a) => canModerate(a, c)).map((a) => a.id)
  await notifyMany(mods, { type: 'submission', title: `New submission: ${post.title}`, body: `From ${actor.name}`, link: '/channels/moderation', mutable: false })
}

export async function moderationQueue(actor) {
  const chs = (await Channel.find({ archived: { $ne: true } }).lean()).filter((c) => canModerate(actor, c))
  if (!chs.length) {
    if (!hasAny(actor, ['SA_HEAD', 'SA_OFFICER', 'ADMIN', 'SUPER_ADMIN'])) throw new AppError('FORBIDDEN', 403)
  }
  const cmap = new Map(chs.map((c) => [String(c._id), c]))
  const posts = await ChannelPost.find({ channelId: { $in: chs.map((c) => c._id) }, status: 'PENDING' }).sort({ createdAt: 1 }).lean()
  const authors = await authorsFor(posts)
  const now = Date.now()
  return posts.map((p) => ({ ...presentPost(p, cmap.get(String(p.channelId)), actor, authors), ref: `SUB-${String(p._id).slice(-3).toUpperCase()}`, submittedAgo: Math.round((now - new Date(p.createdAt)) / 60000) }))
}

export async function reviewPost(actor, postId, { action, reason, edits }) {
  const post = await ChannelPost.findById(postId)
  if (!post) throw new AppError('NOT_FOUND', 404)
  const c = await Channel.findById(post.channelId).lean()
  if (!canModerate(actor, c)) throw new AppError('FORBIDDEN', 403)
  if (action === 'approve') {
    if (edits) for (const k of ['title', 'body', 'applyBy', 'eligibility']) if (edits[k] !== undefined) post[k] = k === 'title' || k === 'body' ? sanitize(edits[k]) : edits[k]
    post.status = 'PUBLISHED'
  } else if (action === 'reject') {
    if (!reason) throw new AppError('VALIDATION_FAILED', 422, { field: 'reason' })
    post.status = 'REJECTED'; post.rejectReason = reason
  } else throw new AppError('VALIDATION_FAILED', 422)
  post.reviewedBy = actor._id; post.reviewedAt = new Date()
  await post.save()
  await notify(post.authorId, { type: 'submission', title: action === 'approve' ? `Approved: ${post.title}` : `Rejected: ${post.title}`, body: reason, link: '/channels/submissions', mutable: false })
  if (action === 'approve') await publishFanOut(post, c, actor)
  await audit(actor, `channel.${action}`, { category: 'content', target: { kind: 'channelPost', id: postId, label: post.title }, meta: { reason } })
  return { ok: true, status: post.status }
}

export async function mySubmissions(actor) {
  const posts = await ChannelPost.find({ authorId: actor._id }).sort({ createdAt: -1 }).lean()
  const chs = await Channel.find({ _id: { $in: posts.map((p) => p.channelId) } }).lean()
  const cmap = new Map(chs.map((c) => [String(c._id), c]))
  return posts.map((p) => presentPost(p, cmap.get(String(p.channelId)), actor, new Map([[actor.id, actor]])))
}

export async function toggleInterest(actor, postId, kind) {
  const post = await ChannelPost.findById(postId)
  if (!post || post.status !== 'PUBLISHED') throw new AppError('NOT_FOUND', 404)
  if (!postTargetsUser(post, actor)) throw new AppError('NOT_MEMBER', 403)
  const field = kind === 'save' ? 'savedBy' : 'interestedBy'
  const has_ = post[field].some((u) => String(u) === actor.id)
  post[field] = has_ ? post[field].filter((u) => String(u) !== actor.id) : [...post[field], actor._id]
  await post.save()
  toRoom(`channel:${post.channelId}`, 'channel:counts', { postId, interestedCount: post.interestedBy.length })
  return { ok: true, on: !has_, interestedCount: post.interestedBy.length }
}

export async function insights(actor, slug) {
  const c = await Channel.findOne({ slug }).lean()
  if (!c || !canManageChannel(actor, c)) throw new AppError('FORBIDDEN', 403)
  const posts = await ChannelPost.find({ channelId: c._id, status: { $in: ['PUBLISHED', 'ARCHIVED'] } }).lean()
  const subs = await ChannelFollow.countDocuments({ channelId: c._id })
  // aggregate only — never individual student activity
  return { channel: c.name, subscribers: subs, posts: posts.map((p) => ({ id: String(p._id), title: p.title, interested: p.interestedBy.length, saved: p.savedBy.length, applyBy: p.applyBy })), totals: { interested: posts.reduce((s, p) => s + p.interestedBy.length, 0), saved: posts.reduce((s, p) => s + p.savedBy.length, 0) } }
}

/** 48-hour apply-by reminders and cycle closing. Runs on a timer. */
export async function runDeadlineJobs() {
  const now = Date.now()
  const soon = await ChannelPost.find({ status: 'PUBLISHED', reminded48: false, applyBy: { $gt: new Date(now), $lte: new Date(now + 48 * 3600_000) } })
  for (const p of soon) {
    await notifyMany([...p.interestedBy, ...p.savedBy], { type: 'reminder', title: `Apply by ${new Date(p.applyBy).toDateString()}: ${p.title}`, link: `/channels/posts/${p._id}` })
    p.reminded48 = true; p.urgent = true; await p.save()
  }
  const closed = await ChannelPost.updateMany({ status: 'PUBLISHED', closed: false, applyBy: { $lte: new Date(now), $ne: null } }, { closed: true })
  return { reminded: soon.length, closed: closed.modifiedCount }
}
