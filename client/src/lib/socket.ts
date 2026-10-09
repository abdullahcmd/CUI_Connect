import { io, type Socket } from 'socket.io-client'
import { freshAccessToken } from './api'

/** One socket for the whole app. The server decides every room; the client only asks. */
export const socket: Socket = io('/', {
  autoConnect: false,
  transports: ['websocket', 'polling'],
  auth: (cb) => { freshAccessToken().then((token) => cb({ token })) },
})

export interface Ack<T = any> { ok: boolean; data?: T; code?: string; meta?: Record<string, any>; message?: string }

export function emit<T = any>(event: string, payload: unknown, timeoutMs = 8000): Promise<Ack<T>> {
  return new Promise((resolve) => {
    if (!socket.connected) return resolve({ ok: false, code: 'OFFLINE', message: 'You are offline. Reconnecting…' })
    socket.timeout(timeoutMs).emit(event, payload, (err: unknown, res: Ack<T>) => resolve(err ? { ok: false, code: 'TIMEOUT', message: "Couldn't send. Check your connection and retry." } : res))
  })
}
