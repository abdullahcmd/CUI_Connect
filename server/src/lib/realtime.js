/** Late-bound Socket.IO handle so services can emit without importing the server. */
let io = null
let adminNs = null
export const setIo = (i) => { io = i; adminNs = i.of('/admin') }
export const getIo = () => io

export const toUser = (userId, event, payload) => io?.to(`user:${userId}`).emit(event, payload)
export const toGroup = (groupId, event, payload) => io?.to(`group:${groupId}`).emit(event, payload)
export const toRoom = (room, event, payload) => io?.to(room).emit(event, payload)
export const toAdmin = (event, payload) => adminNs?.emit(event, payload)

export async function joinUser(userId, rooms) { if (io && rooms.length) await io.in(`user:${userId}`).socketsJoin(rooms) }
export async function leaveUser(userId, rooms) { if (io && rooms.length) await io.in(`user:${userId}`).socketsLeave(rooms) }
export async function disconnectUser(userId) { if (io) await io.in(`user:${userId}`).disconnectSockets(true) }
export const isOnline = async (userId) => io ? (await io.in(`user:${userId}`).fetchSockets()).length > 0 : false
export async function onlineUserIds() {
  if (!io) return new Set()
  const socks = await io.fetchSockets()
  return new Set(socks.map((s) => s.data?.user?.id).filter(Boolean))
}
