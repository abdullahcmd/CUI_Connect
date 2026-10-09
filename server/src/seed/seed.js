/**
 * Demo seed: wipes the database and builds a filled-in campus.
 * Every demo account shares DEMO_PASSWORD (see DEMO_ACCOUNTS.md written at the end).
 * Structure is created through the same services the UI uses (department wizard, batches, CR assignment)
 * so the seed doubles as an end-to-end test of the rules.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import mongoose from 'mongoose'
import { connectDb } from '../config/db.js'
import * as M from '../models/index.js'
import { loadOrg, org, createOrg } from '../services/org.js'
import { loadActor, loadAllActors, invalidateTeaching } from '../services/actors.js'
import { createUser, assignRole } from '../services/users.js'
import { createDepartment } from '../services/departments.js'
import * as D from '../services/departments.js'
import { createCampusGroups, syncAll, createDeptGroups } from '../services/groups.js'
import { autoFollow } from '../services/channels.js'
import { audienceOf } from '../services/board.js'
import { writePdf } from '../lib/fakePdf.js'
import { sha256, parseReg } from '../lib/util.js'
import { snapshotFor } from '../services/messages.js'
import { badgesOf } from '../policy/roles.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DEMO_PASSWORD = 'Password@123'
const now = Date.now()
const mins = (n) => new Date(now - n * 60_000)
const hrs = (n) => new Date(now - n * 3600_000)
const days = (n) => new Date(now - n * 86400_000)
const inDays = (n) => new Date(now + n * 86400_000)
const inHrs = (n) => new Date(now + n * 3600_000)
const today = (h, m = 0) => { const d = new Date(); d.setHours(h, m, 0, 0); return d > new Date() ? new Date(d.getTime() - 86400_000) : d }
const log = (...a) => console.log('•', ...a)
const staffEmail = (name) => name.toLowerCase().replace(/^(dr|prof|engr|mr|ms)\.?\s+/, '').replace(/[^a-z ]/g, '').trim().replace(/\s+/g, '.') + '@comsats.edu.pk'

await connectDb()
await mongoose.connection.dropDatabase()
await Promise.all(Object.values(M).filter((m) => m?.syncIndexes).map((m) => m.syncIndexes()))
for (const f of fs.existsSync(path.resolve(__dirname, '../../uploads')) ? fs.readdirSync(path.resolve(__dirname, '../../uploads')) : []) if (f !== '.gitkeep') fs.unlinkSync(path.resolve(__dirname, '../../uploads', f))
log('database wiped')

// ───────────────────────────── org: campus + offices
const campus = await createOrg({ type: 'CAMPUS', code: 'CUI', name: 'COMSATS University Islamabad' })
for (const [code, name, kind] of [['SA', 'Student Affairs', 'STUDENT_AFFAIRS'], ['LIB', 'Library', 'LIBRARY'], ['CAF', 'Cafe', 'CAFE'], ['CDC', 'Career Development Centre', 'CDC'], ['SPT', 'Sports', 'SPORTS'], ['EXM', 'Examination Cell', 'EXAM']])
  await createOrg({ type: 'OFFICE', code, name, parentId: campus._id, officeKind: kind })

// ───────────────────────────── terms
const term = (code, name, s, e, current = false) => M.Term.create({ code, name, startsAt: new Date(s), endsAt: new Date(e), current })
await term('SP26', 'Spring 2026', '2026-02-09', '2026-06-26')
const FA26 = await term('FA26', 'Fall 2026', '2026-08-24', '2026-12-18', true)
const SP27 = await term('SP27', 'Spring 2027', '2027-02-08', '2027-06-25')
invalidateTeaching()

// ───────────────────────────── people
const mk = async (uid, name, extra = {}) => (await createUser(null, { uid, name, email: extra.email ?? staffEmail(name), kind: 'STAFF', password: DEMO_PASSWORD, mustChangePassword: false, silent: true, ...extra })).user
const U = {} // key → user doc
const A = {} // account list for DEMO_ACCOUNTS.md
const track = (key, u, note) => { U[key] = u; A[key] = { uid: u.uid, name: u.name, note } }

track('super', await mk('SA-001', 'IT Super Admin', { email: 'it@comsats.edu.pk', designation: 'IT / Super Admin' }), 'Super Admin — Admins, system settings, full audit')
track('adm1', await mk('ADM-001', 'Dr. Ahsan Rahman', { designation: 'Deputy Registrar · Admin Office' }), 'Admin — structure, users, CSV import, rollover')
track('adm2', await mk('ADM-002', 'Mr. Kamran Yousaf', { designation: 'Admin Office' }), 'Admin — designated manager of Coordinators — CUI')
track('ci', await mk('EMP-ISB-001', 'Dr. Rashid Mehmood', { designation: 'Campus Incharge' }), 'Campus Incharge')
track('sah', await mk('EMP-SA-001', 'Dr. Farhan Shah', { designation: 'Head, Student Affairs' }), 'Student Affairs Head')
track('sa1', await mk('EMP-SA-002', 'Mr. Naveed Alam', { designation: 'Registrar Counter 1', phone: '5022' }), 'Student Affairs Officer — Counter 1 Registrar')
track('sa2', await mk('EMP-SA-003', 'Ms. Hina Siddiqui', { designation: 'Accounts Counter 2' }), 'Student Affairs Officer — Counter 2 Accounts')
track('sa3', await mk('EMP-SA-004', 'Mr. Saad Qureshi', { designation: 'Financial Aid Officer · Counter 3' }), 'Student Affairs Officer (Financial Aid) — Counter 3')
track('sa4', await mk('EMP-SA-005', 'Mr. Imran Javed', { designation: 'Transport Counter 4' }), 'Student Affairs Officer — Counter 4 Transport')
track('lib', await mk('EMP-LIB-001', 'Ms. Rukhsana Bibi', { designation: 'Librarian' }), 'Librarian')
track('lib2', await mk('EMP-LIB-002', 'Mr. Tahir Mehmood', { designation: 'Library Staff' }), 'Library staff')
track('caf', await mk('EMP-CAF-001', 'Mr. Aslam Khan', { designation: 'Cafe Manager' }), 'Cafe Manager')
track('caf2', await mk('EMP-CAF-002', 'Mr. Bashir Ahmed', { designation: 'Cafe Staff' }), 'Cafe staff')
track('cdc', await mk('EMP-CDC-001', 'Ms. Sana Iqbal', { designation: 'Career Development Centre' }), 'Channel Publisher — Careers & Events')
track('sports', await mk('EMP-SPT-001', 'Mr. Waqas Ali', { designation: 'Director Sports' }), 'Channel Publisher — Sports')

// departments' people
const dept = {
  CS: { name: 'Computer Science', hod: ['EMP-CS-001', 'Dr. Asif Mahmood', 'Professor & HOD'], coords: [['EMP-CS-002', 'Dr. Tariq Mahmood', 'Associate Professor'], ['EMP-CS-003', 'Dr. Sarah Malik', 'Assistant Professor']],
    programs: [['BCS', 'BS Computer Science', ['EMP-CS-004', 'Dr. Noman Bashir', 'Assistant Professor']], ['BSE', 'BS Software Engineering', ['EMP-CS-005', 'Dr. Sadaf Tanveer', 'Assistant Professor']], ['BAI', 'BS Artificial Intelligence', ['EMP-CS-006', 'Dr. Farhan Riaz', 'Tenured Professor']], ['BCY', 'BS Cyber Security', ['EMP-CS-007', 'Dr. Imtiaz Hussain', 'Associate Professor']]],
    teachers: [['EMP-CS-010', 'Dr. Babar Khan', 'Senior Assistant Professor', 'CS-204'], ['EMP-CS-011', 'Dr. Naveed Akhtar', 'Assistant Professor', 'CS-118'], ['EMP-CS-012', 'Dr. Imran Siddiqui', 'Lecturer', 'CS-210'], ['EMP-CS-013', 'Dr. Hina Tariq', 'Assistant Professor', 'CS-122'], ['EMP-CS-014', 'Dr. Kashif Raza', 'Assistant Professor', 'CS-131'], ['EMP-CS-015', 'Dr. Ayesha Farooq', 'Lecturer', 'CS-140'], ['EMP-CS-030', 'Prof. Asim Munir', 'Professor · Incharge Exam Cell', 'CS-101']] },
  EE: { name: 'Electrical Engineering', hod: ['EMP-EE-001', 'Dr. Amna Zahid', 'Professor & HOD'], coords: [['EMP-EE-002', 'Engr. Farooq Hussain', 'Lecturer']],
    programs: [['BEE', 'BS Electrical Engineering', ['EMP-EE-003', 'Dr. Salman Ghani', 'Associate Professor']], ['BCE', 'BS Computer Engineering', ['EMP-EE-004', 'Engr. Naeem Abbas', 'Assistant Professor']]],
    teachers: [['EMP-EE-010', 'Engr. Sana Fatima', 'Lecturer', 'EE-009'], ['EMP-EE-011', 'Dr. Zeeshan Anwar', 'Assistant Professor', 'EE-014'], ['EMP-EE-012', 'Engr. Rabia Saleem', 'Lecturer', 'EE-020']] },
  MS: { name: 'Management Sciences', hod: ['EMP-MS-001', 'Dr. Zahid Mehmood', 'Professor & HOD'], coords: [['EMP-MS-002', 'Ms. Nadia Perveen', 'Lecturer']],
    programs: [['BBA', 'BBA', ['EMP-MS-003', 'Dr. Faisal Qureshi', 'Associate Professor']], ['BAF', 'BS Accounting & Finance', ['EMP-MS-004', 'Dr. Saima Latif', 'Assistant Professor']]],
    teachers: [['EMP-MS-010', 'Dr. Omer Farooq', 'Assistant Professor', 'MS-110'], ['EMP-MS-011', 'Ms. Hira Anjum', 'Lecturer', 'MS-114']] },
}
const T = {} // teacher uid → user
for (const [code, d] of Object.entries(dept)) {
  const mkd = async (row) => mk(row[0], row[1], { designation: row[2], cabin: row[3], department: code })
  d.hodU = await mkd(d.hod); track(`hod${code}`, d.hodU, `HOD — ${d.name}`)
  d.coordUs = []; for (const c of d.coords) d.coordUs.push(await mkd(c)); track(`coord${code}`, d.coordUs[0], `Coordinator — ${d.name}`)
  for (const p of d.programs) p.piU = await mkd(p[2]); track(`pi${code}`, d.programs[0].piU, `Program Incharge — ${d.programs[0][1]}`)
  d.teacherUs = []; for (const t of d.teachers) { const u = await mkd(t); d.teacherUs.push(u); T[t[0]] = u }
}
track('teacherBabar', T['EMP-CS-010'], 'Teacher — CSC301 (reaches FA23-BCS through the CR line)')
track('teacherNaveed', T['EMP-CS-011'], 'Teacher — CSC322 Operating Systems')
track('examOfficer', T['EMP-CS-030'], 'Exam Cell officer (Gazette console) + CS teacher')
track('teacherSana', T['EMP-EE-010'], 'Teacher (EE) — visiting faculty in CS')

// ───────────────────────────── office roles
const C = campus._id
const office = (c) => org.byCode(c)._id
const adminActor = await loadActor(U.super._id)
const give = (u, role, orgId, flags) => assignRole(adminActor, { userId: u._id, role, orgUnitId: orgId, flags }, { bypass: true })
await give(U.super, 'SUPER_ADMIN', C)
await give(U.adm1, 'ADMIN', C); await give(U.adm2, 'ADMIN', C, { coordinatorsGroupManager: true })
await give(U.ci, 'CAMPUS_INCHARGE', C)
await give(U.sah, 'SA_HEAD', office('SA'))
for (const k of ['sa1', 'sa2', 'sa3', 'sa4']) await give(U[k], 'SA_OFFICER', office('SA'), k === 'sa3' ? { financialAid: true } : undefined)
await give(U.lib, 'LIBRARIAN', office('LIB')); await give(U.lib2, 'LIBRARY_STAFF', office('LIB'))
await give(U.caf, 'CAFE_MANAGER', office('CAF')); await give(U.caf2, 'CAFE_STAFF', office('CAF'))
await give(U.cdc, 'PUBLISHER', office('CDC')); await give(U.sports, 'PUBLISHER', office('SPT'))
await give(U.examOfficer, 'EXAM_OFFICER', office('EXM'))
await M.User.updateOne({ _id: U.examOfficer._id }, { departmentId: null })
for (const k of ['super', 'adm1', 'adm2', 'ci']) await M.User.updateOne({ _id: U[k]._id }, { $unset: { departmentId: 1 } })

// ───────────────────────────── departments through the wizard
const A1 = await loadActor(U.adm1._id)
for (const [code, d] of Object.entries(dept)) {
  await createDepartment(A1, {
    name: d.name, code, hodId: d.hodU._id, coordinatorIds: d.coordUs.map((c) => c._id), teacherIds: d.teacherUs.map((t) => t._id),
    programs: d.programs.map((p) => ({ code: p[0], name: p[1], programInchargeId: p.piU._id })),
  })
  log(`department ${code} created via wizard`)
}
await assignRole(adminActor, { userId: U.teacherSana._id, role: 'TEACHER', orgUnitId: org.byCode('CS')._id }, { bypass: true }) // visiting faculty
await M.User.updateMany({ _id: { $in: [U.examOfficer._id] } }, { departmentId: org.byCode('CS')._id })
await createCampusGroups()

// ───────────────────────────── batches + students
const batches = [
  ['BCS', 'FA', 2022, 10, null], ['BCS', 'SP', 2022, 10, null], ['BCS', 'FA', 2023, 24, 'A'], ['BCS', 'SP', 2023, 14, null], ['BCS', 'FA', 2024, 14, null], ['BCS', 'FA', 2026, 12, null],
  ['BSE', 'FA', 2023, 12, null], ['BAI', 'FA', 2024, 10, null], ['BEE', 'FA', 2023, 12, null], ['BEE', 'SP', 2024, 10, null], ['BBA', 'FA', 2023, 10, null],
]
const advisors = { 'FA23-BCS': 'EMP-CS-002', 'SP23-BCS': 'EMP-CS-004', 'FA22-BCS': 'EMP-CS-006', 'FA23-BSE': 'EMP-CS-005' }
for (const [prog, intake, year, , section] of batches) {
  const b = await D.createBatch(A1, { programCode: prog, intake, year, section })
  const adv = advisors[b.code]
  if (adv) await D.setBatchPermission(A1, b.id, { advisorId: (await M.User.findOne({ uid: adv }))._id })
}
await M.OrgUnit.updateMany({ code: { $in: ['FA22-BCS', 'SP22-BCS'] } }, { expectedGraduation: 'FA26' }); await loadOrg()
log('batches created with class groups + CR lines')

const first = ['Ahmed', 'Ali', 'Usman', 'Hamza', 'Bilal', 'Zain', 'Hassan', 'Talha', 'Faizan', 'Saad', 'Danish', 'Raza', 'Shahid', 'Adeel', 'Kamran', 'Fahad', 'Junaid', 'Waleed', 'Haris', 'Osama', 'Ayesha', 'Fatima', 'Zainab', 'Maryam', 'Hira', 'Sara', 'Noor', 'Iqra', 'Mahnoor', 'Rabia', 'Sana', 'Laiba', 'Areeba', 'Hoor', 'Anum', 'Komal', 'Mehwish', 'Rimsha', 'Aleena', 'Dua']
const last = ['Khan', 'Malik', 'Qureshi', 'Ahmed', 'Sheikh', 'Butt', 'Chaudhry', 'Mirza', 'Raza', 'Siddiqui', 'Hussain', 'Baig', 'Javed', 'Iqbal', 'Naqvi', 'Rizvi', 'Abbasi', 'Awan', 'Gill', 'Cheema']
const named = {
  'FA23-BCS-052': 'Bilal Ahmed', 'FA23-BCS-041': 'Hamza Ali', 'FA23-BCS-018': 'Maryam Noor', 'FA23-BCS-023': 'Sara Khan', 'FA23-BCS-004': 'Muhammad Hashir Qazi', 'FA23-BCS-071': 'Hira Aslam',
  'SP23-BCS-102': 'Zainab Khan', 'FA22-BCS-009': 'Usman Shafiq', 'FA23-BSE-024': 'Ali Bilal', 'FA24-BCS-081': 'Babar Azam', 'SP22-BCS-064': 'Daniyal Hassan', 'SP22-BCS-089': 'Hashir Qureshi',
  'FA23-BEE-011': 'Muhammad Bilal', 'FA23-BBA-030': 'Zunaira Tariq', 'FA24-BCS-044': 'Faryal Anwar',
}
const S = {} // uid → user
const used = new Set()
let ni = 0
for (const [prog, intake, year, count] of batches) {
  const yy = String(year).slice(-2), code = `${intake}${yy}-${prog}`
  const sem = 2 * (26 - Number(yy)) + (intake === 'FA' ? 1 : 2)
  const forced = Object.keys(named).filter((u) => u.startsWith(code + '-'))
  const rolls = new Set(forced.map((u) => u.split('-')[2]))
  let roll = 1
  while (rolls.size < count) { const r = String(roll * 3 + 1).padStart(3, '0'); if (!rolls.has(r) && !Object.keys(named).includes(`${code}-${r}`)) rolls.add(r); roll++ }
  for (const r of [...rolls].sort()) {
    const uid = `${code}-${r}`
    const name = named[uid] ?? `${first[ni % first.length]} ${last[(ni * 7 + 3) % last.length]}`
    ni++
    const email = `${uid.toLowerCase()}@students.comsats.edu.pk`
    const u = (await createUser(null, { uid, name, email, kind: 'STUDENT', password: DEMO_PASSWORD, mustChangePassword: false, semester: sem, silent: true })).user
    S[uid] = u
  }
}
// a brand-new student who must activate with a temporary password (AUTH-02)
const newbie = (await createUser(null, { uid: 'FA26-BCS-014', name: 'Rida Fatima', email: 'fa26-bcs-014@students.comsats.edu.pk', kind: 'STUDENT', password: 'Temp-Pass-2026!', mustChangePassword: true, semester: 1, silent: true })).user
log(`${Object.keys(S).length + 1} students created`)
for (const [k, uid] of [['bilal', 'FA23-BCS-052'], ['hamza', 'FA23-BCS-041'], ['maryam', 'FA23-BCS-018'], ['sara', 'FA23-BCS-023'], ['hashir', 'FA23-BCS-004'], ['hira', 'FA23-BCS-071'], ['zainab', 'SP23-BCS-102'], ['usman', 'FA22-BCS-009'], ['alibilal', 'FA23-BSE-024'], ['daniyal', 'SP22-BCS-064'], ['mbilal', 'FA23-BEE-011'], ['zunaira', 'FA23-BBA-030']]) track(`s_${k}`, S[uid], k === 'hamza' || k === 'maryam' ? 'Student — CR of FA23-BCS' : k === 'zainab' ? 'Student — CR of SP23-BCS' : k === 'bilal' ? 'Student (FA23-BCS) — the main student demo account' : k === 'daniyal' ? 'Student — ACM Society Lead' : k === 'zunaira' ? 'Student — Literary Society Lead' : k === 'mbilal' ? 'Student — IEEE Society Lead' : 'Student')
A.newbie = { uid: newbie.uid, name: newbie.name, note: 'NEW student — signs in with the temporary password in DEMO_ACCOUNTS.md and must activate (AUTH-02)' }

// CRs
const idOf = (code) => org.byCode(code)._id
await D.assignCRs(A1, idOf('FA23-BCS'), [S['FA23-BCS-041']._id, S['FA23-BCS-018']._id])
await D.assignCRs(A1, idOf('SP23-BCS'), [S['SP23-BCS-102']._id])
await D.assignCRs(A1, idOf('FA23-BSE'), [S['FA23-BSE-024']._id])
await D.assignCRs(A1, idOf('FA24-BCS'), [S['FA24-BCS-044']._id])
await D.assignCRs(A1, idOf('FA23-BEE'), [S['FA23-BEE-011']._id])
await D.setBatchPermission(A1, idOf('FA23-BSE'), { announceOnly: true })
await D.setBatchPermission(A1, idOf('FA22-BCS'), { announceOnly: true })
// societies
for (const [uid, ch] of [['SP22-BCS-064', 'acm'], ['FA23-BEE-011', 'ieee'], ['FA23-BBA-030', 'lit']]) await give(S[uid], 'SOCIETY_LEAD', office('SA'), { society: ch })

// ───────────────────────────── offerings (current term + next term for CS & EE)
const byUid = async (uid) => (await M.User.findOne({ uid }))._id
const OFF = {
  'FA23-BCS': [['CSC301', 'Data Structures & Algos', 'EMP-CS-010', 'CS-Lab 2'], ['CSC322', 'Operating Systems', 'EMP-CS-011', 'CS-204'], ['EEE241', 'Digital Logic Design', 'EMP-EE-010', 'EE-009'], ['CSC231', 'Database Systems', 'EMP-CS-013', 'CS-110']],
  'SP23-BCS': [['CSC401', 'Artificial Intelligence', 'EMP-CS-014', 'CS-301'], ['CSC433', 'Computer Networks', 'EMP-CS-011', 'CS-118'], ['CSC410', 'Software Engineering', 'EMP-CS-012', 'CS-210']],
  'FA24-BCS': [['CSC203', 'Discrete Structures', 'EMP-CS-015', 'CS-140'], ['CSC212', 'Object Oriented Programming', 'EMP-CS-010', 'CS-Lab 1'], ['CSC231', 'Database Systems', 'EMP-CS-013', 'CS-110']],
  'FA22-BCS': [['CSC499', 'Final Year Project I', 'EMP-CS-014', 'CS-301'], ['CSC470', 'Information Security', 'EMP-CS-012', 'CS-212']],
  'SP22-BCS': [['CSC499', 'Final Year Project II', 'EMP-CS-014', 'CS-301']],
  'FA26-BCS': [['CSC101', 'Introduction to Computing', 'EMP-CS-012', 'CS-Lab 3'], ['CSC103', 'Programming Fundamentals', 'EMP-CS-015', 'CS-Lab 3']],
  'FA23-BSE': [['SEN301', 'Software Requirements', 'EMP-CS-012', 'CS-210'], ['CSC322', 'Operating Systems', 'EMP-CS-011', 'CS-204']],
  'FA24-BAI': [['AIC201', 'Machine Learning', 'EMP-CS-014', 'CS-301'], ['CSC203', 'Discrete Structures', 'EMP-CS-015', 'CS-140']],
  'FA23-BEE': [['EEE301', 'Signals & Systems', 'EMP-EE-011', 'EE-014'], ['EEE241', 'Digital Logic Design', 'EMP-EE-010', 'EE-009'], ['EEE320', 'Control Systems', 'EMP-EE-012', 'EE-020']],
  'SP24-BEE': [['EEE210', 'Circuit Analysis', 'EMP-EE-011', 'EE-014'], ['EEE222', 'Electronics', 'EMP-EE-012', 'EE-020']],
  'FA23-BBA': [['MGT301', 'Organizational Behavior', 'EMP-MS-010', 'MS-110'], ['MGT322', 'Marketing Management', 'EMP-MS-011', 'MS-114']],
}
for (const [bc, rows] of Object.entries(OFF)) for (const [courseCode, title, tuid, room] of rows)
  await M.CourseOffering.create({ termId: FA26._id, courseCode, title, batchId: idOf(bc), teacherId: await byUid(tuid), room, creditHours: 3 })
// SP27 offerings: CS and EE loaded, MS intentionally missing (rollover wizard is blocked until MS loads its offerings)
for (const bc of ['FA23-BCS', 'SP23-BCS', 'FA24-BCS', 'FA23-BSE', 'FA24-BAI', 'FA23-BEE', 'SP24-BEE'])
  for (const [courseCode, title, tuid, room] of (OFF[bc] ?? []).slice(0, 2)) await M.CourseOffering.create({ termId: SP27._id, courseCode: courseCode.replace(/(\d)(\d)(\d)$/, (_, a, b, c) => `${a}${b}${Number(c) + 1 > 9 ? 9 : Number(c) + 1}`), title: `${title} II`, batchId: idOf(bc), teacherId: await byUid(tuid), room, creditHours: 3 })
await M.Setting.create({ key: 'expectedOfferings', value: { CS: 48, EE: 24, MS: 24 } })
invalidateTeaching()
await syncAll({ live: false })
log('offerings loaded; teacher CR lines synced')

// ───────────────────────────── desks (department Coordinator desks already created by the wizard)
const chainSA = [{ level: 1, label: 'SA Officer', role: 'SA_OFFICER', scope: 'DESK_ORG' }, { level: 2, label: 'SA Head', role: 'SA_HEAD', scope: 'DESK_ORG' }, { level: 3, label: 'Campus Incharge', role: 'CAMPUS_INCHARGE', scope: 'CAMPUS' }]
const saDesk = await M.Desk.create({
  slug: 'student-affairs', name: 'Student Affairs Desk', prefix: 'SA', kind: 'STUDENT_AFFAIRS', orgUnitId: office('SA'), location: 'Ground Floor, Administration Block A, COMSATS University Islamabad', block: 'CENTRAL ADMIN · BLOCK A', hours: 'Mon–Fri 09:00 – 15:30 PKT',
  description: 'Fee concessions, transport passes, degree clearance, and student grievances. Working hours: 09:00 - 15:30 PKT (Mon - Fri).',
  categories: ['Fee Challan & Instalment Approval', 'Bonafide Certificate', 'Scholarship & Financial Aid', 'Transport Pass', 'Character Certificate', 'Degree Clearance', 'Other'],
  agentIds: [U.sa1._id, U.sa2._id, U.sa3._id, U.sa4._id], headIds: [U.sah._id], chain: chainSA, targetReplyHours: 48,
  counters: [
    { no: 1, name: 'Registrar', handles: 'Attestations, Bonafide, Character Certs', status: 'OPEN', ext: '5022', agentId: U.sa1._id, categories: ['Bonafide Certificate', 'Character Certificate', 'Degree Clearance'] },
    { no: 2, name: 'Accounts', handles: 'Fee vouchers, splits, refund requests', status: 'BUSY', ext: '5190', agentId: U.sa2._id, categories: ['Fee Challan & Instalment Approval'] },
    { no: 3, name: 'Scholarships', handles: 'HEC, PEEF, Need-based interviews', status: 'BUSY', ext: '5184', agentId: U.sa3._id, categories: ['Scholarship & Financial Aid'] },
    { no: 4, name: 'Transport & Passes', handles: 'Route clearance, RFID verification', status: 'OPEN', ext: '5201', agentId: U.sa4._id, categories: ['Transport Pass'] },
  ],
  contacts: [{ label: 'Direct Phone Extension', ext: '5184 / 5188', phone: 'Direct Board: +92 (51) 9247000' }, { label: 'Institutional Inquiries', email: 'studentaffairs@comsats.edu.pk', person: 'Financial Aid: faid@comsats.edu.pk' }, { label: 'Public Counter Hours', hours: '09:00 – 13:00 (Counter Tokens) · 14:00 – 15:30 (Document Collection)' }],
  advisory: { title: 'ADVISORY: COUNTER 3 PROCESSING CYCLE', body: 'Counter 3 (Scholarships & Financial Aid) is currently processing Fall 2026 need-based verification dossiers. Current average turnaround: 2 working days. Please submit pending utility receipts and parental tax declarations promptly.', updatedAt: new Date() },
  safeguard: { title: 'INSTITUTIONAL SAFEGUARD DIRECTIVE', body: 'Disputed fee clearance cases automatically escalate to the Assistant Registrar after 72 hours of inactivity.', ref: 'CU-SA-2024/72H-ESC' },
  checklist: ['Original paid blue bank voucher slip', 'Clear photocopy of CUI Student Identity Card', 'Guardian income verification (for concession)'],
  requestForm: { code: 'SA-DOC-2026', accepted: 'PDF, JPG, PNG up to 8MB. Must clearly show CUI watermarks or bank stamps.', maxMb: 8 },
})
await M.Desk.create({ slug: 'library', name: 'Library Desk', prefix: 'LB', kind: 'LIBRARY', orgUnitId: office('LIB'), description: 'Book requests, fines, e-resources and library cards.', hours: 'Mon–Sat 08:30 – 17:00', location: 'Central Library, Ground Floor', categories: ['Fine / Dues', 'Book Request', 'Library Card', 'E-Resources', 'Other'], agentIds: [U.lib2._id], headIds: [U.lib._id], chain: [{ level: 1, label: 'Library Staff', role: 'LIBRARY_STAFF', scope: 'DESK_ORG' }, { level: 2, label: 'Librarian', role: 'LIBRARIAN', scope: 'DESK_ORG' }], targetReplyHours: 48 })
await M.Desk.create({ slug: 'cafe', name: 'Cafe Desk', prefix: 'CF', kind: 'CAFE', orgUnitId: office('CAF'), description: 'Menu feedback, hygiene complaints and lost items.', hours: 'Mon–Sat 08:00 – 20:00', categories: ['Menu Feedback', 'Complaint', 'Catering Request', 'Other'], agentIds: [U.caf2._id], headIds: [U.caf._id], chain: [{ level: 1, label: 'Cafe Staff', role: 'CAFE_STAFF', scope: 'DESK_ORG' }, { level: 2, label: 'Cafe Manager', role: 'CAFE_MANAGER', scope: 'DESK_ORG' }], targetReplyHours: 48 })
await M.Desk.create({ slug: 'examination-cell', name: 'Examination Cell Desk', prefix: 'EX', kind: 'EXAM', orgUnitId: office('EXM'), description: 'Hall tickets, datesheet queries and result corrections.', hours: 'Mon–Fri 09:00 – 15:00', categories: ['Hall Ticket', 'Datesheet Query', 'Result Correction', 'Other'], agentIds: [U.examOfficer._id], headIds: [U.examOfficer._id], chain: [{ level: 1, label: 'Exam Cell Officer', role: 'EXAM_OFFICER', scope: 'DESK_ORG' }, { level: 2, label: 'Campus Incharge', role: 'CAMPUS_INCHARGE', scope: 'CAMPUS' }], targetReplyHours: 48 })
for (const code of ['CS', 'EE', 'MS']) await M.Desk.updateOne({ slug: `${code.toLowerCase()}-coordinator` }, { slug: code === 'CS' ? 'cs-coordinator' : `${code.toLowerCase()}-coordinator`, 'counters': [], contacts: [{ label: 'Coordinator Desk', ext: code === 'CS' ? '5104' : '5140', person: dept[code].coordUs[0].name }] })

// ───────────────────────────── channels
const sa = office('SA')
const ch = (o) => M.Channel.create(o)
const scholarships = await ch({ slug: 'scholarships', code: 'CH-SCH-840', name: 'Scholarships', initials: 'SA', kind: 'INSTITUTIONAL', tag: 'INSTITUTIONAL CORE', description: 'Need-based scholarships, PEEF, and HEC concession circulars & disbursement schedules.', about: 'Official channel managed by the Financial Aid Office. Publishes HEC awards, institutional endowment concessions, PEEF quotas, and donor grants.', tags: ['HEC VERIFIED', 'FA26 GRANTS', 'CS & EE FOCUS'], ownerOfficeId: sa, ownerLabel: 'Student Affairs & Financial Aid Office', deskSlug: 'student-affairs', publisherIds: [U.sa3._id], joinMode: 'AUTO_LOCKED', audienceLabel: 'Auto-Enrolled (FA26)', contact: { office: 'Student Affairs Counter 3', place: 'Ground Floor, Administration Block A', ext: 'Ext. 5184 / 5188', email: 'finaid@comsats.edu.pk', hours: 'Mon-Fri: 09:00 - 15:30 PKT' } })
const events = await ch({ slug: 'events-seminars', code: 'CH-EVT-001', name: 'Events & Seminars', initials: 'CD', kind: 'INSTITUTIONAL', tag: 'CENTRAL GAZETTE', description: 'Annual Job Fairs, rectorate convocations, industrial expos, and formal university functions.', ownerOfficeId: office('CDC'), ownerLabel: 'Career Development Center & SA', deskSlug: 'student-affairs', publisherIds: [U.cdc._id, U.sports._id], joinMode: 'AUTO_LOCKED', audienceLabel: 'All Cohorts', contact: { office: 'Career Development Centre', ext: 'Ext. 5310', email: 'cdc@comsats.edu.pk', hours: 'Mon-Fri: 09:00 - 15:30 PKT' } })
const careers = await ch({ slug: 'careers-internships', code: 'CH-CAR-002', name: 'Careers & Internships', initials: 'CI', kind: 'INSTITUTIONAL', tag: 'CAREERS', description: 'Internship calls, job openings, and industry-linked programs.', ownerOfficeId: office('CDC'), ownerLabel: 'Career Development Centre', deskSlug: 'student-affairs', publisherIds: [U.cdc._id], joinMode: 'AUTO_MUTE', audienceLabel: 'Final-year & Pre-final cohorts' })
const acm = await ch({ slug: 'acm-chapter-cs', code: 'CH-ACM-01', name: 'ACM Student Chapter — CS', initials: 'AC', kind: 'SOCIETY', tag: 'TECH SOCIETY', description: 'Technical hackathons, algorithmic coding workshops, competitive programming series.', ownerOfficeId: sa, ownerLabel: 'Student Affairs', leadId: S['SP22-BCS-064']._id, joinMode: 'OPT_IN', requireApproval: true, audienceLabel: 'CS / SE / AI' })
const ieee = await ch({ slug: 'ieee-cui-branch', code: 'CH-IEEE-01', name: 'IEEE CUI Student Branch', initials: 'IE', kind: 'SOCIETY', tag: 'ENGINEERING', description: 'Seminars, robotics expos, industrial tours, and telecommunication hardware masterclasses.', ownerOfficeId: sa, ownerLabel: 'Student Affairs', leadId: S['FA23-BEE-011']._id, joinMode: 'OPT_IN', requireApproval: true, audienceLabel: 'EE / CE / CS' })
const lit = await ch({ slug: 'literary-debating', code: 'CH-LIT-01', name: 'CUI Literary & Debating Society', initials: 'LD', kind: 'SOCIETY', tag: 'CULTURAL', description: 'Bilingual declamation contests, parliamentary debates, and All-Pakistan Mushaira forums.', ownerOfficeId: sa, ownerLabel: 'Student Affairs', leadId: S['FA23-BBA-030']._id, joinMode: 'OPT_IN', requireApproval: true, audienceLabel: 'All Batches' })
const lost = await ch({ slug: 'lost-and-found', code: 'CH-LNF-01', name: 'Lost & Found Central Desk', initials: 'LF', kind: 'UTILITY', tag: 'CAMPUS UTILITY', description: 'Verified reports of missing university identity cards, electronics, books, and keys across campus blocks.', ownerOfficeId: sa, ownerLabel: 'Proctorial Board', deskSlug: 'student-affairs', joinMode: 'OPT_IN', requireApproval: true, openSubmissions: true, audienceLabel: 'Campus-wide' })
await ch({ slug: 'library-updates', code: 'CH-LIB-01', name: 'Library Updates', initials: 'LB', kind: 'UTILITY', tag: 'LIBRARY', description: 'New acquisitions, timings and e-resource access.', ownerOfficeId: office('LIB'), ownerLabel: 'Library', deskSlug: 'library', publisherIds: [U.lib._id], joinMode: 'OPT_IN', audienceLabel: 'All' })
await ch({ slug: 'cafe-menu', code: 'CH-CAF-01', name: 'Cafe Menu', initials: 'CM', kind: 'UTILITY', tag: 'CAFE', description: 'Daily menu and special offers.', ownerOfficeId: office('CAF'), ownerLabel: 'Cafe', deskSlug: 'cafe', publisherIds: [U.caf._id], joinMode: 'OPT_IN', audienceLabel: 'All' })
await ch({ slug: 'sports', code: 'CH-SPT-01', name: 'Sports', initials: 'SP', kind: 'UTILITY', tag: 'SPORTS', description: 'Trials, tournaments and ground bookings.', ownerOfficeId: office('SPT'), ownerLabel: 'Sports Office', publisherIds: [U.sports._id], joinMode: 'OPT_IN', audienceLabel: 'All' })
// department channels' publishers/owners
for (const code of ['CS', 'EE', 'MS']) await M.Channel.updateOne({ slug: `${code.toLowerCase()}-events` }, { publisherIds: [dept[code].hodU._id], ownerLabel: dept[code].name })
await syncAll({ live: false })

const targetFA23SP23 = { programs: ['BCS', 'BSE'], intakes: [], years: [], batchIds: [idOf('FA23-BCS'), idOf('SP23-BCS'), idOf('FA23-BSE')] }
const pdf = (title, lines) => writePdf(title, lines)
const f1 = pdf('CUI Endowment Application FA26', ['Official Form V2.4', 'Fall 2026 need-based financial assistance application.']); const f1a = { id: f1.id, name: 'CUI-Endowment-Application-FA26.pdf', size: 240_000, mime: 'application/pdf', url: f1.url, label: 'Official Form V2.4' }
const post = (o) => M.ChannelPost.create({ status: 'PUBLISHED', ...o })
const p1 = await post({ channelId: scholarships._id, authorId: U.sa3._id, refNo: 'FA26-AID-102', title: 'Need-Based Financial Assistance Award Fall 2026', eligibility: 'For FA23 and SP23 batches, BSCS & BSE programs', body: 'Applications are now open for tuition fee concession and stipend grants under the CUI Endowment Fund. Eligible students must submit attested salary slips, parent tax declarations, and utility bills to Counter 3. Shortlisted candidates will be invited for interview by the Departmental Scholarship Committee.', attachments: [f1a], target: targetFA23SP23, applyBy: inDays(9), officeLabel: 'Financial Aid Office', createdAt: days(0.3), interestedBy: Object.values(S).filter((u) => u.uid !== 'FA23-BCS-052').slice(0, 48).map((u) => u._id) })
await post({ channelId: scholarships._id, authorId: U.sa3._id, refNo: 'HEC-EHS-IV', title: 'HEC Undergraduate Scholarship Phase IV — Physical Document Verification', eligibility: 'All Undergraduate Batches (FA22 to FA26)', body: 'Shortlisted candidates for HEC Phase IV are instructed to bring original CNIC, Parent/Guardian CNIC, and latest semester transcript to the Central Auditorium. Candidates failing to report before the scheduled cutoff will forfeit their eligibility for this academic cycle.', checklist: ['Original CNIC + 3 photocopies', 'Father/Guardian salary certificate', 'Attested SSC & HSSC Mark Sheets', 'Fall 2026 Fee Challan Voucher copy'], target: { all: true }, applyBy: inHrs(23), urgent: true, officeLabel: 'Central Office', askLabel: 'View Registry Guidelines', createdAt: days(3), interestedBy: Object.values(S).filter((u) => u.uid !== 'FA23-BCS-052').slice(0, 80).map((u) => u._id) })
await post({ channelId: scholarships._id, authorId: U.sa3._id, title: 'PEEF Special Quota Scholarship 2026', body: 'Verification phase finished. Merit list for selected candidates posted at the Administration Block bulletin board.', target: { all: true }, applyBy: days(5), closed: true, officeLabel: 'Punjab Educational Endowment Fund', createdAt: days(10), status: 'PUBLISHED' })
await post({ channelId: scholarships._id, authorId: U.sa3._id, title: 'BEEF Balochistan Quota — Online Portal Submission', body: 'Students domiciled in Balochistan may submit their application through the BEEF portal.', target: { all: true }, applyBy: inDays(18), officeLabel: 'BEEF', createdAt: days(1) })
const ev1 = pdf('Annual Career Fair 2026', ['Central Auditorium', 'Participating organisations: 60+'])
await post({ channelId: events._id, authorId: U.cdc._id, title: 'Annual Job Fair & Industrial Expo 2026', body: 'More than 60 organisations will recruit across disciplines. Bring multiple copies of your CV.', target: { all: true }, applyBy: inDays(14), officeLabel: 'Career Development Centre', attachments: [{ id: ev1.id, name: 'Career-Fair-Brochure.pdf', size: 880_000, mime: 'application/pdf', url: ev1.url }], createdAt: days(2) })
await post({ channelId: careers._id, authorId: U.cdc._id, title: 'Summer Internship — Systems Limited (Software Engineering)', body: 'Systems Limited is hiring 20 interns for Summer 2027. Final- and pre-final-year students only.', eligibility: 'For BSCS, BSE, BAI — semesters 5 to 8', target: { programs: ['BCS', 'BSE', 'BAI'], semesterMin: 5, semesterMax: 8 }, applyBy: inDays(21), officeLabel: 'Career Development Centre', createdAt: days(1) })
await post({ channelId: acm._id, authorId: U.s_daniyal?._id ?? S['SP22-BCS-064']._id, title: 'ACM Beginner Coders Cup — Workshop Series', body: 'Weekly competitive programming workshops every Thursday 4pm in CS Lab 3.', target: { programs: ['BCS', 'BSE', 'BAI'] }, officeLabel: 'ACM Student Chapter', createdAt: days(6) })
// pending submissions (CHN-06 queue)
const sub = (o) => M.ChannelPost.create({ status: 'PENDING', ...o })
await sub({ channelId: acm._id, authorId: S['SP22-BCS-064']._id, title: 'ACM Annual Speed Programming Competition 2026 — Registration Open', body: 'Inter-batch programming qualifier with 5 algorithmic problems, live DOMjudge scoreboards, and faculty certifications.', target: { programs: ['BCS', 'BSE', 'BAI'] }, applyBy: new Date('2026-10-25'), officeLabel: 'ACM Student Chapter', submission: { regNo: 'SP22-BCS-064', eventDate: new Date('2026-10-28'), cutoff: new Date('2026-10-25'), submitterName: 'Daniyal Hassan (ACM Lead)' }, attachments: [{ id: 'rulebook', name: 'Rulebook-ACM-2026.pdf', size: 450_000, mime: 'application/pdf', url: pdf('ACM Rulebook 2026', ['Rules of the speed programming competition']).url }], createdAt: mins(22) })
await sub({ channelId: lost._id, authorId: S['FA23-BCS-023']._id, title: 'Found: Scientific Calculator (fx-991EX) in Academic Block 2, Lab 04', body: 'Handed over to Lab Attendant Room 102. Contains name sticker partially scratched on reverse casing.', target: { all: true }, officeLabel: 'Lost & Found', submission: { regNo: 'FA23-BCS-023', submitterName: 'Sara Khan', scopeNote: 'Campus-wide Lost & Found' }, createdAt: hrs(1) })
await sub({ channelId: ieee._id, authorId: S['FA23-BEE-011']._id, title: 'Guest Lecture: Embedded Linux Systems by Mentor Graphics', body: 'Keynote on automotive grade controllers scheduled in EE Seminar Hall with guest industrial mentors.', target: { programs: ['BEE', 'BCE', 'BCS'] }, officeLabel: 'IEEE CUI Student Branch', submission: { regNo: 'FA23-BEE-011', submitterName: 'Engr. M. Bilal' }, createdAt: hrs(3) })
// follows
for (const u of await M.User.find()) await autoFollow(u)
for (const u of Object.values(S).slice(0, 60)) await M.ChannelFollow.updateOne({ channelId: acm._id, userId: u._id }, {}, { upsert: true })
for (const u of Object.values(S).slice(0, 25)) await M.ChannelFollow.updateOne({ channelId: lost._id, userId: u._id }, {}, { upsert: true })
for (const u of [S['FA23-BCS-052'], S['FA23-BCS-041']]) { await M.ChannelFollow.updateOne({ channelId: acm._id, userId: u._id }, {}, { upsert: true }); await M.ChannelFollow.updateOne({ channelId: lost._id, userId: u._id }, {}, { upsert: true }) }
log('channels + posts + submissions seeded')

// ───────────────────────────── board announcements
const adm = await loadActor(U.adm1._id)
const eo = await loadActor(U.examOfficer._id)
const ann = async (o, ackFraction = 0, authorKey = 'adm1') => {
  const a = new M.Announcement({ status: 'PUBLISHED', category: 'GENERAL', effectiveFrom: o.createdAt ?? new Date(), lockedAt: new Date((o.createdAt ?? new Date()).getTime() + 3600_000), ...o, authorId: U[authorKey]._id, scopeType: org.get(o.scopeId).type })
  a.digest = sha256(`${a.title}\n${a.body}`)
  const aud = await audienceOf(a)
  a.audienceCount = aud.length
  const n = Math.round(aud.length * ackFraction)
  a.acks = aud.sort(() => 0.5 - Math.random()).slice(0, n).map((x) => ({ userId: x._id, at: hrs(Math.random() * 20) }))
  await a.save(); return a
}
const dsheet = pdf('Fall 2026 Final Exam Datesheet', ['Published by Examination Cell', 'Papers begin Monday 14 December 2026'])
await ann({ scopeId: C, category: 'EXAM', title: 'Fall 2026 final exam datesheet', body: 'The final examination datesheet for Fall 2026 is attached. Students must collect their hall tickets from the Examination Cell one week before the first paper. Check your paper timing and hall allocation carefully.', pinned: true, mandatoryAck: true, officeLabel: 'ADMIN OFFICE', refNo: 'CUI/ADM/2026/311', attachments: [{ id: dsheet.id, name: 'FA26-Final-Datesheet.pdf', size: 320_000, mime: 'application/pdf', url: dsheet.url }], createdAt: hrs(30) }, 0.58)
await ann({ scopeId: C, category: 'HOLIDAY', title: 'Campus closed on Friday for Iqbal Day', body: 'The university will remain closed on Friday for Iqbal Day. Friday classes move to Saturday. Hostel mess will remain operational.', pinned: true, officeLabel: 'ADMIN OFFICE', createdAt: hrs(20), refNo: 'CUI/ADM/2026/312' }, 0.71)
await ann({ scopeId: C, category: 'FEE', title: 'Fall 2026 fee submission deadline extended to 25 October', body: 'Without late surcharge, fee challans can be submitted till 25 October 2026. Instalment requests should be lodged at the Student Affairs Desk.', officeLabel: 'ADMIN OFFICE', createdAt: days(2) }, 0.44, 'adm2')
await ann({ scopeId: C, category: 'EVENT', title: 'Annual Convocation 2026 — registration of graduating students', body: 'Graduating students must register for the convocation through the Student Affairs Desk before 30 October.', officeLabel: 'CAMPUS INCHARGE', createdAt: days(4) }, 0.2, 'ci')
await ann({ scopeId: idOf('CS'), category: 'SCHEDULE', title: 'CSC301 lab practical shifted to Faculty Computing Lab 2', body: 'Permanent venue update for Thursday practical sessions from Advanced Systems Lab to Faculty Computing Lab 2 effective Week 8.', refNo: 'DEPT CIRCULAR #44', officeLabel: 'CS COORDINATOR', attachments: [{ id: 'room-l2', name: 'ROOM_ALLOCATION_L2.pdf', size: 90_000, mime: 'application/pdf', url: pdf('Room allocation Lab 2', ['Faculty Computing Lab 2']).url }], createdAt: days(1) }, 0.5, 'coordCS')
await ann({ scopeId: idOf('CS'), category: 'GENERAL', title: 'Midterm syllabus freeze this Friday 16:00 PKT', body: 'All instructors must freeze midterm syllabi by Friday 16:00. Course folders will be audited by the Quality Enhancement Cell.', officeLabel: 'HOD CS', createdAt: hrs(12) }, 0.3, 'hodCS')
await ann({ scopeId: idOf('FA23-BCS'), category: 'SCHEDULE', title: 'Lab Session 4 will be held in Lab 2 tomorrow 08:30 AM', body: 'Attendance is mandatory. Please bring your lab manuals.', officeLabel: 'CS COORDINATOR', createdAt: hrs(5) }, 0.6, 'coordCS')
await ann({ scopeId: idOf('EE'), category: 'EVENT', title: 'EE Seminar Hall booking for IEEE guest lecture', body: 'The EE seminar hall is booked on 28 October for the IEEE guest lecture.', officeLabel: 'EE COORDINATOR', createdAt: days(2) }, 0.25, 'coordEE')
// gazettes (examination cell)
const g804 = pdf('Mid-Term Examination Schedule Fall 2026', ['Gazette CUI/ISB/EXAM/26-804', 'Official datesheet, hall allotments and invigilation rosters.'])
const gaz = async (o, f) => ann({ kind: 'GAZETTE', scopeId: C, category: 'EXAM', signed: true, officeLabel: 'EXAMINATION CELL', ...o }, f, 'examOfficer')
await gaz({ number: 804, refNo: 'CUI/ISB/EXAM/26-804', title: 'Mid-Term Examination Schedule Fall 2026', body: 'Official datesheet, hall allotments, seating protocols, and invigilation roasters for terminal and foundation undergraduate and postgraduate modules.', audienceLabel: 'All Undergraduate & Graduate Batches (FA22 to FA26)', expiresAt: inDays(14), attachments: [{ id: g804.id, name: 'Midterm-Datesheet-Revised-FA26.pdf', size: 1_400_000, mime: 'application/pdf', url: g804.url, sha256: '7f3b89...e3a09' }], createdAt: hrs(2) }, 0.42)
await gaz({ number: 790, refNo: 'CUI/ISB/EXAM/26-790', title: 'Guidelines for Examination Hall Conduct & Unfair Means (UMC) Penalties', body: 'Mandatory policy documentation highlighting electronic embargo, disciplinary board actions, roll number slip requirements, and examination room decorum.', audienceLabel: 'Campus-wide (All Schools, Faculty & Staff)', createdAt: days(4) }, 0.91)
await gaz({ number: 778, refNo: 'CUI/ISB/EXAM/26-778', title: 'Special Examination Form & Fee Defaulter Clearance Notice', body: 'Deadlines for submission of clearance forms, dues clearance with Accounts Branch, and admit card authorization for terminal batch special cases.', audienceLabel: 'Semester 7 & 8 Terminal Batches', createdAt: days(12), expiresAt: days(9) }, 1)
await M.Announcement.updateOne({ refNo: 'CUI/ISB/EXAM/26-778' }, { status: 'ARCHIVED' })
await M.Setting.create({ key: 'examCell', value: {
  deskCode: 'SEC-EXAM-ISB-09', queuedForSeal: 2,
  window: { label: '20 Oct – 01 Nov 2026', session: 'Fall 2026 Midterm Session', countdown: 'T-minus 14 days to lock' },
  auditRepo: { status: 'ISO-9001 Synced', vault: 'SHA-256 Digest Vault: OK', registryKey: '#FA26-EX-992' },
  protocol: { title: 'Gazette Protocol §14', subtitle: 'STATUTORY REQUISITE', body: 'All examination circulars require SHA-256 digital signature verification and must provide at least 10 working days notice prior to session start. Unsigned circulars are automatically held in Quarantine.' },
  token: { slot: 'CUI-HSM-SLOT-03', signatory: 'Incharge Exam Cell', publicKeyExpires: '31 DEC 2026', slotHash: sha256('HSM-SLOT-03') },
  halls: [{ name: 'Main Academic Block (MAB-Halls 1-4)', seats: 480, capacity: 520 }, { name: 'Engineering Block Hall E-02', seats: 210, capacity: 300 }, { name: 'EE Special Assessment Center', seats: 140, capacity: 160 }],
  contacts: [{ name: 'CS Coordinator Desk', initials: 'CS', ext: '5104', person: 'Dr. Sarah Malik' }, { name: 'Student Affairs Counter 1', initials: 'SA', ext: '5022', person: 'Mr. Naveed Alam' }, { name: 'EE Exam Sub-Committee', initials: 'EE', ext: '5140', person: 'Engr. Farooq' }],
} })
await M.Setting.create({ key: 'facilities', value: [{ block: 'LAB COMPLEX A', title: 'CS Lab 1–4 Re-partitioning for SP27', capacity: '240 Concurrent Sessions', status: 'Ready' }, { block: 'SEMINAR BLOCK 3', title: 'EE & MS Combined Lecture Allocations', capacity: '180 Seats', status: 'Scheduled' }] })
log('board + gazettes seeded')

// ───────────────────────────── messages
const actors = new Map((await loadAllActors()).map((a) => [a.uid, a]))
const grp = (q) => M.Group.findOne(q).lean()
const say = async (group, uid, body, when, o = {}) => {
  const a = actors.get(uid)
  const m = await M.Message.create({ groupId: group._id, senderId: a._id, body, createdAt: when, updatedAt: when, senderSnapshot: snapshotFor(a, o.course ? { course: o.course } : {}), ...o })
  if (!o.threadOf) await M.Group.updateOne({ _id: group._id }, { $max: { lastMessageAt: when } })
  return m
}
const teachersCS = await grp({ template: 'TEACHERS', orgUnitId: idOf('CS') })
const roster = pdf('FA26 Midterm Invigilation Duty Roster', ['CS Department', 'Inspect your assigned slots in the Faculty Portal.'])
const m1 = await say(teachersCS, 'EMP-CS-001', 'Midterm invigilation duties have been uploaded to the Faculty Portal. Please inspect your assigned slots. Midterm syllabus freeze is this Friday 16:00 PKT.', today(9, 15), { attachments: [{ id: roster.id, name: 'FA26-Midterm-Invigilation-Duty-Roster.pdf', size: 850_000, mime: 'application/pdf', url: roster.url, label: 'INSTITUTIONAL CIRCULAR' }], pinned: true })
await M.Group.updateOne({ _id: teachersCS._id }, { pins: [m1._id], 'mandate': 'Official notices, faculty council meeting minutes, and academic circulars regarding Fall 2026 instruction.' })
await say(teachersCS, 'EMP-CS-002', 'Course folders for CSC301 and CSC322 will be audited next week by the Quality Enhancement Cell (QEC). Please ensure all lecture notes and quizzes are indexed.', today(10, 5))
const crl = await grp({ template: 'CR_LINE', orgUnitId: idOf('FA23-BCS') })
const cls = await grp({ template: 'CLASS', orgUnitId: idOf('FA23-BCS') })
const policy = pdf('MIDTERM_POLICY_FA26', ['Midterm policy Fall 2026'])
const c1 = await say(crl, 'EMP-CS-002', 'Reminder to both CRs: Midterm invigilation schedules are drafted. Ensure all students in FA23-BCS have settled registration holds with the Academic Office by Thursday 16:00 PKT.', today(9, 12), { attachments: [{ id: policy.id, name: 'MIDTERM_POLICY_FA26.pdf', size: 420_000, mime: 'application/pdf', url: policy.url }] })
await say(crl, 'FA23-BCS-041', 'Acknowledged, Dr. Tariq. I have flagged the 4 students who had portal holds. All four have submitted their clearance vouchers to the Coordination Desk.', today(9, 40))
const c3 = await say(crl, 'EMP-CS-010', '"Please inform FA23-BCS that Lab Session 4 will be held in Lab 2 tomorrow at 08:30 AM. Attendance is mandatory."', today(10, 41), { kind: 'DIRECTIVE', course: 'CSC301 · DATA STRUCTURES' })
const relayedBody = c3.body
const rel = await say(cls, 'FA23-BCS-041', relayedBody, today(10, 44), { postedAs: 'RELAY', relayOf: { messageId: c3._id, groupId: crl._id, sourceName: 'Dr. Babar Khan', course: 'CSC301', byUserId: actors.get('FA23-BCS-041')._id } })
await M.Message.updateOne({ _id: c3._id }, { relayedTo: [{ groupId: cls._id, groupName: cls.name, byUserId: actors.get('FA23-BCS-041')._id, byName: 'Hamza Ali', at: today(10, 44), messageId: rel._id }] })
await say(crl, 'FA23-BCS-018', 'Dr. Babar, Hamza has broadcasted the change to the class channel. I have also cross-verified that Lab 2 is unlocked and booked for us on the Department Room Register.', today(11, 5))
await say(crl, 'EMP-CS-011', 'Noted on Lab 4 shifting. For CSC322, Quiz 2 answer sheets are vetted. Both CRs can collect the physical rubrics from Cabin C-14 during office hours (14:00 - 15:30).', today(11, 32), { course: 'CSC322 · OPERATING SYSTEMS' })
await say(cls, 'FA23-BCS-023', 'Same syllabus as Quiz 1?', today(10, 47))
await say(cls, 'EMP-CS-001', 'Yes, same syllabus.', today(10, 52), { postedAs: 'HOD' })
await say(cls, 'FA23-BCS-052', 'Thank you sir. Is the lab manual available on the portal?', today(11, 2))
await say(cls, 'FA23-BCS-041', 'Yes, I uploaded the manual to the CR line files. Check the pinned documents.', today(11, 6))
const crsCS = await grp({ template: 'CRS', orgUnitId: idOf('CS') })
const iqbal = await say(crsCS, 'EMP-CS-002', 'University closed Friday for Iqbal Day; Friday classes move to Saturday. Please relay to your classes.', today(8, 30))
await say(crsCS, 'FA23-BCS-041', 'Relayed to FA23-BCS.', today(8, 45))
const cls2 = await grp({ template: 'CLASS', orgUnitId: idOf('SP23-BCS') })
await say(cls2, 'SP23-BCS-102', 'University closed Friday for Iqbal Day; Friday classes move to Saturday.', today(8, 50), { postedAs: 'RELAY', relayOf: { messageId: iqbal._id, groupId: crsCS._id, sourceName: 'Dr. Tariq Mahmood', byUserId: actors.get('SP23-BCS-102')._id } })
await M.Message.updateOne({ _id: iqbal._id }, { relayedTo: [{ groupId: cls._id, groupName: cls.name, byUserId: actors.get('FA23-BCS-041')._id, byName: 'Hamza Ali', at: today(8, 45) }, { groupId: cls2._id, groupName: cls2.name, byUserId: actors.get('SP23-BCS-102')._id, byName: 'Zainab Khan', at: today(8, 50) }] })
const crl2 = await grp({ template: 'CR_LINE', orgUnitId: idOf('SP23-BCS') })
await say(crl2, 'EMP-CS-014', 'AI quiz on Monday covers chapters 5 to 7.', hrs(26), { course: 'CSC401 · ARTIFICIAL INTELLIGENCE' })
await say(crl2, 'SP23-BCS-102', 'Noted, sir. I will relay it.', hrs(25))
for (const [tmpl, org_, lines] of [
  ['COORDINATORS', null, [['EMP-CS-002', 'Dept coordinators: please upload FA26 offerings for next term before the 20th.', hrs(30)], ['EMP-EE-002', 'EE offerings are loaded for SP27. MS still pending.', hrs(28)], ['ADM-002', 'Reminder: rollover wizard is blocked until every department has offerings loaded.', hrs(27)]]],
  ['HODS', null, [['EMP-ISB-001', 'HOD meeting on Tuesday 10:00, Committee Room 1. Agenda: SP27 timetable and exam hall capacity.', hrs(40)], ['EMP-CS-001', 'CS will present the lab re-partitioning plan.', hrs(39)]]],
  ['SA_STAFF', null, [['EMP-SA-001', 'Counter 3 will process need-based dossiers till 23 Oct. Please prioritise interviews.', hrs(18)], ['EMP-SA-004', 'Noted. 42 dossiers received so far.', hrs(17)]]],
]) {
  const g = await grp({ template: tmpl })
  for (const [uid, body, when] of lines) await say(g, uid, body, when)
}
const dm = await M.Group.create({ name: 'Hamza Ali & Bilal Ahmed', kind: 'DIRECT', glyph: '@', directKey: [String(actors.get('FA23-BCS-041')._id), String(actors.get('FA23-BCS-052')._id)].sort().join(':') })
await M.Membership.insertMany([{ groupId: dm._id, userId: actors.get('FA23-BCS-041')._id }, { groupId: dm._id, userId: actors.get('FA23-BCS-052')._id }])
await say(dm, 'FA23-BCS-052', 'Hamza, did Dr. Babar share the lab manual?', hrs(5)); await say(dm, 'FA23-BCS-041', 'Yes, uploaded to the CR line pinned files. I will relay it.', hrs(4.8))
const dm2 = await M.Group.create({ name: 'Dr. Asif & Dr. Tariq', kind: 'DIRECT', glyph: '@', directKey: [String(actors.get('EMP-CS-001')._id), String(actors.get('EMP-CS-002')._id)].sort().join(':') })
await M.Membership.insertMany([{ groupId: dm2._id, userId: actors.get('EMP-CS-001')._id }, { groupId: dm2._id, userId: actors.get('EMP-CS-002')._id }])
await say(dm2, 'EMP-CS-001', 'Tariq, please share the FA23-BCS CR coverage report before the HOD meeting.', hrs(9)); await say(dm2, 'EMP-CS-002', 'Sure sir, sending it today.', hrs(8.9))
// custom groups
const fyp = await M.Group.create({ name: 'FYP Committee — CS', kind: 'CUSTOM', glyph: '#', ownerId: actors.get('EMP-CS-002')._id, manager: { userId: actors.get('EMP-CS-002')._id }, maxMembers: 50, description: 'Final-year project evaluation committee.' })
await M.Membership.insertMany([['EMP-CS-002', 'MANAGER'], ['EMP-CS-001', 'MEMBER'], ['EMP-CS-014', 'MEMBER'], ['EMP-CS-004', 'MEMBER']].map(([u, r]) => ({ groupId: fyp._id, userId: actors.get(u)._id, groupRole: r, source: 'MANUAL' })))
await say(fyp, 'EMP-CS-002', 'FYP-I proposal defenses start Monday. Panels are posted on the board.', hrs(22))
const beta = await M.Group.create({ name: 'Project Group Beta', kind: 'CUSTOM', glyph: '#', ownerId: actors.get('FA23-BCS-071')._id, manager: { userId: actors.get('FA23-BCS-071')._id }, maxMembers: 15, description: 'DB project coordination.' })
await M.Membership.insertMany([['FA23-BCS-071', 'MANAGER'], ['FA23-BCS-004', 'MEMBER'], ['FA23-BCS-018', 'MEMBER'], ['FA23-BCS-052', 'MEMBER']].map(([u, r]) => ({ groupId: beta._id, userId: actors.get(u)._id, groupRole: r, source: 'MANUAL' })))
const e1 = await say(beta, 'FA23-BCS-004', "You don't get to submit that file without my review first. Don't act smart here, you know what will happen to your project grades if I escalate to lab instructors.", hrs(30) )
const e2 = await say(beta, 'FA23-BCS-004', 'Answer the call right now. Stop ignoring this channel or I will make sure your lab credentials are pulled.', hrs(30))
const e3 = await say(beta, 'FA23-BCS-071', 'Hashir please cease messaging this. We have already logged the submission with Dr. Arshad’s office.', hrs(29.9))
const study = await M.Group.create({ name: 'OS study group', kind: 'CUSTOM', glyph: '#', ownerId: actors.get('FA23-BCS-052')._id, manager: { userId: actors.get('FA23-BCS-052')._id }, maxMembers: 15, description: 'Operating systems revision.' })
await M.Membership.insertMany([['FA23-BCS-052', 'MANAGER'], ['FA23-BCS-023', 'MEMBER'], ['FA23-BCS-041', 'MEMBER']].map(([u, r]) => ({ groupId: study._id, userId: actors.get(u)._id, groupRole: r, source: 'MANUAL' })))
await say(study, 'FA23-BCS-052', 'Anyone free for OS revision tonight at 8?', hrs(3)); await say(study, 'FA23-BCS-023', 'Count me in. Process scheduling first?', hrs(2.9))
log('groups, relays, DMs and custom groups seeded')

// ───────────────────────────── tickets
let seq = 0
const tk = async (deskSlug, reqUid, category, subject, description, o = {}) => {
  const d = await M.Desk.findOne({ slug: deskSlug })
  const requester = actors.get(reqUid)
  const n = (d.seq += 1); await d.save()
  const prog = requester.batchId ? org.programOf(requester.batchId) : null
  const t = await M.Ticket.create({ code: `${d.prefix}-${o.no ?? n}`, deskId: d._id, requesterId: requester._id, category, subject, description, programId: prog?._id, history: [{ at: o.createdAt, by: requester._id, action: 'created', to: 'OPEN' }], createdAt: o.createdAt, ...o.fields })
  for (const m of o.thread ?? []) await M.Message.create({ ticketId: t._id, senderId: actors.get(m[0])._id, body: m[1], internal: !!m[3], createdAt: m[2], senderSnapshot: snapshotFor(actors.get(m[0])) })
  return t
}
await tk('student-affairs', 'FA23-BCS-052', 'Fee Challan & Instalment Approval', 'Fee Instalment Request', 'Request for splitting Fall 2026 tuition into 2 instalments due to family circumstances.', { no: 8491, createdAt: new Date('2026-10-06T09:00:00'), fields: { status: 'IN_PROGRESS', counterNo: 2, assigneeId: actors.get('EMP-SA-003')._id, firstReplyAt: hrs(20) }, thread: [['EMP-SA-003', 'We received your request. Please upload the paid first-instalment voucher and the guardian income certificate.', hrs(20)], ['FA23-BCS-052', 'Uploaded the voucher. Income certificate coming tomorrow.', hrs(10)], ['EMP-SA-003', 'Check the guardian income certificate carefully before approval.', hrs(9), true]] })
const t2 = await tk('student-affairs', 'FA23-BCS-052', 'Bonafide Certificate', 'Bonafide Certificate for Visa', 'Need a bonafide certificate for a visa application.', { no: 7910, createdAt: new Date('2026-09-24T10:00:00'), fields: { status: 'RESOLVED', counterNo: 1, assigneeId: actors.get('EMP-SA-002')._id, firstReplyAt: new Date('2026-09-24T14:00:00'), resolvedAt: days(3), resolution: 'Certificate ready for collection from Counter 1.' }, thread: [['EMP-SA-002', 'Certificate ready for collection from Counter 1.', days(3)]] })
await tk('student-affairs', 'FA23-BCS-023', 'Scholarship & Financial Aid', 'Interview slot for need-based scholarship', 'My shortlisted interview time clashes with a lab. Can it be rescheduled?', { createdAt: hrs(6), fields: { status: 'OPEN', counterNo: 3, assigneeId: actors.get('EMP-SA-004')._id } })
await tk('student-affairs', 'FA23-BCS-041', 'Transport Pass', 'RFID transport pass not scanning', 'My bus RFID pass stopped scanning at the Gate 2 reader.', { createdAt: hrs(30), fields: { status: 'ESCALATED', level: 2, counterNo: 4, assigneeId: actors.get('EMP-SA-001')._id, overdue: true, firstReplyAt: hrs(26) }, thread: [['EMP-SA-005', 'Escalated to the SA Head: needs a hardware replacement approval.', hrs(26)]] })
await tk('cs-coordinator', 'FA23-BCS-052', 'Attendance', 'Attendance shortage in CSC322', 'Medical leave days were not marked in the attendance sheet for CSC322.', { createdAt: hrs(20), fields: { status: 'OPEN' } })
await tk('cs-coordinator', 'SP23-BCS-102', 'Timetable', 'Clash between CSC401 and CSC433', 'Both courses have a lecture at 10:00 on Wednesday.', { createdAt: hrs(50), fields: { status: 'IN_PROGRESS', assigneeId: actors.get('EMP-CS-002')._id, firstReplyAt: hrs(40) }, thread: [['EMP-CS-002', 'Checking with the timetable committee.', hrs(40)]] })
await tk('library', 'FA23-BCS-052', 'Fine / Dues', 'Late fee waiver for returned book', 'I returned the book on time but the system shows a fine.', { createdAt: hrs(60), fields: { status: 'OPEN' } })
await tk('cafe', 'FA23-BCS-023', 'Complaint', 'Hygiene concern at cafe counter', 'Found staff without gloves while serving.', { createdAt: hrs(15), fields: { status: 'OPEN' } })
await tk('examination-cell', 'FA23-BCS-041', 'Hall Ticket', 'Hall ticket shows wrong course', 'Hall ticket lists CSC231 while I am registered for CSC322.', { createdAt: hrs(8), fields: { status: 'OPEN' } })

// ───────────────────────────── reports
const rep = (o) => M.Report.create(o)
await rep({ code: 'REP-104', reporterId: actors.get('FA23-BCS-071')._id, targetUserId: actors.get('FA23-BCS-004')._id, groupId: beta._id, kind: 'HARASSMENT', reason: 'harassment', note: 'User was repeatedly asked to discontinue aggressive language and unprompted phone calls following the official project sync yesterday evening. Despite warnings from two other peers in Project Group Beta, the individual initiated derogatory personal targeting in group text.', priority: 'HIGH', status: 'IN_REVIEW', route: 'ADMIN', routeOrgId: campus._id,
  evidence: [[e1, 'Coercive intimidation'], [e2, 'Unauthorized administrative threat'], [e3, null]].map(([m, tag]) => ({ messageId: m._id, senderName: m.senderSnapshot.name, senderUid: m.senderSnapshot.uid, body: m.body, at: m.createdAt, tag, context: 'Group Public Feed' })), history: [{ action: 'filed' }, { action: 'escalated', note: 'Escalated by CS coordinator for Admin review' }], createdAt: hrs(26) })
await rep({ code: 'REP-103', reporterId: actors.get('FA24-BCS-044')._id, targetUserId: actors.get('FA24-BCS-081')._id, groupId: (await grp({ template: 'CLASS', orgUnitId: idOf('FA24-BCS') }))._id, kind: 'BROADCAST', reason: 'spam', note: 'Unauthorized Mass Mention Relay — message relayed to 142 members', priority: 'NORMAL', status: 'OPEN', route: 'COORDINATOR', routeOrgId: idOf('CS'), evidence: [{ messageId: rel._id, senderName: 'Babar Azam', senderUid: 'FA24-BCS-081', body: 'Mass-mention broadcast to class group.', at: hrs(24), context: 'FA24-BCS-Official' }], history: [{ action: 'filed' }], createdAt: hrs(24) })
await rep({ code: 'REP-101', reporterId: actors.get('FA23-BCS-023')._id, targetUserId: actors.get('FA23-BCS-023')._id, kind: 'AUTOMATED', reason: 'External Suspicious Link Injection', note: 'Domain filtered globally · Student warned', priority: 'NORMAL', status: 'RESOLVED', route: 'ADMIN', routeOrgId: campus._id, outcome: 'Action taken: formal warning', evidence: [], history: [{ action: 'filed' }, { action: 'warn' }], createdAt: hrs(72) })

// ───────────────────────────── notifications & misc
for (const u of [actors.get('FA23-BCS-052'), actors.get('FA23-BCS-041'), actors.get('EMP-CS-001')]) {
  await M.Notification.create({ userId: u._id, type: 'board', title: 'ADMIN OFFICE: Fall 2026 final exam datesheet', link: '/board', mutable: false, createdAt: hrs(30) })
  await M.Notification.create({ userId: u._id, type: 'board', title: 'ADMIN OFFICE: Campus closed on Friday for Iqbal Day', link: '/board', mutable: false, createdAt: hrs(20) })
}
await M.Notification.create({ userId: actors.get('FA23-BCS-052')._id, type: 'ticket', title: 'SA-8491: new reply', body: 'We received your request. Please upload the paid first-instalment voucher…', link: '/tickets', createdAt: hrs(20) })
await M.Notification.create({ userId: actors.get('FA23-BCS-041')._id, type: 'mention', title: 'Dr. Tariq Mahmood mentioned you in FA23-BCS CR Line', link: '/groups', createdAt: hrs(2) })
await M.Setting.create({ key: 'system', value: { smtp: { host: 'smtp.comsats.edu.pk', port: 587, from: 'no-reply@comsats.edu.pk' }, uploads: { maxMb: 10, types: ['pdf', 'png', 'jpg'] }, passwordPolicy: { minLength: 10, lockoutAttempts: 5, lockoutMinutes: 15 }, retention: { auditYears: 3, removedMessageDays: 30 }, maintenance: { enabled: false, message: '' } } })
await syncAll({ live: false })

// ───────────────────────────── DEMO_ACCOUNTS.md
const rows = Object.values(A).map((a) => `| ${a.uid} | ${a.name} | ${a.note} |`).join('\n')
fs.writeFileSync(path.resolve(__dirname, '../../DEMO_ACCOUNTS.md'), `# CUI Connect — demo accounts

Generated by \`npm run seed\`. Local development only.

**Password for every account below:** \`${DEMO_PASSWORD}\`
**New-student activation account:** \`FA26-BCS-014\` with temporary password \`Temp-Pass-2026!\` (forces the activation screen).

Passwords for other generated students are the same demo password. Password-reset codes are written to the dev mailbox: \`GET /api/dev/mailbox\`.

| ID | Name | Role / what to look at |
| --- | --- | --- |
${rows}
`)
console.log('\n✔ Seed complete.')
console.log(`  users: ${await M.User.countDocuments()} · groups: ${await M.Group.countDocuments()} · messages: ${await M.Message.countDocuments()} · announcements: ${await M.Announcement.countDocuments()} · tickets: ${await M.Ticket.countDocuments()}`)
console.log('  Accounts listed in server/DEMO_ACCOUNTS.md')
await mongoose.disconnect()
process.exit(0)
