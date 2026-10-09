import mongoose from 'mongoose'
import { encryptedFields } from '../lib/crypto.js'
const { Schema, model } = mongoose
const oid = Schema.Types.ObjectId

export const GROUP_KINDS = ['ROLE', 'CLASS', 'CR_LINE', 'CUSTOM', 'DIRECT']

export const Group = model('Group', new Schema({
  name: { type: String, required: true },
  slug: String,
  kind: { type: String, enum: GROUP_KINDS, required: true },
  template: String, // TEACHERS | CRS | COORDINATORS | HODS | SA_STAFF | DEPT_MGMT | CLASS | CR_LINE
  orgUnitId: { type: oid, ref: 'OrgUnit' },
  description: String,
  mandate: String,
  manager: { role: String, orgUnitId: { type: oid, ref: 'OrgUnit' }, flag: String, userId: { type: oid, ref: 'User' } },
  membershipRule: [Schema.Types.Mixed],
  visibilityGrants: [{ role: String, at: { type: oid, ref: 'OrgUnit' }, access: { type: String, enum: ['READ', 'READ_POST'] } }],
  posters: [String], // roles that may post while announce-only
  announceOnly: { type: Boolean, default: false },
  slowModeSeconds: { type: Number, default: 0 },
  restricted: { type: Boolean, default: false }, // shows "RESTRICTED ACCESS" lock mark
  glyph: String, // '#', '§', '◇' ...
  ownerId: { type: oid, ref: 'User' }, // custom groups
  maxMembers: Number,
  archived: { type: Boolean, default: false },
  lastMessageAt: Date,
  pins: [{ type: oid }],
  rules: [String],
  directKey: { type: String, index: true, sparse: true }, // "uidA:uidB" sorted for DMs
}, { timestamps: true }).index({ orgUnitId: 1, kind: 1 }))

export const Membership = model('Membership', new Schema({
  groupId: { type: oid, ref: 'Group', required: true },
  userId: { type: oid, ref: 'User', required: true },
  groupRole: { type: String, enum: ['MANAGER', 'MODERATOR', 'MEMBER'], default: 'MEMBER' },
  source: { type: String, enum: ['RULE', 'MANUAL'], default: 'RULE' },
  lastReadAt: { type: Date, default: Date.now },
  lastReadMessageId: { type: oid },
  mutedUntil: Date, // moderator mute in group
  notify: { type: String, enum: ['all', 'mentions', 'off'], default: 'all' },
}, { timestamps: true }).index({ groupId: 1, userId: 1 }, { unique: true }).index({ userId: 1 }))

const attachment = new Schema({
  id: String, name: String, size: Number, mime: String, url: String, sha256: String, label: String,
}, { _id: false })

const messageSchema = new Schema({
  groupId: { type: oid, ref: 'Group' },
  ticketId: { type: oid, ref: 'Ticket' },
  senderId: { type: oid, ref: 'User', required: true },
  senderSnapshot: { name: String, uid: String, badges: [String], dept: String, course: String, label: String },
  body: { type: String, default: '' },
  kind: { type: String, enum: ['TEXT', 'SYSTEM', 'DIRECTIVE'], default: 'TEXT' },
  attachments: [attachment],
  replyTo: { type: oid, ref: 'Message' },
  threadOf: { type: oid, ref: 'Message' },
  threadCount: { type: Number, default: 0 },
  mentions: [{ type: oid }],
  relayOf: { messageId: oid, groupId: oid, sourceName: String, course: String, byUserId: oid },
  relayedTo: [{ groupId: oid, groupName: String, byUserId: oid, byName: String, at: Date, messageId: oid }],
  forwardOf: { announcementId: oid, title: String },
  reactions: [{ emoji: String, userIds: [{ type: oid }] }],
  pinned: { type: Boolean, default: false },
  internal: { type: Boolean, default: false }, // ticket internal notes
  postedAs: String, // "HOD" when posting through a grant
  editedAt: Date,
  deletedAt: Date,
  deletedBy: { type: oid, ref: 'User' },
  deleteReason: String,
  purgeAt: Date,
  clientId: String,
}, { timestamps: true }).index({ groupId: 1, createdAt: -1 }).index({ ticketId: 1, createdAt: 1 }).index({ threadOf: 1, createdAt: 1 })
encryptedFields(messageSchema, ['body'])
export const Message = model('Message', messageSchema)
