import { create } from 'zustand'
import { emit, socket } from '../lib/socket'
import { api } from '../lib/api'
import type { GroupSummary, Message } from '../lib/types'
import { useAuth } from './auth'
import { useUi } from './ui'

interface Room { messages: Message[]; hasMore: boolean; summary?: GroupSummary; loading: boolean; error?: { code: string; message: string; meta?: any } }
interface ChatState {
  rooms: Record<string, Room>
  unread: Record<string, number>
  typing: Record<string, Record<string, string>>
  presence: Set<string>
  activeGroup: string | null
  threadFor: Message | null
  threads: Record<string, Message[]>
  open: (groupId: string) => Promise<void>
  loadOlder: (groupId: string) => Promise<void>
  send: (groupId: string, body: string, opts?: { attachments?: any[]; threadOf?: string; mentions?: string[] }) => Promise<void>
  retry: (groupId: string, clientId: string) => void
  openThread: (m: Message | null) => Promise<void>
  setActive: (id: string | null) => void
  markRead: (groupId: string) => void
  setUnreadFromSidebar: (u: Record<string, number>) => void
}

const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2))
const put = (rooms: Record<string, Room>, id: string, patch: Partial<Room>): Record<string, Room> => ({ ...rooms, [id]: { ...({ messages: [], hasMore: false, loading: false } as Room), ...rooms[id], ...patch } })
const upsert = (list: Message[], m: Message) => {
  const i = list.findIndex((x) => x.id === m.id || (m.clientId && x.clientId === m.clientId))
  if (i === -1) return [...list, m].sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt))
  const copy = list.slice(); copy[i] = { ...copy[i], ...m, pending: false, failed: undefined }; return copy
}

export const useChat = create<ChatState>((set, get) => ({
  rooms: {}, unread: {}, typing: {}, presence: new Set(), activeGroup: null, threadFor: null, threads: {},

  setUnreadFromSidebar: (u) => set({ unread: u }),
  setActive: (id) => set({ activeGroup: id, threadFor: null }),

  async open(groupId) {
    set((s) => ({ rooms: put(s.rooms, groupId, { loading: true, error: undefined }) }))
    if (!socket.connected) return // the 'connect' handler re-opens the active group
    const r = await emit('group:open', { groupId })
    if (!r.ok) return set((s) => ({ rooms: put(s.rooms, groupId, { loading: false, error: { code: r.code ?? 'ERROR', message: r.meta?.route?.message ?? r.meta?.message ?? r.message ?? 'Unavailable', meta: r.meta } }) }))
    set((s) => ({ rooms: put(s.rooms, groupId, { messages: r.data.messages, hasMore: r.data.hasMore, summary: r.data.summary, loading: false }) }))
    get().markRead(groupId)
  },

  async loadOlder(groupId) {
    const room = get().rooms[groupId]
    if (!room?.hasMore || !room.messages.length) return
    const r = await api.get<{ items: Message[]; hasMore: boolean }>(`/groups/${groupId}/messages?before=${room.messages[0].id}&limit=30`)
    set((s) => ({ rooms: put(s.rooms, groupId, { messages: [...r.items, ...s.rooms[groupId].messages], hasMore: r.hasMore }) }))
  },

  async send(groupId, body, opts = {}) {
    const me = useAuth.getState().me!.user
    const clientId = uuid()
    const optimistic: Message = {
      id: `pending-${clientId}`, clientId, groupId, sender: { id: me.id, name: me.name, initials: me.initials, badges: me.badges }, body, deleted: false, kind: 'TEXT',
      attachments: opts.attachments ?? [], threadCount: 0, mentions: [], relayedTo: [], reactions: [], pinned: false, createdAt: new Date().toISOString(), pending: true, threadOf: opts.threadOf,
    }
    if (opts.threadOf) set((s) => ({ threads: { ...s.threads, [opts.threadOf!]: [...(s.threads[opts.threadOf!] ?? []), optimistic] } }))
    else set((s) => ({ rooms: put(s.rooms, groupId, { messages: upsert(s.rooms[groupId]?.messages ?? [], optimistic) }) }))
    const r = await emit('message:send', { groupId, body, clientId, ...opts })
    const fail = (message: string, code: string) => {
      const mark = (list: Message[]) => list.map((m) => (m.clientId === clientId ? { ...m, pending: false, failed: message || code } : m))
      if (opts.threadOf) set((s) => ({ threads: { ...s.threads, [opts.threadOf!]: mark(s.threads[opts.threadOf!] ?? []) } }))
      else set((s) => ({ rooms: put(s.rooms, groupId, { messages: mark(s.rooms[groupId].messages) }) }))
    }
    if (!r.ok) return fail(r.meta?.reason ?? r.message ?? sentence(r.code), r.code ?? 'ERROR')
    const real: Message = r.data
    if (opts.threadOf) set((s) => ({ threads: { ...s.threads, [opts.threadOf!]: upsert(s.threads[opts.threadOf!] ?? [], real) } }))
    else set((s) => ({ rooms: put(s.rooms, groupId, { messages: upsert(s.rooms[groupId].messages.filter((m) => m.id !== optimistic.id), real) }) }))
  },

  retry(groupId, clientId) {
    const m = get().rooms[groupId]?.messages.find((x) => x.clientId === clientId)
    if (!m) return
    set((s) => ({ rooms: put(s.rooms, groupId, { messages: s.rooms[groupId].messages.filter((x) => x.clientId !== clientId) }) }))
    get().send(groupId, m.body, { attachments: m.attachments })
  },

  async openThread(m) {
    set({ threadFor: m })
    if (!m?.groupId) return
    const r = await api.get<{ items: Message[] }>(`/groups/${m.groupId}/messages?threadOf=${m.id}&limit=100`)
    set((s) => ({ threads: { ...s.threads, [m.id]: r.items } }))
  },

  markRead(groupId) {
    const room = get().rooms[groupId]
    const last = room?.messages.filter((m) => !m.pending).at(-1)
    if ((get().unread[groupId] ?? 0) > 0) set((s) => ({ unread: { ...s.unread, [groupId]: 0 } }))
    emit('message:read', { groupId, lastMessageId: last?.id })
  },
}))

export const sentence = (code?: string) => ({
  ANNOUNCE_ONLY: 'Only the group manager posts here right now.', NOT_MEMBER: "You don't have access to this group.", RATE_LIMITED: 'Slow down — try again in a moment.',
  READ_ONLY_CHANNEL: 'This group is read-only for you.', FORBIDDEN_DM: 'You cannot message this person directly.', OFFLINE: 'You are offline. Reconnecting…', TIMEOUT: "Couldn't send. Check your connection and retry.",
  VALIDATION_FAILED: 'That message is empty or too long.', NOT_CR: 'Only the CR of this batch can relay to the class.',
} as Record<string, string>)[code ?? ''] ?? "Couldn't send. Retry."

/** Wire socket events once, after login. */
let wired = false
export function wireSocket() {
  if (wired) return
  wired = true
  const chat = useChat.setState, get = useChat.getState
  const roomOf = (id?: string) => (id ? get().rooms[id] : undefined)

  socket.on('connect', () => { useUi.getState().setOnline(true); const g = get().activeGroup; if (g) get().open(g); useAuth.getState().refreshMe() })
  socket.on('disconnect', () => useUi.getState().setOnline(false))
  socket.on('connect_error', (e) => { if (e.message === 'UNAUTHENTICATED') useAuth.getState().logout({ expired: true }) })

  socket.on('message:new', (m: Message) => {
    if (!m.groupId) return
    const me = useAuth.getState().me?.user.id
    if (m.threadOf) {
      chat((s) => ({ threads: { ...s.threads, [m.threadOf!]: m.clientId && s.threads[m.threadOf!]?.some((x) => x.clientId === m.clientId) ? s.threads[m.threadOf!].map((x) => (x.clientId === m.clientId ? m : x)) : [...(s.threads[m.threadOf!] ?? []).filter((x) => x.id !== m.id), m] } }))
      return
    }
    const room = roomOf(m.groupId)
    if (room) chat((s) => ({ rooms: put(s.rooms, m.groupId!, { messages: upsert(s.rooms[m.groupId!].messages, m) }) }))
    if (m.sender.id !== me) {
      if (get().activeGroup === m.groupId && document.visibilityState === 'visible') get().markRead(m.groupId)
      else chat((s) => ({ unread: { ...s.unread, [m.groupId!]: (s.unread[m.groupId!] ?? 0) + 1 } }))
    }
    chat((s) => { const t = { ...s.typing }; if (t[m.groupId!]) { delete t[m.groupId!][m.sender.id] } return { typing: t } })
  })
  const patchMsg = (id: string, groupId: string | undefined, fn: (m: Message) => Message) => chat((s) => {
    const rooms = { ...s.rooms }
    if (groupId && rooms[groupId]) rooms[groupId] = { ...rooms[groupId], messages: rooms[groupId].messages.map((m) => (m.id === id ? fn(m) : m)) }
    const threads = Object.fromEntries(Object.entries(s.threads).map(([k, v]) => [k, v.map((m) => (m.id === id ? fn(m) : m))]))
    return { rooms, threads, threadFor: s.threadFor?.id === id ? fn(s.threadFor) : s.threadFor }
  })
  socket.on('message:updated', (m: Message) => patchMsg(m.id, m.groupId, (old) => ({ ...old, ...m })))
  socket.on('message:deleted', (d: { messageId: string; groupId: string; deletedAt: string; reason?: string }) => patchMsg(d.messageId, d.groupId, (m) => ({ ...m, deleted: true, body: '', attachments: [], deleteReason: d.reason })))
  socket.on('message:reactions', (d: { messageId: string; reactions: { emoji: string; count: number; userIds: string[] }[] }) => {
    const me = useAuth.getState().me?.user.id
    for (const [gid, room] of Object.entries(get().rooms)) if (room.messages.some((m) => m.id === d.messageId)) patchMsg(d.messageId, gid, (m) => ({ ...m, reactions: d.reactions.map((r) => ({ emoji: r.emoji, count: r.count, mine: r.userIds.includes(me!) })) }))
  })
  socket.on('message:thread', (d: { messageId: string; threadCount: number }) => { for (const [gid, room] of Object.entries(get().rooms)) if (room.messages.some((m) => m.id === d.messageId)) patchMsg(d.messageId, gid, (m) => ({ ...m, threadCount: d.threadCount })) })
  socket.on('typing', (d: { groupId: string; userId: string; name: string; state: string }) => {
    chat((s) => { const t = { ...s.typing, [d.groupId]: { ...(s.typing[d.groupId] ?? {}) } }; d.state === 'start' ? (t[d.groupId][d.userId] = d.name) : delete t[d.groupId][d.userId]; return { typing: t } })
    if (d.state === 'start') setTimeout(() => chat((s) => { const t = { ...s.typing, [d.groupId]: { ...(s.typing[d.groupId] ?? {}) } }; delete t[d.groupId][d.userId]; return { typing: t } }), 4000)
  })
  socket.on('presence', (d: { userId: string; online: boolean }) => chat((s) => { const p = new Set(s.presence); d.online ? p.add(d.userId) : p.delete(d.userId); return { presence: p } }))
  socket.on('group:changed', (d: { groupId: string; announceOnly?: boolean; slowModeSeconds?: number }) => { if (roomOf(d.groupId)) get().open(d.groupId); useAuth.getState().refreshMe() })
  socket.on('membership:changed', (d: { groupId: string; action: string; name: string }) => {
    useAuth.getState().refreshMe()
    const text = d.action === 'joined' ? `You were added to ${d.name}` : d.action === 'left' ? `You no longer have access to ${d.name}` : `${d.name} was archived`
    useUi.getState().toast(text)
    if (d.action !== 'joined' && get().activeGroup === d.groupId) get().open(d.groupId)
  })
  socket.on('notification', (n: any) => {
    useUi.getState().pushNotice({ id: n.id, type: n.type, title: n.title, body: n.body, link: n.link, read: false, at: n.at })
    useUi.getState().toast(n.title)
  })
  socket.on('group:read', (d: { groupId: string }) => chat((s) => ({ unread: { ...s.unread, [d.groupId]: 0 } })))
  socket.on('account:suspended', (d: { reason?: string }) => { useAuth.getState().logout(); useAuth.setState({ suspended: { reason: d.reason, message: 'Your account was suspended.' } }) })
}
