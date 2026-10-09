/** Thin fetch client: bearer token, one-shot refresh on 401, errors carry the server's code + a ready-to-show sentence. */
export class ApiError extends Error {
  code: string; status: number; meta: Record<string, any>
  constructor(code: string, status: number, message: string, meta: Record<string, any> = {}) { super(message); this.code = code; this.status = status; this.meta = meta }
}

const KEY = 'cui.tokens'
interface Tokens { accessToken: string; refreshToken: string }
let tokens: Tokens | null = (() => { try { return JSON.parse(localStorage.getItem(KEY) ?? 'null') } catch { return null } })()

export const getTokens = () => tokens
export function setTokens(t: Tokens | null) {
  tokens = t
  try { t ? localStorage.setItem(KEY, JSON.stringify(t)) : localStorage.removeItem(KEY) } catch { /* private mode */ }
}
const expSoon = (jwt: string) => { try { return JSON.parse(atob(jwt.split('.')[1])).exp * 1000 - Date.now() < 30_000 } catch { return true } }

let refreshing: Promise<boolean> | null = null
export function refreshTokens(): Promise<boolean> {
  if (!tokens?.refreshToken) return Promise.resolve(false)
  refreshing ??= fetch('/api/auth/refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken: tokens.refreshToken }) })
    .then(async (r) => { if (!r.ok) return false; setTokens(await r.json()); return true })
    .catch(() => false)
    .finally(() => { refreshing = null })
  return refreshing
}

/** Access token for sockets and file links; refreshes first when it is about to expire. */
export async function freshAccessToken(): Promise<string | null> {
  if (tokens && expSoon(tokens.accessToken)) await refreshTokens()
  return tokens?.accessToken ?? null
}

async function request<T>(method: string, path: string, body?: unknown, retried = false): Promise<T> {
  const headers: Record<string, string> = {}
  const isForm = body instanceof FormData
  if (body !== undefined && !isForm) headers['content-type'] = 'application/json'
  if (tokens) headers.authorization = `Bearer ${tokens.accessToken}`
  const res = await fetch(`/api${path}`, { method, headers, body: body === undefined ? undefined : isForm ? body : JSON.stringify(body) })
  if (res.status === 401 && !retried && tokens && !path.startsWith('/auth/')) {
    if (await refreshTokens()) return request<T>(method, path, body, true)
    window.dispatchEvent(new Event('auth:expired'))
  }
  const ct = res.headers.get('content-type') ?? ''
  const data = ct.includes('json') ? await res.json() : await res.text()
  if (!res.ok) {
    const d = (data ?? {}) as any
    if (d.code === 'ACCOUNT_SUSPENDED' && tokens) window.dispatchEvent(new CustomEvent('auth:suspended', { detail: d }))
    throw new ApiError(d.code ?? 'SERVER_ERROR', res.status, d.message ?? 'Something went wrong. Try again.', d.meta)
  }
  return data as T
}

export const api = {
  get: <T>(p: string) => request<T>('GET', p),
  post: <T>(p: string, b?: unknown) => request<T>('POST', p, b ?? {}),
  put: <T>(p: string, b?: unknown) => request<T>('PUT', p, b ?? {}),
  patch: <T>(p: string, b?: unknown) => request<T>('PATCH', p, b ?? {}),
  del: <T>(p: string, b?: unknown) => request<T>('DELETE', p, b),
  upload: (files: File[]) => { const f = new FormData(); files.forEach((x) => f.append('files', x)); return request<{ files: import('./types').Attachment[] }>('POST', '/uploads', f) },
}

/** File links open in a new tab, so they carry the token in the query string. */
export const fileHref = (url: string) => (tokens ? `${url}?token=${tokens.accessToken}` : url)
