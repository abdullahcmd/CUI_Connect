import mongoose from 'mongoose'
import { encryptedFields } from '../lib/crypto.js'
const { Schema, model } = mongoose
const oid = Schema.Types.ObjectId

export const AuditLog = model('AuditLog', new Schema({
  actorId: { type: oid, ref: 'User' },
  actorUid: String,
  actorName: String,
  action: { type: String, required: true },
  category: { type: String, default: 'general' }, // structure | account | security | content | system
  target: { kind: String, id: String, label: String },
  meta: Schema.Types.Mixed,
  before: Schema.Types.Mixed,
  after: Schema.Types.Mixed,
  ip: String,
  at: { type: Date, default: Date.now, index: -1 },
}))

export const RefreshToken = model('RefreshToken', new Schema({
  userId: { type: oid, ref: 'User', index: true },
  tokenHash: { type: String, index: true },
  device: String,
  ip: String,
  createdAt: { type: Date, default: Date.now },
  lastUsedAt: { type: Date, default: Date.now },
  expiresAt: Date,
  revokedAt: Date,
  replacedBy: String,
}))

export const PasswordReset = model('PasswordReset', new Schema({
  userId: { type: oid, ref: 'User' },
  codeHash: String,
  expiresAt: Date,
  attempts: { type: Number, default: 0 },
  verifiedToken: String,
  usedAt: Date,
}, { timestamps: true }))

export const Mail = model('Mail', new Schema({ // dev outbox — shows what would be emailed
  to: String, subject: String, body: String, meta: Schema.Types.Mixed,
}, { timestamps: true }))

export const Notification = model('Notification', new Schema({
  userId: { type: oid, ref: 'User', index: true },
  type: String, // board | mention | dm | ticket | role | report | submission | import | reminder
  title: String,
  body: String,
  link: String,
  readAt: Date,
  mutable: { type: Boolean, default: true },
}, { timestamps: true }))

const reportSchema = new Schema({
  code: String, // REP-104
  reporterId: { type: oid, ref: 'User' },
  targetUserId: { type: oid, ref: 'User' },
  groupId: { type: oid, ref: 'Group' },
  kind: { type: String, enum: ['HARASSMENT', 'SPAM', 'INAPPROPRIATE', 'BROADCAST', 'AUTOMATED', 'OTHER'], default: 'OTHER' },
  reason: String,
  note: String,
  priority: { type: String, enum: ['NORMAL', 'HIGH'], default: 'NORMAL' },
  status: { type: String, enum: ['OPEN', 'IN_REVIEW', 'RESOLVED', 'DISMISSED', 'ESCALATED'], default: 'OPEN' },
  route: { type: String, enum: ['GROUP_MANAGER', 'COORDINATOR', 'STUDENT_AFFAIRS', 'ADMIN'], default: 'ADMIN' },
  routeOrgId: { type: oid, ref: 'OrgUnit' },
  evidence: [{ messageId: oid, senderName: String, senderUid: String, body: String, at: Date, tag: String, context: String }],
  outcome: String,
  actionTaken: String,
  reviewedBy: { type: oid, ref: 'User' },
  history: [{ at: { type: Date, default: Date.now }, by: oid, action: String, note: String }],
}, { timestamps: true })
encryptedFields(reportSchema, ['note', 'evidence.body'])
export const Report = model('Report', reportSchema)

export const Setting = model('Setting', new Schema({ key: { type: String, unique: true }, value: Schema.Types.Mixed }, { timestamps: true }))

export const ImportJob = model('ImportJob', new Schema({
  startedBy: { type: oid, ref: 'User' },
  kind: { type: String, default: 'STUDENTS' },
  fileName: String,
  status: { type: String, enum: ['PREVIEW', 'DONE', 'FAILED'], default: 'PREVIEW' },
  rows: [Schema.Types.Mixed],
  summary: Schema.Types.Mixed,
  errorRows: [Schema.Types.Mixed],
}, { timestamps: true }))
