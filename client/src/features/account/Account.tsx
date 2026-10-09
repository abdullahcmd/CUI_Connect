import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Alert, Avatar, Button, Field, Loading, Page, PageHead, Tabs } from '../../components/ui'
import { api } from '../../lib/api'
import { useFetch } from '../../lib/useFetch'
import { useAuth } from '../../store/auth'
import { useUi } from '../../store/ui'
import { ago } from '../../lib/format'
import { passwordRules } from '../auth/Activate'
import type { Notice, PersonCard } from '../../lib/types'

export function Activity() {
  const { notices, loadNotices, markAllRead } = useUi()
  useEffect(() => { loadNotices() }, [loadNotices])
  return (
    <Page narrow><PageHead title="Activity" sub="Mentions, replies, relays, ticket updates and approvals." actions={<Button onClick={markAllRead}>Mark all read</Button>} />
      <div className="card">{notices.map((n: Notice) => <Link key={n.id} to={n.link ?? '/home'} className="home__row" style={{ background: n.read ? undefined : 'var(--select)' }}><span style={{ flex: 1 }}>{n.title}{n.body && <span className="muted"> — {n.body.slice(0, 120)}</span>}</span><span className="mono muted" style={{ fontSize: 12 }}>{ago(n.at)}</span></Link>)}{notices.length === 0 && <div className="home__row muted">Nothing yet.</div>}</div>
    </Page>
  )
}

const SECTIONS = [['board', 'Announcements', true], ['dm', 'Direct messages'], ['groups', 'Groups and classes'], ['channels', 'Channels'], ['escalations', 'Tickets and escalations', true]] as const

export default function Settings() {
  const me = useAuth((s) => s.me)!
  const [tab, setTab] = useState<'profile' | 'notifications' | 'appearance' | 'security' | 'blocked' | 'saved'>('profile')
  return (
    <Page narrow><PageHead title="Settings" />
      <Tabs value={tab} onChange={setTab} items={[{ id: 'profile', label: 'Profile' }, { id: 'notifications', label: 'Notifications' }, { id: 'appearance', label: 'Appearance' }, { id: 'security', label: 'Security' }, { id: 'blocked', label: 'Blocked' }, { id: 'saved', label: 'Saved' }]} />
      {tab === 'profile' && (
        <div className="card"><div className="card__body">
          <div className="row"><Avatar size={40} name={me.user.name} initials={me.user.initials} dept={me.user.dept} /><div><b>{me.user.name}</b><div className="muted mono" style={{ fontSize: 12 }}>{me.user.uid}</div></div></div>
          <dl className="kv"><dt>Email</dt><dd>{me.user.email}</dd><dt>Department</dt><dd>{me.user.department?.name ?? '—'}</dd>{me.user.batch && <><dt>Batch</dt><dd className="mono">{me.user.batch.code}</dd></>}<dt>Roles</dt><dd>{me.roles.map((r) => `${r.label}${r.orgUnit ? ` (${r.orgUnit})` : ''}`).join(', ')}</dd></dl>
          <p className="field__help">ID, roles and department are set by the Admin Office and can't be edited here.</p>
        </div></div>)}
      {tab === 'notifications' && <NotificationPrefs />}
      {tab === 'appearance' && <Appearance />}
      {tab === 'security' && <Security />}
      {tab === 'blocked' && <Blocked />}
      {tab === 'saved' && <Saved />}
    </Page>
  )
}

function NotificationPrefs() {
  const me = useAuth((s) => s.me)!
  const toast = useUi((s) => s.toast)
  const cur = ((me.user.settings as any)?.notifications ?? {}) as Record<string, string>
  const [vals, setVals] = useState<Record<string, string>>(cur)
  async function set(section: string, mode: string) {
    try { await api.patch('/me/settings', { notifications: { [section]: mode } }); setVals((v) => ({ ...v, [section]: mode })); toast('Saved') } catch (e: any) { toast(e.meta?.reason ?? e.message, 'error') }
  }
  return (
    <div className="card"><div className="card__body">
      {SECTIONS.map(([id, label, locked]) => (
        <div className="row row--between" key={id}><span>{label}{locked && <span className="muted" style={{ fontSize: 12 }}> · can't be turned off</span>}</span>
          <select className="input" style={{ width: 160 }} value={vals[id] ?? 'all'} onChange={(e) => set(id, e.target.value)}><option value="all">Everything</option><option value="mentions">Mentions only</option>{!locked && <option value="off">Off</option>}</select></div>))}
    </div></div>
  )
}

function Appearance() {
  const me = useAuth((s) => s.me)!
  const s = me.user.settings as any
  const [theme, setTheme] = useState<string>(s?.theme ?? 'system')
  const [density, setDensity] = useState<string>(s?.density ?? 'default')
  const [lang, setLang] = useState<string>(s?.language ?? 'en')
  async function save(p: Record<string, string>) { await api.patch('/me/settings', p); applyTheme(p.theme ?? theme) }
  return (
    <div className="card"><div className="card__body">
      <div className="field"><span className="field__label">Theme</span><div className="seg">{['light', 'dark', 'system'].map((t) => <button key={t} aria-pressed={theme === t} onClick={() => { setTheme(t); save({ theme: t }) }}>{t[0].toUpperCase() + t.slice(1)}</button>)}</div></div>
      <div className="field"><span className="field__label">Density</span><div className="seg">{['default', 'compact'].map((t) => <button key={t} aria-pressed={density === t} onClick={() => { setDensity(t); save({ density: t }) }}>{t[0].toUpperCase() + t.slice(1)}<small>{t === 'compact' ? '32 px rows for long queues' : '40 px rows'}</small></button>)}</div></div>
      <div className="field"><span className="field__label">Language</span><div className="seg">{[['en', 'English'], ['ur', 'اردو']].map(([t, l]) => <button key={t} aria-pressed={lang === t} onClick={() => { setLang(t); save({ language: t }) }}>{l}</button>)}</div><span className="field__help">Messages written in Urdu always display right-to-left.</span></div>
    </div></div>
  )
}
export function applyTheme(t: string) {
  const dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
}

function Security() {
  const toast = useUi((s) => s.toast)
  const { data, reload } = useFetch<{ sessions: { id: string; device: string; ip: string; lastUsedAt: string }[]; recentLogins: { at: string; ip: string }[] }>('/auth/sessions')
  const me = useAuth((s) => s.me)!
  const [cur, setCur] = useState(''); const [pw, setPw] = useState(''); const [err, setErr] = useState<string | null>(null)
  const rules = passwordRules(pw, me.user.uid)
  async function change() { setErr(null); try { await api.post('/auth/change-password', { currentPassword: cur, newPassword: pw }); toast('Password changed'); setCur(''); setPw('') } catch (e: any) { setErr(e.meta?.reason ?? e.message) } }
  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="card"><div className="card__head">Change password</div><div className="card__body"><Field label="Current password" reveal value={cur} onChange={(e) => setCur(e.target.value)} /><Field label="New password" reveal value={pw} onChange={(e) => setPw(e.target.value)} help={rules.filter((r) => !r.ok).map((r) => r.text).join(' · ')} />{err && <Alert tone="error">{err}</Alert>}<div><Button variant="primary" disabled={!cur || !rules.every((r) => r.ok)} onClick={change}>Update password</Button></div></div></div>
      <div className="card"><div className="card__head">Active sessions<Button size="sm" onClick={async () => { await api.post('/auth/sessions/revoke-others', {}); reload(); toast('Other sessions signed out') }}>Sign out others</Button></div>
        {data?.sessions.map((s) => <div className="home__row" key={s.id}><span style={{ flex: 1 }}>{s.device.slice(0, 60) || 'Unknown device'}<div className="mono muted" style={{ fontSize: 12 }}>{s.ip} · {ago(s.lastUsedAt)} ago</div></span><Button size="sm" onClick={async () => { await api.del(`/auth/sessions/${s.id}`); reload() }}>Sign out</Button></div>)}</div>
    </div>
  )
}

function Blocked() {
  const { data, loading, reload } = useFetch<PersonCard[]>('/me/blocked')
  if (loading) return <Loading />
  return <div className="card">{data?.map((p) => <div className="home__row" key={p.id}><Avatar name={p.name} initials={p.initials} dept={p.dept} /><span style={{ flex: 1 }}>{p.name}</span><Button size="sm" onClick={async () => { await api.del(`/blocks/${p.id}`); reload() }}>Unblock</Button></div>)}{data?.length === 0 && <div className="home__row muted">You haven't blocked anyone. Blocking only stops direct messages; it never affects groups.</div>}</div>
}

function Saved() {
  const { data, loading } = useFetch<{ kind: string; id: string; title?: string; snippet?: string; groupId?: string }[]>('/me/saved')
  if (loading) return <Loading />
  return <div className="card">{data?.map((s) => <Link key={s.id} className="home__row" to={s.kind === 'message' ? `/g/${s.groupId}` : s.kind === 'announcement' ? `/board/${s.id}` : '/channels'}><span className="badge">{s.kind}</span><span style={{ flex: 1 }}>{s.title ?? s.snippet}</span></Link>)}{data?.length === 0 && <div className="home__row muted">Nothing saved yet.</div>}</div>
}
