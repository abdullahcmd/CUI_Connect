import { Notification } from '../models/index.js'
import { toUser } from './realtime.js'

/** Persist a notification and push it to every open session of the user. */
export async function notify(userId, { type, title, body, link, mutable = true }) {
  const n = await Notification.create({ userId, type, title, body, link, mutable })
  toUser(userId, 'notification', { id: String(n._id), type, title, body, link, at: n.createdAt })
  return n
}
export async function notifyMany(userIds, payload) {
  await Promise.all([...new Set(userIds.map(String))].map((id) => notify(id, payload)))
}
