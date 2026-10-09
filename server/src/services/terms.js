import { Term, CourseOffering, OrgUnit, User, RoleAssignment, Group, Setting } from '../models/index.js'
import { org, loadOrg } from './org.js'
import { loadActors, invalidateTeaching, currentTerm } from './actors.js'
import { AppError } from '../lib/errors.js'
import { strId, uniq, sha256 } from '../lib/util.js'
import { audit } from '../lib/audit.js'
import { notify, notifyMany } from '../lib/notify.js'
import { resync, archiveBatchGroups } from './groups.js'
import { refreshAllRooms } from '../sockets/rooms.js'

export async function listTerms() {
  const terms = await Term.find().sort({ startsAt: -1 }).lean()
  return terms.map((t) => ({ id: String(t._id), code: t.code, name: t.name, startsAt: t.startsAt, endsAt: t.endsAt, current: t.current, rolledOverAt: t.rolledOverAt }))
}

export async function createTerm(actor, { code, name, startsAt, endsAt }) {
  code = String(code ?? '').toUpperCase()
  if (!/^(FA|SP)\d{2}$/.test(code)) throw new AppError('VALIDATION_FAILED', 422, { field: 'code', reason: 'Use a code like FA26 or SP27.' })
  const s = new Date(startsAt), e = new Date(endsAt)
  if (!(s < e)) throw new AppError('VALIDATION_FAILED', 422, { reason: 'End date must be after the start date.' })
  const overlap = await Term.findOne({ startsAt: { $lt: e }, endsAt: { $gt: s } })
  if (overlap) throw new AppError('CONFLICT', 409, { reason: `Dates overlap ${overlap.code}.` })
  if (await Term.findOne({ code })) throw new AppError('CONFLICT', 409, { reason: 'Term already exists.' })
  const t = await Term.create({ code, name: name ?? `${code.startsWith('FA') ? 'Fall' : 'Spring'} 20${code.slice(2)}`, startsAt: s, endsAt: e })
  await audit(actor, 'term.create', { category: 'structure', target: { kind: 'term', id: String(t._id), label: code } })
  return { id: String(t._id), code }
}

/** Per-department offering readiness for a target term. */
async function readiness(termCode) {
  const term = await Term.findOne({ code: termCode }).lean()
  if (!term) throw new AppError('NOT_FOUND', 404)
  const offs = await CourseOffering.find({ termId: term._id }).lean()
  const expectedSetting = (await Setting.findOne({ key: 'expectedOfferings' }).lean())?.value ?? {}
  const rows = []
  for (const d of org.ofType('DEPARTMENT').filter((x) => x.status === 'ACTIVE')) {
    const sub = new Set(org.subtree(d._id))
    const batches = org.ofType('BATCH').filter((b) => sub.has(String(b._id)) && b.status === 'ACTIVE')
    const mine = offs.filter((o) => sub.has(strId(o.batchId)))
    const synced = new Set(mine.map((o) => strId(o.batchId))).size
    const expected = expectedSetting[d.code] ?? batches.length * 6
    rows.push({ id: String(d._id), code: d.code, name: d.name, offeringsLoaded: mine.length, batchesSynced: synced, batches: batches.length, expected, status: mine.length > 0 || batches.length === 0 ? 'READY' : 'PENDING_INGESTION', ready: mine.length > 0 || batches.length === 0 })
  }
  return { term, rows, offerings: offs }
}

export async function rolloverPreview(actor, termCode) {
  const cur = await currentTerm()
  const { term, rows, offerings } = await readiness(termCode)
  const missing = rows.filter((r) => !r.ready)
  // teacher access diff: current term map vs target term map
  const now = new Map()
  if (cur) for (const o of await CourseOffering.find({ termId: cur._id }).lean()) { const k = strId(o.teacherId); (now.get(k) ?? now.set(k, new Set()).get(k)).add(strId(o.batchId)) }
  const next = new Map()
  for (const o of offerings) { const k = strId(o.teacherId); (next.get(k) ?? next.set(k, new Set()).get(k)).add(strId(o.batchId)) }
  const teacherIds = uniq([...now.keys(), ...next.keys()])
  const actors = new Map((await loadActors(teacherIds)).map((a) => [a.id, a]))
  const changes = []
  let gaining = 0, losing = 0
  for (const id of teacherIds) {
    const a = now.get(id) ?? new Set(), b = next.get(id) ?? new Set()
    const gain = [...b].filter((x) => !a.has(x)), lose = [...a].filter((x) => !b.has(x))
    if (gain.length || lose.length) { gaining += gain.length; losing += lose.length; changes.push({ teacher: actors.get(id)?.name, gains: gain.map((x) => org.get(x)?.code), losses: lose.map((x) => org.get(x)?.code) }) }
  }
  const graduating = org.ofType('BATCH').filter((b) => b.status === 'ACTIVE' && b.expectedGraduation === (cur?.code ?? ''))
  const gradStudents = await User.countDocuments({ batchId: { $in: graduating.map((b) => b._id) }, status: { $ne: 'INACTIVE' } })
  const parityExpected = rows.reduce((s, r) => s + r.expected, 0), parityLoaded = rows.reduce((s, r) => s + r.offeringsLoaded, 0)
  const facilities = (await Setting.findOne({ key: 'facilities' }).lean())?.value ?? []
  const stage = [
    { n: 1, title: 'Term Setup & Dates', status: term.startsAt && term.endsAt ? 'PASSED' : 'PENDING', detail: `${term.startsAt?.toISOString().slice(0, 10)} — ${term.endsAt?.toISOString().slice(0, 10)}` },
    { n: 2, title: 'Offerings Ingestion', status: missing.length ? 'ACTION_REQUIRED' : 'PASSED', detail: `${rows.length - missing.length}/${rows.length} synced` },
    { n: 3, title: 'Teacher & CR Sync', status: missing.length ? 'PENDING' : 'READY', detail: `${changes.length} teachers change lines` },
    { n: 4, title: 'Batch Archival', status: missing.length ? 'PENDING' : 'READY', detail: `${graduating.length} cohorts graduating` },
    { n: 5, title: 'Atomic Rollover', status: missing.length ? 'LOCKED' : 'READY', detail: 'Global commit' },
  ]
  return {
    from: cur?.code, to: term.code, gateway: missing.length ? 'BLOCKED' : 'OPEN', stages: stage, missingDepartments: missing.map((m) => ({ id: m.id, code: m.code, name: m.name })),
    departments: rows, parity: { loaded: parityLoaded, expected: parityExpected, percent: parityExpected ? Math.round((parityLoaded / parityExpected) * 1000) / 10 : 0 },
    impact: { graduatingCohorts: graduating.map((b) => ({ code: b.code, students: 0 })), graduatingStudents: gradStudents, facultyLines: changes.length, teacherLinesGained: gaining, teacherLinesLost: losing, socketRoomsRekeyed: (await Group.countDocuments({ kind: { $in: ['CLASS', 'CR_LINE'] }, orgUnitId: { $in: graduating.map((b) => b._id) } })) + changes.length * 1 },
    teacherChanges: changes, facilities, refreshSeconds: 30,
  }
}

export async function rolloverExecute(actor, termCode, { confirm } = {}) {
  const pre = await rolloverPreview(actor, termCode)
  if (pre.gateway === 'BLOCKED') throw new AppError('CONFLICT', 409, { reason: 'ROLLOVER_BLOCKED', missingDepartments: pre.missingDepartments, message: `${pre.missingDepartments.length} department(s) missing offerings.` })
  if (!confirm) throw new AppError('VALIDATION_FAILED', 422, { reason: 'Confirm to run the rollover.' })
  const cur = await currentTerm()
  const target = await Term.findOne({ code: termCode })
  await Term.updateMany({}, { current: false }); target.current = true; target.rolledOverAt = new Date(); await target.save()
  invalidateTeaching()
  const graduating = org.ofType('BATCH').filter((b) => b.status === 'ACTIVE' && b.expectedGraduation === cur?.code)
  for (const b of graduating) {
    await OrgUnit.updateOne({ _id: b._id }, { status: 'ARCHIVED' })
    await RoleAssignment.updateMany({ role: 'CR', orgUnitId: b._id, to: null }, { to: new Date() })
    await User.updateMany({ batchId: b._id, status: { $in: ['ACTIVE', 'FROZEN'] } }, { status: 'ALUMNI', alumniUntil: new Date(Date.now() + 182 * 86400_000) })
    await archiveBatchGroups(b._id)
  }
  await loadOrg(); invalidateTeaching()
  await resync(); await refreshAllRooms()
  const hash = sha256(`${termCode}:${Date.now()}`)
  await audit(actor, 'term.rollover', { category: 'structure', target: { kind: 'term', id: String(target._id), label: termCode }, meta: { from: cur?.code, archived: graduating.map((b) => b.code), hash } })
  return { ok: true, term: termCode, archived: graduating.map((b) => b.code), commitHash: `sha256:${hash.slice(0, 12)}...`, timestamp: new Date().toISOString(), auth: actor.name }
}

export async function setCurrentTerm(actor, code) {
  const pre = await rolloverPreview(actor, code)
  if (pre.gateway === 'BLOCKED') throw new AppError('CONFLICT', 409, { reason: 'ROLLOVER_BLOCKED', missingDepartments: pre.missingDepartments })
  return rolloverExecute(actor, code, { confirm: true })
}

/** Alumni lose access six months after graduation. */
export async function runAlumniJob() {
  const r = await User.updateMany({ status: 'ALUMNI', alumniUntil: { $lt: new Date() } }, { status: 'INACTIVE' })
  return r.modifiedCount
}
