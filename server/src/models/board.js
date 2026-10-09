import mongoose from 'mongoose'
const { Schema, model } = mongoose
const oid = Schema.Types.ObjectId

const attachment = new Schema({ id: String, name: String, size: Number, mime: String, url: String, sha256: String, label: String }, { _id: false })

export const CATEGORIES = ['SCHEDULE', 'HOLIDAY', 'EXAM', 'FEE', 'EVENT', 'GENERAL']

export const Announcement = model('Announcement', new Schema({
  kind: { type: String, enum: ['CIRCULAR', 'GAZETTE'], default: 'CIRCULAR' },
  scopeId: { type: oid, ref: 'OrgUnit', required: true },
  scopeType: String,
  scopeLabel: String, // "UNIVERSITY · ADMIN OFFICE"
  category: { type: String, enum: CATEGORIES, default: 'GENERAL' },
  refNo: String, // CU/REG-26/104
  number: Number, // gazette notice #
  title: { type: String, required: true },
  body: { type: String, default: '' },
  attachments: [attachment],
  effectiveFrom: Date,
  expiresAt: Date,
  pinned: { type: Boolean, default: false },
  mandatoryAck: { type: Boolean, default: false },
  forwardToCRs: { type: Boolean, default: false },
  authorId: { type: oid, ref: 'User', required: true },
  officeLabel: String,
  status: { type: String, enum: ['DRAFT', 'PUBLISHED', 'ARCHIVED'], default: 'PUBLISHED' },
  digest: String, // sha256 of body + title (gazette ledger)
  signed: { type: Boolean, default: false },
  audienceCount: { type: Number, default: 0 },
  audienceLabel: String,
  targetBatchIds: [{ type: oid }],
  acks: [{ userId: { type: oid, ref: 'User' }, at: { type: Date, default: Date.now } }],
  versions: [{ title: String, body: String, editedBy: { type: oid, ref: 'User' }, at: { type: Date, default: Date.now } }],
  forwards: [{ groupId: oid, by: oid, at: Date }],
  lockedAt: Date, // immutable after 60 min
  remindedAt: Date,
}, { timestamps: true }).index({ scopeId: 1, createdAt: -1 }).index({ pinned: 1 }))

export const Channel = model('Channel', new Schema({
  slug: { type: String, required: true, unique: true },
  code: String, // CH-SCH-840
  name: { type: String, required: true },
  initials: String,
  kind: { type: String, enum: ['INSTITUTIONAL', 'SOCIETY', 'UTILITY', 'DEPARTMENT'], default: 'INSTITUTIONAL' },
  tag: String, // "INSTITUTIONAL CORE", "TECH SOCIETY"
  description: String,
  about: String,
  tags: [String],
  ownerOfficeId: { type: oid, ref: 'OrgUnit' },
  ownerLabel: String,
  deskSlug: String, // "Ask Student Affairs" link
  publisherIds: [{ type: oid, ref: 'User' }],
  leadId: { type: oid, ref: 'User' },
  scopeOrgId: { type: oid, ref: 'OrgUnit' }, // dept channels
  joinMode: { type: String, enum: ['AUTO_LOCKED', 'AUTO_MUTE', 'OPT_IN'], default: 'OPT_IN' },
  requireApproval: { type: Boolean, default: false },
  openSubmissions: { type: Boolean, default: false }, // any student may submit (Lost & Found)
  audienceLabel: String,
  contact: { office: String, place: String, ext: String, email: String, hours: String },
  archived: { type: Boolean, default: false },
}, { timestamps: true }))

export const ChannelFollow = model('ChannelFollow', new Schema({
  channelId: { type: oid, ref: 'Channel', required: true },
  userId: { type: oid, ref: 'User', required: true },
  muted: { type: Boolean, default: false },
}, { timestamps: true }).index({ channelId: 1, userId: 1 }, { unique: true }))

export const ChannelPost = model('ChannelPost', new Schema({
  channelId: { type: oid, ref: 'Channel', required: true },
  authorId: { type: oid, ref: 'User', required: true },
  refNo: String,
  title: { type: String, required: true },
  body: String,
  attachments: [attachment],
  target: { programs: [String], intakes: [String], years: [Number], batchIds: [{ type: oid }], semesterMin: Number, semesterMax: Number, all: { type: Boolean, default: false } },
  eligibility: String, // "For FA23 and SP23 batches, BSCS & BSE programs"
  checklist: [String],
  applyBy: Date,
  urgent: { type: Boolean, default: false },
  officeLabel: String,
  status: { type: String, enum: ['PENDING', 'PUBLISHED', 'REJECTED', 'ARCHIVED'], default: 'PUBLISHED' },
  closed: { type: Boolean, default: false }, // "CYCLE CLOSED"
  submission: { regNo: String, eventDate: Date, cutoff: Date, scopeNote: String, submitterName: String },
  rejectReason: String,
  reviewedBy: { type: oid, ref: 'User' },
  reviewedAt: Date,
  interestedBy: [{ type: oid }],
  savedBy: [{ type: oid }],
  reminded48: { type: Boolean, default: false },
  askDeskSlug: String,
  askLabel: String,
}, { timestamps: true }).index({ channelId: 1, createdAt: -1 }))
