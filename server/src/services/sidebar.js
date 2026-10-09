import { Group, Membership, Message, Announcement, Channel, ChannelFollow, ChannelPost, Desk, Term, CourseOffering, RoleAssignment, Notification, Ticket } from '../models/index.js'
import { org } from './org.js'
import { loadActors, loadActor, publicCard, currentTerm } from './actors.js'
import { groupsVisibleTo } from './groups.js'
import { unreadCounts } from './messages.js'
import { canPost, canRead, isManager, isModerator, scopeIdsFor, BOARD_PUBLISHERS, canPublish } from '../policy/index.js'
import { has, hasAny, holds, deptIdOf, roleLabel, rankOf } from '../policy/roles.js'
import { strId } from '../lib/util.js'
import { AppError, SENTENCES } from '../lib/errors.js'

export function landingFor(actor) {
  if (has(actor, 'SUPER_ADMIN')) return '/admin/admins'
  if (has(actor, 'ADMIN')) return '/admin/dashboard'
  if (has(actor, 'HOD') || has(actor, 'COORDINATOR')) return '/dept/dashboard'
  if (hasAny(actor, ['SA_OFFICER', 'SA_HEAD'])) return '/desks/student-affairs/queue'
  if (hasAny(actor, ['LIBRARIAN', 'LIBRARY_STAFF'])) return '/desks/library/queue'
  if (hasAny(actor, ['CAFE_MANAGER', 'CAFE_STAFF'])) return '/desks/cafe/queue'
  if (has(actor, 'EXAM_OFFICER')) return '/exam'
  if (hasAny(actor, ['PUBLISHER'])) return '/channels'
  return '/home'
}

export async function publishableScopes(actor) {
  const scopes = []
  for (const o of org.all()) {
    if (o.status === 'ARCHIVED') continue
    if (!['CAMPUS', 'DEPARTMENT', 'PROGRAM', 'BATCH'].includes(o.type)) continue
    if (canPublish(actor, o).allow) scopes.push({ id: String(o._id), type: o.type, code: o.code, name: o.name })
  }
  return scopes
}

export async function capabilities(actor) {
  const scopes = await publishableScopes(actor)
  const deskAgent = await Desk.find({ $or: [{ agentIds: actor._id }, { headIds: actor._id }] }).lean()
  const chain = (await Desk.find({ archived: { $ne: true } }).lean()).filter((d) => d.chain?.some((c) => hasAny(actor, [c.role])))
  const channelPub = await Channel.countDocuments({ $or: [{ publisherIds: actor._id }, { leadId: actor._id }] })
  const dept = hasAny(actor, ['HOD', 'COORDINATOR', 'PROGRAM_INCHARGE'])
  return {
    superAdmin: has(actor, 'SUPER_ADMIN'),
    admin: hasAny(actor, ['SUPER_ADMIN', 'ADMIN']),
    dept: dept || hasAny(actor, ['ADMIN', 'SUPER_ADMIN']), deptManage: hasAny(actor, ['HOD', 'COORDINATOR', 'ADMIN', 'SUPER_ADMIN']), deptHod: has(actor, 'HOD'),
    publishBoard: scopes.length > 0, boardScopes: scopes,
    publishChannels: channelPub > 0 || hasAny(actor, ['ADMIN', 'SA_HEAD', 'SA_OFFICER', 'PUBLISHER']),
    moderateChannels: hasAny(actor, ['ADMIN', 'SA_HEAD', 'SA_OFFICER', 'PUBLISHER', 'HOD', 'COORDINATOR']),
    submitToChannel: has(actor, 'SOCIETY_LEAD') || actor.kind === 'STUDENT',
    deskAgent: deskAgent.length > 0 || chain.length > 0, deskSlugs: [...new Set([...deskAgent, ...chain].map((d) => d.slug))],
    examCell: hasAny(actor, ['EXAM_OFFICER', 'ADMIN', 'SUPER_ADMIN']),
    reports: hasAny(actor, ['ADMIN', 'SUPER_ADMIN', 'SA_HEAD', 'SA_OFFICER', 'HOD', 'COORDINATOR']),
    relay: has(actor, 'CR'), forwardBoard: hasAny(actor, ['HOD', 'COORDINATOR']),
    createCustomGroup: actor.status === 'ACTIVE',
    audit: hasAny(actor, ['ADMIN', 'SUPER_ADMIN']),
  }
}

const sortByName = (a, b) => a.name.localeCompare(b.name)

export async function buildSidebar(actor) {
  const [{ memberships, grantedGroups }, unread, term] = await Promise.all([groupsVisibleTo(actor), unreadCounts(actor), currentTerm()])
  const memIds = [...memberships.keys()]
  const groups = await Group.find({ _id: { $in: memIds }, archived: { $ne: true } }).lean()
  const all = [...groups, ...grantedGroups.filter((g) => !g.archived)]
  const item = (g, mem) => {
    const batch = g.orgUnitId ? org.get(g.orgUnitId) : null
    return {
      id: String(g._id), kind: g.kind, template: g.template, name: g.name, glyph: g.glyph, restricted: g.restricted, announceOnly: g.announceOnly,
      code: g.kind === 'CLASS' || g.kind === 'CR_LINE' ? batch?.code : undefined, intake: batch?.intake,
      unread: unread[String(g._id)] ?? 0, via: mem ? 'member' : 'grant', role: mem?.groupRole, lastMessageAt: g.lastMessageAt,
      badge: g.kind === 'CR_LINE' ? (has(actor, 'CR') ? 'CR' : has(actor, 'TEACHER') ? undefined : undefined) : undefined,
    }
  }
  const items = all.map((g) => item(g, memberships.get(String(g._id))))
  const dmGroups = items.filter((i) => i.kind === 'DIRECT')
  const dms = []
  if (dmGroups.length) {
    const peers = await Membership.find({ groupId: { $in: dmGroups.map((d) => d.id) }, userId: { $ne: actor._id } }).lean()
    const actors = await loadActors(peers.map((p) => p.userId))
    const byUser = new Map(actors.map((a) => [a.id, a]))
    for (const d of dmGroups) {
      const p = peers.find((x) => String(x.groupId) === d.id)
      const peer = p && byUser.get(String(p.userId))
      if (peer) dms.push({ ...d, name: `${peer.name}${peer.roles.some((r) => r.role === 'CR') ? ' (CR)' : peer.roles.some((r) => r.role === 'HOD') ? ' (HOD)' : ''}`, peer: publicCard(peer) })
    }
  }
  const unreadBoard = await boardUnread(actor)
  const classes = items.filter((i) => i.kind === 'CLASS').sort((a, b) => (a.code ?? '').localeCompare(b.code ?? ''))
  // channels the user follows
  const follows = await ChannelFollow.find({ userId: actor._id }).lean()
  const channels = await Channel.find({ _id: { $in: follows.map((f) => f.channelId) }, archived: { $ne: true } }).lean()
  const chIds = channels.map((c) => c._id)
  const chUnread = await channelUnread(actor, chIds)
  const desks = await desksFor(actor)
  return {
    term: term ? { code: term.code, name: term.name } : null,
    announcements: { id: 'board', name: 'Announcements', glyph: '§', unread: unreadBoard },
    roleGroups: items.filter((i) => i.kind === 'ROLE').sort(sortByName),
    classes,
    crLines: items.filter((i) => i.kind === 'CR_LINE').sort((a, b) => (a.code ?? '').localeCompare(b.code ?? '')),
    customGroups: items.filter((i) => i.kind === 'CUSTOM').sort(sortByName),
    channels: channels.map((c) => ({ id: String(c._id), slug: c.slug, name: c.name, glyph: '★', unread: chUnread[String(c._id)] ?? 0, joinMode: c.joinMode, tag: c.joinMode === 'AUTO_LOCKED' ? 'OPEN' : undefined })).sort(sortByName),
    desks,
    directMessages: dms.sort(sortByName),
  }
}

async function boardUnread(actor) {
  const scopes = [...scopeIdsFor(actor)]
  const now = new Date()
  return Announcement.countDocuments({ scopeId: { $in: scopes }, status: 'PUBLISHED', 'acks.userId': { $ne: actor._id }, $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }], authorId: { $ne: actor._id } })
}

async function channelUnread(actor, chIds) {
  const out = {}
  const since = new Date(Date.now() - 7 * 86400_000)
  await Promise.all(chIds.map(async (id) => { out[String(id)] = await ChannelPost.countDocuments({ channelId: id, status: 'PUBLISHED', closed: { $ne: true }, createdAt: { $gt: since }, interestedBy: { $ne: actor._id }, savedBy: { $ne: actor._id } }) }))
  return out
}

export async function desksFor(actor) {
  const desks = await Desk.find({ archived: { $ne: true } }).lean()
  const out = []
  for (const d of desks) {
    const isAgent = (d.agentIds ?? []).some((x) => String(x) === actor.id) || (d.headIds ?? []).some((x) => String(x) === actor.id) || (d.chain ?? []).some((c) => has(actor, c.role) && (d.kind !== 'COORDINATOR' || holds(actor, c.role, d.orgUnitId)))
    let requester = false
    if (actor.kind === 'STUDENT') requester = d.kind === 'COORDINATOR' ? deptIdOf(actor) === strId(d.orgUnitId) : ['STUDENT_AFFAIRS', 'LIBRARY', 'CAFE', 'EXAM', 'GENERAL'].includes(d.kind)
    else requester = ['STUDENT_AFFAIRS', 'LIBRARY'].includes(d.kind) || (d.kind === 'COORDINATOR' && deptIdOf(actor) === strId(d.orgUnitId))
    if (!isAgent && !requester) continue
    const open = isAgent ? await Ticket.countDocuments({ deskId: d._id, status: { $in: ['OPEN', 'ESCALATED'] } }) : await Ticket.countDocuments({ deskId: d._id, requesterId: actor._id, status: { $in: ['OPEN', 'IN_PROGRESS', 'ESCALATED'] } })
    out.push({ id: String(d._id), slug: d.slug, name: d.name, glyph: '◇', kind: d.kind, mode: isAgent ? 'agent' : 'requester', open })
  }
  return out
}

export async function buildMe(actor) {
  const [sidebar, caps, notifUnread] = await Promise.all([buildSidebar(actor), capabilities(actor), Notification.countDocuments({ userId: actor._id, readAt: null })])
  const dept = org.get(deptIdOf(actor))
  const batch = actor.batchId ? org.get(actor.batchId) : null
  return {
    user: { ...publicCard(actor), email: actor.email, status: actor.status, semester: actor.semester, department: dept ? { id: String(dept._id), code: dept.code, name: dept.name } : null, batch: batch ? { id: String(batch._id), code: batch.code } : null, settings: actor.settings, mustChangePassword: actor.mustChangePassword },
    roles: actor.roles.map((r) => ({ role: r.role, label: roleLabel(r.role), orgUnit: org.get(r.orgUnitId)?.code, orgUnitId: r.orgUnitId, flags: r.flags })),
    landing: landingFor(actor), capabilities: caps, sidebar, notifications: { unread: notifUnread },
  }
}

// ---------- group details panel ----------
const sentenceForPoster = (group, mgr) => {
  if (group.announceOnly) {
    const names = [mgr?.name, ...[]].filter(Boolean)
    return `Only ${mgr ? `${mgr.name}${mgr.title ? ` (${mgr.title})` : ''}` : 'the group manager'}${group.posters?.length ? ` and ${group.posters.map((p) => roleLabel(p).toLowerCase()).join(', ')}s` : ''} post${mgr ? 's' : ''} in ${group.name} right now.`
  }
  return 'All members can post.'
}

export async function groupSummary(actor, groupId) {
  const group = await Group.findById(groupId).lean()
  if (!group) throw new AppError('NOT_FOUND', 404)
  const membership = await Membership.findOne({ groupId, userId: actor._id }).lean()
  const read = canRead(actor, group, membership)
  if (!read.allow) throw new AppError(read.code, 403, read.meta)
  const post = canPost(actor, group, membership)
  const members = await Membership.find({ groupId }).lean()
  const actors = await loadActors(members.map((m) => m.userId))
  const byId = new Map(actors.map((a) => [a.id, a]))
  const card = (m) => ({ ...publicCard(byId.get(String(m.userId))), groupRole: m.groupRole })
  const managers = members.filter((m) => m.groupRole === 'MANAGER').map(card)
  const moderators = members.filter((m) => m.groupRole === 'MODERATOR').map(card)
  const batch = group.kind === 'CLASS' || group.kind === 'CR_LINE' ? org.get(group.orgUnitId) : null
  let extra = {}
  if (group.kind === 'CR_LINE' || group.kind === 'CLASS') {
    const term = await currentTerm()
    const offerings = term ? await CourseOffering.find({ termId: term._id, batchId: group.orgUnitId }).lean() : []
    const teachers = await loadActors([...new Set(offerings.map((o) => String(o.teacherId)))])
    const tById = new Map(teachers.map((t) => [t.id, t]))
    const crs = members.filter((m) => byId.get(String(m.userId))?.roles.some((r) => r.role === 'CR' && strId(r.orgUnitId) === strId(group.orgUnitId))).map(card)
    extra = {
      batch: batch ? { id: String(batch._id), code: batch.code, section: batch.section } : undefined,
      crs, studentCount: group.kind === 'CLASS' ? members.filter((m) => byId.get(String(m.userId))?.kind === 'STUDENT').length : undefined,
      faculty: offerings.map((o) => ({ courseCode: o.courseCode, title: o.title, teacher: tById.get(String(o.teacherId)) ? { ...publicCard(tById.get(String(o.teacherId))), cabin: tById.get(String(o.teacherId)).cabin, email: tById.get(String(o.teacherId)).email } : null, room: o.room })),
      relayTarget: group.kind === 'CR_LINE' ? (await Group.findOne({ template: 'CLASS', orgUnitId: group.orgUnitId }).select('name _id').lean()) : undefined,
      crLine: group.kind === 'CLASS' ? (await Group.findOne({ template: 'CR_LINE', orgUnitId: group.orgUnitId }).select('name _id').lean()) : undefined,
    }
    if (extra.relayTarget) extra.relayTarget = { id: String(extra.relayTarget._id), name: extra.relayTarget.name }
    if (extra.crLine) extra.crLine = { id: String(extra.crLine._id), name: extra.crLine.name }
  }
  const files = await Message.find({ groupId, 'attachments.0': { $exists: true }, deletedAt: null }).sort({ createdAt: -1 }).limit(30).lean()
  const pinnedMsgs = group.pins?.length ? await Message.find({ _id: { $in: group.pins } }).lean() : []
  const mgrCard = managers[0]
  // student view on blocked composer: say who can post
  let composer = { canPost: post.allow, code: post.code, postedAs: post.meta?.postedAs }
  if (!post.allow) {
    composer.message = post.code === 'ANNOUNCE_ONLY'
      ? `Only ${mgrCard ? `${mgrCard.name} (${mgrCard.badges?.[0] ?? 'manager'})` : 'the manager'} posts in ${group.name} right now.`
      : post.meta?.reason === 'muted' ? `You are muted in ${group.name} until ${new Date(post.meta.until).toLocaleTimeString()}.` : post.meta?.reason === 'archived' ? 'This group is archived and read-only.' : SENTENCES[post.code]
    if (group.announceOnly) composer.deskLink = { slug: 'cs-coordinator', label: 'Open CS Coordinator Desk' }
  } else if (post.meta?.via === 'grant') composer.prefix = `Posting as ${roleLabel(post.meta.postedAs)}`
  else if (actor.roles.some((r) => r.role === 'CR') && group.kind === 'CLASS') composer.prefix = 'Posting as CR'
  return {
    group: {
      id: String(group._id), name: group.name, kind: group.kind, template: group.template, glyph: group.glyph, description: group.description, mandate: group.mandate,
      announceOnly: group.announceOnly, slowModeSeconds: group.slowModeSeconds, restricted: group.restricted, archived: group.archived, rules: group.rules,
      posters: group.posters, memberCount: members.length, orgUnit: org.get(group.orgUnitId)?.code, code: `CH-${(group.slug ?? group.name).toUpperCase().replace(/[^A-Z0-9]+/g, '-').slice(0, 24)}`,
      ownerId: group.ownerId ? String(group.ownerId) : undefined, pins: (group.pins ?? []).map(String), lastMessageAt: group.lastMessageAt,
    },
    managers, moderators, whoCanPost: sentenceForPoster(group, mgrCard), composer,
    me: { via: read.meta?.via, groupRole: membership?.groupRole, isManager: isManager(actor, group, membership), isModerator: isModerator(actor, group, membership), mutedUntil: membership?.mutedUntil, notify: membership?.notify, lastReadAt: membership?.lastReadAt },
    pinned: pinnedMsgs.map((m) => ({ id: String(m._id), body: m.body.slice(0, 200), sender: m.senderSnapshot?.name, attachments: m.attachments })),
    files: files.flatMap((m) => m.attachments.map((a) => ({ ...a, messageId: String(m._id), by: m.senderSnapshot?.name, at: m.createdAt }))),
    ...extra,
  }
}

export async function groupMembers(actor, groupId) {
  const group = await Group.findById(groupId).lean()
  const membership = await Membership.findOne({ groupId, userId: actor._id }).lean()
  const read = canRead(actor, group, membership)
  if (!read.allow) throw new AppError(read.code, 403, read.meta)
  // grant viewers aren't listed and students see classmates only
  const members = await Membership.find({ groupId }).lean()
  const actors = await loadActors(members.map((m) => m.userId))
  const byId = new Map(actors.map((a) => [a.id, a]))
  const gr = { MANAGER: 0, MODERATOR: 1, MEMBER: 2 }
  return members.map((m) => ({ ...publicCard(byId.get(String(m.userId))), groupRole: m.groupRole })).sort((a, b) => gr[a.groupRole] - gr[b.groupRole] || a.name.localeCompare(b.name))
}
