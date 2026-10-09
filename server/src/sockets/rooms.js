import { getIo } from '../lib/realtime.js'
import { loadActor } from '../services/actors.js'
import { Membership, ChannelFollow } from '../models/index.js'
import { groupsVisibleTo } from '../services/groups.js'
import { scopeIdsFor } from '../policy/index.js'

/** Everything a user's sockets should be in, derived entirely server-side. */
export async function desiredRooms(actor) {
  const { memberships, grantedGroups } = await groupsVisibleTo(actor)
  const rooms = new Set([`user:${actor.id}`])
  for (const gid of memberships.keys()) rooms.add(`group:${gid}`)
  for (const g of grantedGroups) rooms.add(`group:${g._id}`)
  for (const sid of scopeIdsFor(actor)) rooms.add(`board:${sid}`)
  for (const f of await ChannelFollow.find({ userId: actor._id }).lean()) rooms.add(`channel:${f.channelId}`)
  return rooms
}

const managed = (r) => r.startsWith('group:') || r.startsWith('board:') || r.startsWith('channel:')

export async function refreshUserRooms(userId) {
  const io = getIo()
  if (!io) return
  const socks = await io.in(`user:${userId}`).fetchSockets()
  if (!socks.length) return
  const actor = await loadActor(userId)
  const want = await desiredRooms(actor)
  for (const s of socks) {
    s.data.user = actor
    for (const r of s.rooms) if (managed(r) && !want.has(r)) s.leave(r)
    for (const r of want) if (!s.rooms.has(r)) s.join(r)
  }
}

export async function refreshAllRooms() {
  const io = getIo()
  if (!io) return
  const socks = await io.fetchSockets()
  const ids = [...new Set(socks.map((s) => s.data?.user?.id).filter(Boolean))]
  await Promise.all(ids.map(refreshUserRooms))
}
