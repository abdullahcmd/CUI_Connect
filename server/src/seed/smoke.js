// End-to-end checks against a running server: REST + live sockets + boundary bypass attempts.
// Usage: npm start (in another terminal) then npm run smoke
import { io } from 'socket.io-client'

const API = process.env.API ?? "https://localhost:4000"
const PW = 'Password@123'
let pass = 0, fail = 0
const ok = (name, cond, extra) => { cond ? pass++ : fail++; console.log(`${cond ? '  ✓' : '  ✗'} ${name}${cond ? '' : '  → ' + JSON.stringify(extra)}`) }

async function req(method, path, token, body) {
  const r = await fetch(API + '/api' + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const text = await r.text(); let data; try { data = JSON.parse(text) } catch { data = text }
  return { status: r.status, data }
}
const login = async (uid, pw = PW) => { const r = await req('POST', '/auth/login', null, { uid, password: pw }); return r.data.accessToken ? { token: r.data.accessToken, refresh: r.data.refreshToken } : { error: r } }
const connect = (token) => new Promise((resolve, reject) => { const s = io(API, { auth: { token }, transports: ['websocket'], rejectUnauthorized: false }); s.on('ready', () => resolve(s)); s.on('connect_error', reject) })
const emit = (s, ev, p) => new Promise((resolve) => s.timeout(8000).emit(ev, p, (err, res) => resolve(err ? { ok: false, code: 'TIMEOUT' } : res)))
const wait = (s, ev, ms = 4000) => new Promise((resolve) => { const t = setTimeout(() => resolve(null), ms); s.once(ev, (d) => { clearTimeout(t); resolve(d) }) })

console.log('\nAUTH')
let r = await req('POST', '/auth/login', null, { uid: 'FA23-BCS-052', password: 'wrong-password' })
ok('wrong password → 401 INVALID_CREDENTIALS', r.status === 401 && r.data.code === 'INVALID_CREDENTIALS', r.data)
r = await req('POST', '/auth/login', null, { uid: 'NOPE-000', password: 'x' })
ok('unknown id returns same error (no hint)', r.status === 401 && r.data.code === 'INVALID_CREDENTIALS', r.data)
const bilal = await login('FA23-BCS-052'); ok('student login', !!bilal.token, bilal)
const act = await login('FA26-BCS-014', 'Temp-Pass-2026!'); ok('new student logs in with temp password', !!act.token, act)
r = await req('GET', '/groups', act.token); ok('un-activated user blocked from the app', r.status === 403 && r.data.code === 'ACTIVATION_REQUIRED', r.data)
r = await req('POST', '/auth/activate', act.token, { currentPassword: 'Temp-Pass-2026!', newPassword: 'Brand-New-Pass-9!', acceptPolicy: true }); ok('activation succeeds', r.status === 200, r.data)
r = await req('POST', '/auth/forgot', null, { uid: 'FA23-BCS-052' }); ok('forgot password: generic message', r.data.ok === true)
r = await req('GET', '/dev/mailbox?to=fa23-bcs-052@students.comsats.edu.pk'); const code = /Code: (\d{6})/.exec(r.data[0]?.body ?? '')?.[1]; ok('code lands in dev mailbox', !!code, r.data)
r = await req('POST', '/auth/verify', null, { uid: 'FA23-BCS-052', code: '000000' }); ok('wrong code rejected', r.status === 400, r.data)
r = await req('POST', '/auth/verify', null, { uid: 'FA23-BCS-052', code }); ok('correct code gives reset token', !!r.data.resetToken, r.data)
r = await req('POST', '/auth/reset', null, { resetToken: r.data.resetToken, password: PW }); ok('password reset (back to demo password)', r.status === 200, r.data)

console.log('\nME + SIDEBAR')
const B = await login('FA23-BCS-052')
r = await req('GET', '/me', B.token)
ok('/me returns sidebar with class, CR line grant hidden for student', r.status === 200 && r.data.sidebar.classes.length === 1 && r.data.sidebar.crLines.length === 0, r.data.sidebar?.classes)
ok('student sees Scholarships channel + desks + DM', r.data.sidebar.channels.some((c) => c.slug === 'scholarships') && r.data.sidebar.desks.length >= 3 && r.data.sidebar.directMessages.length === 1)
const classId = r.data.sidebar.classes[0].id
const asif = await login('EMP-CS-001'); const meA = await req('GET', '/me', asif.token)
ok('HOD sees every CS class via grants', meA.data.sidebar.classes.length >= 6, meA.data.sidebar.classes.map((c) => c.code))
const babar = await login('EMP-CS-010'); const meB = await req('GET', '/me', babar.token)
ok('teacher sees only CR lines of batches taught, no classes', meB.data.sidebar.classes.length === 0 && meB.data.sidebar.crLines.length >= 2, [meB.data.sidebar.classes.length, meB.data.sidebar.crLines.map((c) => c.code)])
const crLineId = meB.data.sidebar.crLines.find((c) => c.code === 'FA23-BCS')?.id

console.log('\nREAL-TIME MESSAGING')
const sB = await connect(B.token); const sH = await connect((await login('FA23-BCS-041')).token); const sT = await connect(babar.token); const sAsif = await connect(asif.token)
let p = wait(sH, 'message:new')
let res = await emit(sB, 'message:send', { groupId: classId, body: 'Smoke test: hello class', clientId: 'c-1' })
ok('student sends to class group (ack ok, clientId echoed)', res.ok && res.data.clientId === 'c-1', res)
const got = await p; ok('classmate receives message:new live', got?.body === 'Smoke test: hello class' && got.sender.name === 'Bilal Ahmed', got)
res = await emit(sT, 'message:send', { groupId: classId, body: 'teacher bypass attempt' })
ok('BYPASS: teacher raw emit to class group → NOT_MEMBER', res.ok === false && res.code === 'NOT_MEMBER', res)
res = await emit(sT, 'group:open', { groupId: classId }); ok('BYPASS: teacher cannot open class group (and is routed to CR line)', res.code === 'NOT_MEMBER' && /CR line/i.test(res.meta?.route?.message ?? ''), res)
res = await emit(sB, 'dm:open', { userId: meB.data.user.id }); ok('student → teacher DM: FORBIDDEN_DM with CR route', res.code === 'FORBIDDEN_DM' && res.meta?.route?.type === 'CR', res)
res = await emit(sT, 'dm:open', { userId: meA.data.user.id }); ok('teacher → HOD DM allowed', res.ok, res)
const meBil = r.data
res = await emit(sB, 'board:publish', { scopeId: meBil.user.department.id, title: 'Student tries to publish', body: 'x' })
ok('BYPASS: student board:publish → BOARD_SCOPE', res.code === 'BOARD_SCOPE', res)
res = await emit(sB, 'group:announceOnly', { groupId: classId, on: true }); ok('student cannot toggle announce-only', res.code === 'FORBIDDEN', res)

console.log('\nANNOUNCE-ONLY, CR LINE, RELAY')
res = await emit(sAsif, 'message:send', { groupId: classId, body: 'HOD update to class (via grant)' }); ok('HOD posts in class group via grant, posted as HOD', res.ok && res.data.postedAs === 'HOD', res)
res = await emit(sT, 'message:send', { groupId: crLineId, body: 'Smoke: Quiz 3 moved to Friday', clientId: 'cr-1' }); ok('teacher posts in CR line of own batch', res.ok, res)
const tMsg = res.data
const sCR = sH; // Hamza is CR
res = await emit(sCR, 'group:open', { groupId: crLineId }); ok('CR opens CR line', res.ok, res)
const crSum = res.data?.summary
res = await emit(sCR, 'message:relay', { messageId: tMsg.id, toGroupId: classId, note: 'Please note' }); ok('CR relays CR-line message to class group', res.ok && res.data.relayOf?.messageId === tMsg.id, res)
res = await emit(sCR, 'message:relay', { messageId: tMsg.id, toGroupId: classId }); ok('second relay warns "already relayed"', res.code === 'CONFLICT' && res.meta?.reason === 'ALREADY_RELAYED', res)
res = await emit(sB, 'message:relay', { messageId: tMsg.id, toGroupId: classId, confirm: true }); ok('BYPASS: non-CR cannot relay', res.ok === false, res)
res = await emit(sT, 'message:relay', { messageId: tMsg.id, toGroupId: classId, confirm: true }); ok('BYPASS: teacher cannot relay', res.code === 'NOT_CR' || res.code === 'NOT_MEMBER' || res.ok === false, res)
// announce-only
const teachersGroup = meA.data.sidebar.roleGroups.find((g) => g.template === 'TEACHERS')
res = await emit(sT, 'message:send', { groupId: teachersGroup.id, body: 'Teacher tries announce-only group' }); ok('announce-only: ordinary teacher denied', res.code === 'ANNOUNCE_ONLY', res)
res = await emit(sAsif, 'message:send', { groupId: teachersGroup.id, body: 'HOD posts in Teachers — CS' }); ok('announce-only: manager (HOD) allowed', res.ok, res)
res = await emit(sB, 'group:open', { groupId: teachersGroup.id }); ok('student cannot open Teachers — CS', res.code === 'NOT_MEMBER', res)

console.log('\nEDIT / REACT / THREAD / PIN')
res = await emit(sB, 'message:edit', { messageId: got.id, body: 'Smoke test: edited' }); ok('edit own message', res.ok && res.data.editedAt, res)
res = await emit(sH, 'message:edit', { messageId: got.id, body: 'hack' }); ok('cannot edit others’ messages', res.ok === false, res)
res = await emit(sH, 'message:react', { messageId: got.id, emoji: '👍' }); ok('react', res.ok && res.data.reactions[0].count === 1, res)
res = await emit(sB, 'message:send', { groupId: classId, body: 'thread reply', threadOf: got.id }); ok('thread reply', res.ok, res)
res = await emit(sB, 'message:delete', { messageId: got.id }); ok('delete own message', res.ok, res)
for (let i = 0; i < 12; i++) res = await emit(sB, 'message:send', { groupId: classId, body: `flood ${i}` })
ok('rate limit: >10 messages / 10s → RATE_LIMITED', res.code === 'RATE_LIMITED', res)

console.log('\nBOARD')
const adm = await login('ADM-001'); const hodAdmin = await req('GET', '/board/scopes', adm.token)
ok('admin can publish to university scope', hodAdmin.data.scopes.some((s) => s.type === 'CAMPUS'))
const campusScope = hodAdmin.data.scopes.find((s) => s.type === 'CAMPUS')
r = await req('POST', '/board', adm.token, { scopeId: campusScope.id, category: 'GENERAL', title: 'Smoke: library timings', body: 'Library is open till 9pm', mandatoryAck: true })
ok('publish announcement', r.status === 201 && r.data.audienceCount > 100, r.data)
const annId = r.data.id
const feedP = wait(sB, 'board:new'); r = await req('POST', '/board', adm.token, { scopeId: campusScope.id, title: 'Smoke: live board push', body: 'x' }); const live = await feedP; ok('board:new pushed live to student', live?.title === 'Smoke: live board push', live)
r = await req('POST', `/board/${annId}/ack`, B.token); ok('student acknowledges', r.status === 200 && r.data.count === 1, r.data)
r = await req('GET', `/board/${annId}/acks`, adm.token); ok('publisher sees ack report with cohorts', r.data.acked === 1 && r.data.cohorts.length > 3, r.data?.cohorts?.length)
r = await req('POST', '/board', B.token, { scopeId: campusScope.id, title: 'student publish', body: 'x' }); ok('REST: student publish → BOARD_SCOPE', r.data.code === 'BOARD_SCOPE', r.data)
const coordTariq = await login('EMP-CS-002')
r = await req('POST', '/board', coordTariq.token, { scopeId: campusScope.id, title: 'Coordinator tries campus-wide', body: 'y' }); ok('coordinator cannot publish university-wide', r.data.code === 'BOARD_SCOPE', r.data)
r = await req('GET', '/board', B.token); ok('board feed for student includes pinned first', r.data.pinned.length >= 1 && r.data.items.length >= 5, r.data.pinned?.length)

console.log('\nCHANNELS')
r = await req('GET', '/channels/scholarships', B.token); ok('scholarships feed + deadlines + contact', r.data.posts.length >= 3 && r.data.deadlines.length >= 1 && r.data.channel.contact?.ext, r.data.posts?.length)
const need = r.data.posts.find((x) => x.refNo === 'FA26-AID-102')
r = await req('POST', `/channel-posts/${need.id}/interest`, B.token); ok('Interested toggles', r.data.on === true && r.data.interestedCount === 49, r.data)
const zainabTok = await login('FA24-BCS-044'); r = await req('GET', '/channels/scholarships', zainabTok.token)
ok('targeting: FA24 student does not see FA23/SP23-targeted post', !r.data.posts.some((x) => x.refNo === 'FA26-AID-102'), r.data.posts.map((x) => x.refNo))
r = await req('POST', '/channels/' + (await req('GET', '/channels', B.token)).data.find((c) => c.slug === 'scholarships').id + '/follow', B.token); r = await req('DELETE', '/channels/' + (await req('GET', '/channels', B.token)).data.find((c) => c.slug === 'scholarships').id + '/follow', B.token); ok('cannot leave an official auto channel', r.status === 403, r.data)
const sa3 = await login('EMP-SA-004'); r = await req('GET', '/channels/moderation', sa3.token); ok('SA officer sees moderation queue (3 pending)', r.data.length === 3, r.data?.length)
r = await req('POST', `/channel-posts/${r.data[0].id}/approve`, sa3.token); ok('approve submission', r.data.status === 'PUBLISHED', r.data)

console.log('\nDESKS & TICKETS')
r = await req('POST', '/tickets', B.token, { deskSlug: 'student-affairs', category: 'Transport Pass', subject: 'Smoke ticket: new pass', description: 'Need a new pass' }); ok('create ticket (auto-assigned to counter 4)', r.status === 201 && r.data.ticket.counterNo === 4, r.data)
const tid = r.data.ticket.id
r = await req('POST', '/tickets', B.token, { deskSlug: 'student-affairs', category: 'Transport Pass', subject: 'Smoke ticket duplicate', description: 'x' }); ok('duplicate open ticket warns', r.data.code === 'CONFLICT' && r.data.meta?.reason === 'DUPLICATE_OPEN_TICKET', r.data)
const sa4 = await login('EMP-SA-005'); r = await req('GET', '/desks/student-affairs/queue', sa4.token); ok('agent sees queue', r.data.items.length >= 4, r.data.total)
r = await req('POST', `/tickets/${tid}/reply`, sa4.token, { body: 'internal: verify RFID', internal: true }); ok('internal note', r.status === 201, r.data)
r = await req('GET', `/tickets/${tid}`, B.token); ok('requester never sees internal notes', !r.data.thread.some((m) => m.internal), r.data.thread)
r = await req('POST', `/tickets/${tid}/escalate`, sa4.token, { reason: 'needs approval' }); ok('escalate to level 2 (SA Head)', r.data.level === 2 && r.data.status === 'ESCALATED', r.data)
r = await req('POST', `/tickets/${tid}/resolve`, (await login('EMP-SA-001')).token, { note: 'New RFID issued' }); ok('SA Head resolves', r.data.status === 'RESOLVED', r.data)
r = await req('POST', `/tickets/${tid}/reopen`, B.token); ok('requester reopens within 72h', r.data.status === 'IN_PROGRESS', r.data)
r = await req('GET', `/tickets/${tid}`, (await login('EMP-LIB-002')).token); ok('BYPASS: other desk agent → TICKET_SCOPE', r.data.code === 'TICKET_SCOPE', r.data)

console.log('\nADMIN / STRUCTURE')
r = await req('GET', '/admin/dashboard', B.token); ok('student blocked from admin console', r.status === 403, r.data)
r = await req('GET', '/admin/dashboard', adm.token); ok('admin dashboard counts', r.data.counts.users > 150, r.data.counts)
const sup = await login('SA-001')
r = await req('POST', '/admin/admins', adm.token, { uid: 'ADM-009', name: 'Test Admin', email: 'test.admin@comsats.edu.pk' }); ok('Admin cannot create Admins', r.status === 403, r.data)
r = await req('POST', '/admin/admins', sup.token, { uid: 'ADM-009', name: 'Test Admin', email: 'test.admin@comsats.edu.pk' }); ok('Super Admin creates Admin', r.status === 201, r.data)
r = await req('POST', '/admin/departments', adm.token, { name: 'Physics', code: 'PH', hodId: null, programs: [], coordinatorIds: [] }); ok('wizard rejects incomplete hierarchy', r.data.code === 'INCOMPLETE_HIERARCHY' && r.data.meta.missing.length === 3, r.data)
const hrAsif = await req('GET', '/me', asif.token)
r = await req('POST', '/admin/roles', adm.token, { userId: hrAsif.data.user.id, role: 'SUPER_ADMIN', orgUnitId: campusScope.id }); ok('cannot assign Super Admin through the API', r.status === 403, r.data)
r = await req('POST', '/admin/roles', coordTariq.token, { userId: hrAsif.data.user.id, role: 'HOD', orgUnitId: campusScope.id }); ok('coordinator cannot assign HOD', r.status === 403, r.data)
const csDept = (await req('GET', '/admin/departments', adm.token)).data.find((d) => d.code === 'CS')
r = await req('POST', '/dept/batches', coordTariq.token, { programCode: 'BCS', intake: 'FA', year: 2025 }); ok('coordinator creates batch FA25-BCS', r.status === 201 && r.data.code === 'FA25-BCS', r.data)
r = await req('POST', '/dept/batches', coordTariq.token, { programCode: 'BCS', intake: 'FA', year: 2025 }); ok('duplicate batch code rejected', r.status === 409, r.data)
const eeCoord = await login('EMP-EE-002'); r = await req('POST', '/dept/batches', eeCoord.token, { programCode: 'BCS', intake: 'SP', year: 2025 }); ok('EE coordinator cannot create CS batch (DEPARTMENT_BOUNDARY)', r.data.code === 'DEPARTMENT_BOUNDARY', r.data)
r = await req('GET', `/admin/terms/SP27/rollover`, adm.token); ok('rollover blocked: MS missing offerings', r.data.gateway === 'BLOCKED' && r.data.missingDepartments[0]?.code === 'MS', r.data.missingDepartments)
r = await req('POST', '/admin/users', coordTariq.token, { uid: 'FA23-BCS-199', name: 'X', email: 'x@y.com' }); ok('coordinator cannot create students', r.status === 403, r.data)
r = await req('GET', '/admin/audit', adm.token); ok('audit log has entries', r.data.total > 20, r.data.total)

console.log('\nSEARCH + EXAM + REPORTS')
r = await req('GET', '/search?q=Babar', B.token); ok('student search finds teacher with CR route (DM disallowed)', r.data.people.some((x) => /Babar Khan/.test(x.name) && x.restricted && /\(CR\)/.test(x.route?.label ?? '')), r.data.people)
const exam = await login('EMP-CS-030'); r = await req('GET', '/exam/console', exam.token); ok('exam console: 3 gazettes, ack rate, halls', r.data.ledger.length === 3 && r.data.halls.length === 3, r.data.ledger?.length)
r = await req('GET', '/exam/console', B.token); ok('student blocked from exam console', r.status === 403, r.data)
r = await req('GET', '/reports', adm.token); ok('admin report queue with KPIs + dossier', r.data.items.length >= 2, r.data.items?.length)
const rep104 = r.data.items.find((x) => x.code === 'REP-104'); r = await req('GET', `/reports/${rep104.id}`, adm.token); ok('dossier shows only the 3 included messages and protects reporter', r.data.evidence.length === 3 && r.data.reporter.protected, r.data)
r = await req('GET', '/reports', B.token); ok('student cannot read the report queue', r.status === 403, r.data)

console.log('\nUPLOADS')
const fd = new FormData(); fd.append('files', new Blob(['MZ\x90\x00 not a pdf'], { type: 'application/pdf' }), 'evil.pdf')
let up = await fetch(API + '/api/uploads', { method: 'POST', headers: { authorization: `Bearer ${B.token}` }, body: fd }); ok('fake .pdf (wrong magic bytes) rejected', up.status === 422, up.status)
const fd2 = new FormData(); fd2.append('files', new Blob(['%PDF-1.4\n%%EOF'], { type: 'application/pdf' }), 'ok.pdf')
up = await fetch(API + '/api/uploads', { method: 'POST', headers: { authorization: `Bearer ${B.token}` }, body: fd2 }); ok('real PDF accepted', up.status === 201, up.status)

console.log('\nSUSPENSION (live disconnect)')
const victim = await login('FA23-BCS-023'); const sV = await connect(victim.token)
const vId = (await req('GET', '/me', victim.token)).data.user.id
const gone = new Promise((resolve) => { sV.on('disconnect', () => resolve(true)); setTimeout(() => resolve(false), 4000) })
r = await req('POST', `/admin/users/${vId}/status`, adm.token, { status: 'SUSPENDED', reason: 'smoke test' }); ok('admin suspends student', r.status === 200, r.data)
ok('suspended user’s live socket is disconnected', await gone)
r = await req('POST', '/auth/login', null, { uid: 'FA23-BCS-023', password: PW }); ok('suspended login → ACCOUNT_SUSPENDED', r.data.code === 'ACCOUNT_SUSPENDED', r.data)
await req('POST', `/admin/users/${vId}/status`, adm.token, { status: 'ACTIVE' })

console.log('\nCUSTOM GROUPS, IMPORT, EXAM, REPORT ACTIONS, WIZARD')
const meBilal = (await req('GET', '/me', B.token)).data
const sara = (await req('GET', '/people?q=Sara Khan', B.token)).data.find((x) => x.uid === 'FA23-BCS-023')
r = await req('POST', '/groups', B.token, { name: 'Smoke study circle', purpose: 'revision', memberIds: [sara.id] }); ok('student creates custom group with a classmate', r.status === 201 && r.data.memberCount === 2, r.data)
const babarId = (await req('GET', '/people?q=Babar Khan', B.token)).data.find((x) => x.uid === 'EMP-CS-010').id
r = await req('POST', '/groups', B.token, { name: 'Sneaky', memberIds: [babarId] }); ok('student cannot add a teacher to a custom group (DM rules apply)', r.status === 403 && r.data.code === 'FORBIDDEN_DM', r.data)
r = await req('POST', '/groups', coordTariq.token, { name: 'Smoke FYP panel', memberIds: [babarId] }); ok('staff creates custom group with allowed staff', r.status === 201, r.data)
const csvBody = 'regNo,name,email,section\nFA26-BCS-020,Import One,fa26-bcs-020@students.comsats.edu.pk,A\nBAD-REG,Broken,broken@x.com,A\nFA23-BCS-052,Dup,dup@x.com,A\nFA26-BCS-021,Import Two,fa26-bcs-021@students.comsats.edu.pk,A\n'
const cfd = new FormData(); cfd.append('file', new Blob([csvBody], { type: 'text/csv' }), 'students.csv')
let imp = await (await fetch(API + '/api/admin/users/import', { method: 'POST', headers: { authorization: `Bearer ${adm.token}` }, body: cfd })).json()
ok('CSV preview: 2 valid, 2 invalid, groups listed', imp.summary.valid === 2 && imp.summary.invalid === 2 && imp.groups[0].code === 'FA26-BCS', imp.summary)
r = await req('POST', `/admin/users/import/${imp.jobId}/commit`, adm.token); ok('CSV commit imports valid rows only', r.data.imported === 2 && r.data.errors.length === 2, r.data)
r = await req('GET', '/admin/users?q=Import Two', adm.token); ok('imported student exists and sits in FA26-BCS', r.data.items[0]?.batch === 'FA26-BCS', r.data.items)
r = await req('POST', '/exam/circulars', exam.token, { title: 'Smoke gazette: hall allocation', body: 'Hall allocation for midterms', batchCodes: ['FA23-BCS', 'SP23-BCS'], audienceLabel: 'CS cohorts' }); ok('exam officer dispatches a gazette to chosen cohorts', r.status === 201 && r.data.audienceCount >= 38 && r.data.kind === 'GAZETTE', [r.status, r.data.audienceCount])
const gId = r.data.id
r = await req('GET', `/exam/circulars/${gId}/breakdown`, exam.token); ok('gazette cohort breakdown', r.data.cohorts.length === 2, r.data.cohorts)
r = await req('POST', `/exam/circulars/${gId}/remind`, exam.token); ok('reminder ping to non-acknowledged', r.data.reminded >= 38, r.data)
r = await req('POST', `/board/${gId}/ack`, B.token); ok('targeted student acknowledges gazette', r.status === 200, r.data)
r = await req('PATCH', `/board/${gId}`, exam.token, { title: 'Smoke gazette: edited inside the hour' }); ok('gazette edit inside 60 min keeps version history', r.data.versionCount === 1, r.data)
r = await req('POST', '/board', adm.token, { scopeId: campusScope.id, title: 'Smoke: to be deleted', body: 'x' }); const delId = r.data.id
r = await req('DELETE', `/board/${delId}`, adm.token); ok('board post deletable within 1 hour', r.data.ok && r.data.archived === false, r.data)
const rep103 = (await req('GET', '/reports', coordTariq.token)).data.items.find((x) => x.code === 'REP-103'); ok('coordinator sees dept-routed report REP-103', !!rep103)
r = await req('POST', `/reports/${rep103.id}/action`, coordTariq.token, { action: 'warn', note: 'Please avoid mass mentions' }); ok('report action: warn', r.data.status === 'RESOLVED', r.data)
const rep104b = (await req('GET', '/reports', adm.token)).data.items.find((x) => x.code === 'REP-104')
r = await req('POST', `/reports/${rep104b.id}/action`, adm.token, { action: 'mute', note: '24h' }); ok('report action: mute 24h in group', r.data.outcome?.includes('muted'), r.data)
r = await req('POST', '/me/settings', B.token, {}); r = await req('PATCH', '/me/settings', B.token, { theme: 'dark', notifications: { board: 'off' } }); ok('board notifications cannot be fully muted', r.status === 422, r.data)
r = await req('PATCH', '/me/settings', B.token, { theme: 'dark', language: 'ur' }); ok('theme/language settings save', r.data.ok, r.data)
const hodAsifTok = asif.token
r = await req('POST', `/dept/${csDept.id}/teachers`, hodAsifTok, { uid: 'EMP-CS-077', name: 'Dr. New Teacher', email: 'new.teacher@comsats.edu.pk', designation: 'Lecturer' }); ok('HOD creates a teacher in own department', r.status === 201 && r.data.temporaryPassword, r.data)
const eeDept = (await req('GET', '/admin/departments', adm.token)).data.find((d) => d.code === 'EE')
r = await req('POST', `/dept/${eeDept.id}/teachers`, hodAsifTok, { uid: 'EMP-EE-077', name: 'Dr. Wrong Dept', email: 'wrong@comsats.edu.pk' }); ok('BYPASS: CS HOD cannot create teachers in EE', r.data.code === 'DEPARTMENT_BOUNDARY', r.data)
const staffPick = (await req('GET', '/admin/staff?q=Perveen', adm.token)).data[0], staffPick2 = (await req('GET', '/admin/staff?q=Ghani', adm.token)).data[0], staffPick3 = (await req('GET', '/admin/staff?q=Naeem', adm.token)).data[0], staffPick4 = (await req('GET', '/admin/staff?q=Rabia', adm.token)).data[0]
r = await req('POST', '/admin/users', adm.token, { uid: 'EMP-PH-001', name: 'Dr. Physics Head', email: 'physics.head@comsats.edu.pk', kind: 'STAFF' }); const phHod = r.data.id, phTemp = r.data.temporaryPassword
r = await req('POST', '/admin/users', adm.token, { uid: 'EMP-PH-002', name: 'Dr. Physics Pi', email: 'physics.pi@comsats.edu.pk', kind: 'STAFF' }); const phPi = r.data.id
r = await req('POST', '/admin/users', adm.token, { uid: 'EMP-PH-003', name: 'Dr. Physics Coord', email: 'physics.coord@comsats.edu.pk', kind: 'STAFF' }); const phCo = r.data.id
r = await req('POST', '/admin/departments', adm.token, { name: 'Physics', code: 'PH', hodId: phHod, coordinatorIds: [phCo], programs: [{ code: 'BPH', name: 'BS Physics', programInchargeId: phPi }] }); ok('wizard creates department with HOD, PI, coordinator', r.status === 201 && r.data.hod?.uid === 'EMP-PH-001', r.data)
const phTok = (await login('EMP-PH-001', phTemp)).token; await req('POST', '/auth/activate', phTok, { currentPassword: phTemp, newPassword: 'Physics-Head-2026!', acceptPolicy: true })
r = await req('GET', '/me', (await login('EMP-PH-001', 'Physics-Head-2026!')).token); ok('new HOD sees Teachers/CRs/Dept Mgmt groups + coordinator desk', r.data.sidebar.roleGroups.length >= 3 && r.data.sidebar.desks.some((d) => d.slug === 'ph-coordinator'), r.data.sidebar.roleGroups.map((g) => g.name))
r = await req('POST', '/admin/departments', adm.token, { name: 'Chem', code: 'CH', hodId: phHod, coordinatorIds: [phCo], programs: [{ code: 'BCH', name: 'BS Chem', programInchargeId: phPi }] }); ok('one person cannot be HOD of two departments', r.status === 409, r.data)
r = await req('POST', `/admin/users/${(await req('GET', '/me', sup.token)).data.user.id}/status`, adm.token, { status: 'SUSPENDED' }); ok('Admin cannot suspend the Super Admin', r.status === 403, r.data)
r = await req('PATCH', '/admin/roles', adm.token, { role: 'HOD', orgUnitId: csDept.id, userId: staffPick.id }); ok('Admin replaces HOD in one step (old HOD loses role)', r.status === 200, r.data)
r = await req('GET', '/me', asif.token); ok('replaced HOD loses HOD grants after reassign', !r.data.roles.some((x) => x.role === 'HOD' && x.orgUnit === 'CS'), r.data.roles)
await req('PATCH', '/admin/roles', adm.token, { role: 'HOD', orgUnitId: csDept.id, userId: (await req('GET', '/me', asif.token)).data.user.id })

console.log('\nROLLOVER + LIVE RE-SCOPING')
const hina = await login('EMP-CS-013'); const sHina = await connect(hina.token)
const hinaMe = await req('GET', '/me', hina.token); ok('teacher Hina has CR lines before rollover', hinaMe.data.sidebar.crLines.length === 2, hinaMe.data.sidebar.crLines.map((c) => c.code))
const lost = []; sHina.on('membership:changed', (e) => lost.push(e))
const nadia = await login('EMP-MS-002'); const omer = (await req('GET', '/dept/' + (await req('GET', '/dept/mine', nadia.token)).data[0].id + '/teachers', nadia.token)).data.find((t) => /Omer/.test(t.name))
r = await req('POST', '/terms/SP27/offerings', nadia.token, { courseCode: 'MGT310', title: 'Strategic Management', batchCode: 'FA23-BBA', teacherId: omer.id }); ok('MS coordinator loads SP27 offerings', r.status === 201, r.data)
r = await req('POST', '/terms/SP27/offerings', coordTariq.token, { courseCode: 'MGT311', title: 'x', batchCode: 'FA23-BBA', teacherId: omer.id }); ok('BYPASS: CS coordinator cannot load MS offerings', r.data.code === 'DEPARTMENT_BOUNDARY', r.data)
r = await req('GET', '/admin/terms/SP27/rollover', adm.token); ok('rollover gateway opens after MS loads', r.data.gateway === 'OPEN' && r.data.impact.graduatingStudents > 0, r.data.missingDepartments)
r = await req('POST', '/admin/terms/SP27/rollover', adm.token, { confirm: true }); ok('rollover executes (archives graduating batches)', r.data.ok && r.data.archived.includes('FA22-BCS'), r.data)
await new Promise((x) => setTimeout(x, 800))
ok('teacher loses old CR lines LIVE without reconnecting', lost.filter((e) => e.action === 'left').length >= 2, lost)
const hinaAfter = await req('GET', '/me', hina.token); ok('sidebar after rollover shows no CR lines for Hina', hinaAfter.data.sidebar.crLines.length === 0, hinaAfter.data.sidebar.crLines)
r = await req('GET', '/me', (await login('FA22-BCS-009')).token); ok('archived-batch student is alumni and read-only', r.data.user.status === 'ALUMNI' && r.data.sidebar.classes.length === 0, r.data.user.status)

console.log(`\n${fail ? '✗' : '✔'} ${pass} passed, ${fail} failed`)
for (const s of [sB, sH, sT, sAsif, sHina]) s.close()
process.exit(fail ? 1 : 0)
