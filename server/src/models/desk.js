import mongoose from 'mongoose'
import { encryptedFields } from '../lib/crypto.js'
const { Schema, model } = mongoose
const oid = Schema.Types.ObjectId

export const Desk = model('Desk', new Schema({
  slug: { type: String, unique: true, required: true },
  name: { type: String, required: true },
  prefix: { type: String, required: true }, // SA, CD, LB, CF, EX
  kind: { type: String, enum: ['COORDINATOR', 'STUDENT_AFFAIRS', 'LIBRARY', 'CAFE', 'EXAM', 'GENERAL'], required: true },
  orgUnitId: { type: oid, ref: 'OrgUnit' }, // department or office
  description: String,
  location: String,
  hours: String,
  block: String,
  online: { type: Boolean, default: true },
  categories: [String],
  agentIds: [{ type: oid, ref: 'User' }],
  headIds: [{ type: oid, ref: 'User' }],
  autoAssign: { type: Boolean, default: true },
  targetReplyHours: { type: Number, default: 48 },
  chain: [{ level: Number, label: String, role: String, scope: String }], // scope: DESK_ORG | PROGRAM_OF_REQUESTER | CAMPUS
  counters: [{ no: Number, name: String, handles: String, status: { type: String, default: 'OPEN' }, ext: String, agentId: { type: oid, ref: 'User' }, categories: [String] }],
  contacts: [{ label: String, ext: String, phone: String, email: String, hours: String, person: String }],
  advisory: { title: String, body: String, updatedAt: Date },
  safeguard: { title: String, body: String, ref: String },
  checklist: [String],
  requestForm: { code: String, accepted: String, maxMb: Number },
  seq: { type: Number, default: 8000 },
  archived: { type: Boolean, default: false },
}, { timestamps: true }))

const ticketSchema = new Schema({
  code: { type: String, unique: true }, // SA-8491
  deskId: { type: oid, ref: 'Desk', required: true },
  requesterId: { type: oid, ref: 'User', required: true },
  category: String,
  subject: { type: String, required: true },
  description: String,
  attachments: [{ id: String, name: String, size: Number, mime: String, url: String }],
  status: { type: String, enum: ['OPEN', 'IN_PROGRESS', 'ESCALATED', 'RESOLVED', 'CLOSED'], default: 'OPEN' },
  priority: { type: String, enum: ['NORMAL', 'HIGH'], default: 'NORMAL' },
  assigneeId: { type: oid, ref: 'User' },
  counterNo: Number,
  programId: { type: oid, ref: 'OrgUnit' },
  level: { type: Number, default: 1 },
  linkedPostId: { type: oid },
  resolution: String,
  resolvedAt: Date,
  closedAt: Date,
  reopenedAt: Date,
  reopened: { type: Boolean, default: false },
  overdue: { type: Boolean, default: false },
  firstReplyAt: Date,
  lastActivityAt: { type: Date, default: Date.now },
  history: [{ at: { type: Date, default: Date.now }, by: { type: oid, ref: 'User' }, action: String, note: String, from: String, to: String }],
}, { timestamps: true }).index({ deskId: 1, status: 1 }).index({ requesterId: 1 })
encryptedFields(ticketSchema, ['description', 'resolution'])
export const Ticket = model('Ticket', ticketSchema)
