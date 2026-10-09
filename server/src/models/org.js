import mongoose from 'mongoose'
const { Schema, model } = mongoose
const oid = Schema.Types.ObjectId

export const ORG_TYPES = ['CAMPUS', 'OFFICE', 'DEPARTMENT', 'PROGRAM', 'BATCH', 'SECTION']

export const OrgUnit = model('OrgUnit', new Schema({
  type: { type: String, enum: ORG_TYPES, required: true },
  code: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  parentId: { type: oid, ref: 'OrgUnit', default: null },
  path: [{ type: oid }], // ancestors + self, root first
  status: { type: String, enum: ['ACTIVE', 'ARCHIVED'], default: 'ACTIVE' },
  // batch-only
  intake: { type: String, enum: ['FA', 'SP'] },
  year: Number,
  programId: { type: oid, ref: 'OrgUnit' },
  advisorId: { type: oid, ref: 'User' },
  section: String,
  expectedGraduation: String, // term code, e.g. SP27
  // office-only
  officeKind: String, // STUDENT_AFFAIRS | LIBRARY | CAFE | CDC | SPORTS | EXAM
  meta: Schema.Types.Mixed,
}, { timestamps: true }))

export const User = model('User', new Schema({
  uid: { type: String, required: true, unique: true, uppercase: true, trim: true },
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  passwordHash: { type: String, required: true },
  kind: { type: String, enum: ['STUDENT', 'STAFF'], required: true },
  batchId: { type: oid, ref: 'OrgUnit' },
  departmentId: { type: oid, ref: 'OrgUnit' },
  designation: String, // "Associate Professor", "CR", ...
  cabin: String,
  phone: String,
  gender: String,
  semester: Number,
  status: { type: String, enum: ['ACTIVE', 'FROZEN', 'ALUMNI', 'SUSPENDED', 'INACTIVE'], default: 'ACTIVE' },
  suspendedReason: String,
  mustChangePassword: { type: Boolean, default: false },
  tempPasswordExpires: Date,
  failedLogins: { type: Number, default: 0 },
  lockedUntil: Date,
  lastLoginAt: Date,
  lastSeenAt: Date,
  alumniUntil: Date,
  blocked: [{ type: oid, ref: 'User' }],
  settings: {
    theme: { type: String, default: 'system' },
    density: { type: String, default: 'default' },
    language: { type: String, default: 'en' },
    quietHours: { start: String, end: String },
    notifications: { type: Map, of: String, default: {} }, // section -> all|mentions|off
  },
  saved: [{ kind: String, refId: oid, at: { type: Date, default: Date.now } }],
}, { timestamps: true }))

export const ROLES = [
  'SUPER_ADMIN', 'ADMIN', 'CAMPUS_INCHARGE', 'SA_HEAD', 'SA_OFFICER', 'HOD', 'PROGRAM_INCHARGE', 'COORDINATOR',
  'TEACHER', 'CR', 'STUDENT', 'LIBRARIAN', 'LIBRARY_STAFF', 'CAFE_MANAGER', 'CAFE_STAFF', 'PUBLISHER',
  'SOCIETY_LEAD', 'EXAM_OFFICER',
]

export const RoleAssignment = model('RoleAssignment', new Schema({
  userId: { type: oid, ref: 'User', required: true, index: true },
  role: { type: String, enum: ROLES, required: true },
  orgUnitId: { type: oid, ref: 'OrgUnit', required: true },
  flags: Schema.Types.Mixed, // coordinatorsGroupManager, financialAid, channelId, ...
  from: { type: Date, default: Date.now },
  to: Date,
  assignedBy: { type: oid, ref: 'User' },
}, { timestamps: true }).index({ role: 1, orgUnitId: 1 }))

export const Term = model('Term', new Schema({
  code: { type: String, required: true, unique: true },
  name: String,
  startsAt: Date,
  endsAt: Date,
  current: { type: Boolean, default: false },
  rolledOverAt: Date,
}, { timestamps: true }))

export const CourseOffering = model('CourseOffering', new Schema({
  termId: { type: oid, ref: 'Term', required: true },
  courseCode: { type: String, required: true },
  title: String,
  creditHours: Number,
  batchId: { type: oid, ref: 'OrgUnit', required: true },
  teacherId: { type: oid, ref: 'User', required: true },
  room: String,
  slot: String,
}, { timestamps: true }).index({ termId: 1, batchId: 1 }).index({ termId: 1, teacherId: 1 }))
