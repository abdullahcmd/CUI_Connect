import { create } from 'zustand'
import type { Notice } from '../lib/types'
import { api } from '../lib/api'

interface Toast { id: number; text: string; tone?: 'error' | 'info'; action?: { label: string; to: string } }
interface UiState {
  toasts: Toast[]
  toast: (text: string, tone?: Toast['tone'], action?: Toast['action']) => void
  dismiss: (id: number) => void
  notices: Notice[]; unread: number
  loadNotices: () => Promise<void>
  pushNotice: (n: Notice) => void
  markAllRead: () => Promise<void>
  online: boolean; setOnline: (v: boolean) => void
  detailsOpen: boolean; toggleDetails: () => void
}
let n = 1
export const useUi = create<UiState>((set, get) => ({
  toasts: [],
  toast(text, tone = 'info', action) { const id = n++; set((s) => ({ toasts: [...s.toasts, { id, text, tone, action }] })); setTimeout(() => get().dismiss(id), 4500) },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  notices: [], unread: 0,
  async loadNotices() { const r = await api.get<{ items: Notice[]; unread: number }>('/notifications'); set({ notices: r.items, unread: r.unread }) },
  pushNotice: (nt) => set((s) => ({ notices: [nt, ...s.notices].slice(0, 100), unread: s.unread + 1 })),
  async markAllRead() { await api.post('/notifications/read'); set((s) => ({ unread: 0, notices: s.notices.map((x) => ({ ...x, read: true })) })) },
  online: true, setOnline: (v) => set({ online: v }),
  detailsOpen: typeof window !== 'undefined' && window.innerWidth >= 1280, toggleDetails: () => set((s) => ({ detailsOpen: !s.detailsOpen })),
}))
