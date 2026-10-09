import { AuditLog } from '../models/index.js'
import { toAdmin } from './realtime.js'

export async function audit(actor, action, { category = 'general', target, meta, before, after, ip } = {}) {
  try {
    const row = await AuditLog.create({
      actorId: actor?._id ?? actor?.id, actorUid: actor?.uid, actorName: actor?.name, action, category, target, meta, before, after, ip,
    })
    toAdmin('audit:new', { id: String(row._id), action, at: row.at })
    return row
  } catch (e) { console.error('audit failed', e.message) }
}
