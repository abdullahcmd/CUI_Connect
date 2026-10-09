import { create } from 'zustand'
import { api, ApiError, getTokens, setTokens } from '../lib/api'
import { socket } from '../lib/socket'
import type { Me } from '../lib/types'

type Status = 'loading' | 'anon' | 'activation' | 'authed'
interface AuthState {
  status: Status
  me: Me | null
  suspended: { reason?: string; message?: string } | null
  boot: () => Promise<void>
  login: (uid: string, password: string) => Promise<Status>
  refreshMe: () => Promise<void>
  logout: (opts?: { expired?: boolean }) => Promise<void>
  expired: boolean
}

export const useAuth = create<AuthState>((set) => ({
  status: 'loading', me: null, suspended: null, expired: false,

  async boot() {
    if (!getTokens()) return set({ status: 'anon' })
    try {
      const me = await api.get<Me>('/me')
      set({ me, status: me.user.mustChangePassword ? 'activation' : 'authed' })
    } catch (e) {
      if (e instanceof ApiError && e.code === 'ACCOUNT_SUSPENDED') { setTokens(null); return set({ status: 'anon', suspended: { reason: e.meta.reason, message: e.message } }) }
      setTokens(null); set({ status: 'anon' })
    }
  },

  async login(uid, password) {
    const r = await api.post<{ accessToken: string; refreshToken: string; mustChangePassword: boolean }>('/auth/login', { uid, password })
    setTokens({ accessToken: r.accessToken, refreshToken: r.refreshToken })
    const me = await api.get<Me>('/me')
    const status: Status = r.mustChangePassword ? 'activation' : 'authed'
    set({ me, status, suspended: null, expired: false })
    return status
  },

  async refreshMe() {
    try { set({ me: await api.get<Me>('/me') }) } catch { /* keep the last good copy */ }
  },

  async logout(opts) {
    const t = getTokens()
    if (t) api.post('/auth/logout', { refreshToken: t.refreshToken }).catch(() => {})
    socket.disconnect(); setTokens(null)
    set({ me: null, status: 'anon', expired: !!opts?.expired })
  },
}))

// global session events from the API layer and the socket
window.addEventListener('auth:expired', () => useAuth.getState().logout({ expired: true }))
window.addEventListener('auth:suspended', ((e: CustomEvent) => { useAuth.getState().logout(); useAuth.setState({ suspended: { reason: e.detail?.meta?.reason, message: e.detail?.message } }) }) as EventListener)
