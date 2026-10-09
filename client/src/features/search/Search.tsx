import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ShieldAlert } from 'lucide-react'
import { Loading, Page, PageHead, Avatar } from '../../components/ui'
import { emit } from '../../lib/socket'
import { useFetch } from '../../lib/useFetch'
import { useUi } from '../../store/ui'
import type { PersonCard } from '../../lib/types'

interface Result {
  query: string; scopes: Record<string, number>; excluded: number
  people: (PersonCard & { restricted?: boolean; restriction?: string; email?: string; route?: { type: string; userId?: string; label?: string; message?: string; deskLabel?: string; deskSlug?: string }; dm?: { allowed: boolean } })[]
  circulars: { id: string; refNo?: string; title: string; scope?: string; snippet: string; createdAt: string; acknowledged: boolean; officeLabel?: string }[]
  channels: { id: string; title: string; channel?: string; slug?: string; snippet: string }[]
  tickets: { id: string; code: string; subject: string; status: string }[]
  groups: { id: string; name: string; kind: string }[]
  messages: { id: string; groupId: string; snippet: string; sender?: string; at: string }[]
}

export default function Search() {
  const [sp, setSp] = useSearchParams()
  const q = sp.get('q') ?? ''
  const scope = sp.get('scope') ?? 'all'
  const nav = useNavigate()
  const toast = useUi((s) => s.toast)
  const { data, loading } = useFetch<Result>(q ? `/search?q=${encodeURIComponent(q)}&scope=${scope}` : null, [q, scope])
  async function dm(userId: string) { const r = await emit('dm:open', { userId }); r.ok ? nav(`/g/${r.data.groupId}`) : toast(r.meta?.route?.message ?? 'Not allowed.', 'error') }
  const tabs: [string, string][] = [['all', 'All'], ['faculty', 'Faculty'], ['circulars', 'Circulars'], ['channels', 'Channels'], ['helpDesk', 'Help desk'], ['messages', 'Messages']]
  return (
    <Page narrow>
      <PageHead title={q ? `Results for “${q}”` : 'Search'} sub="You only see what you have access to." />
      <div className="tabs">{tabs.map(([id, label]) => <button key={id} aria-selected={scope === id} onClick={() => setSp({ q, scope: id })}>{label}{data && data.scopes[id] != null && <span className="count">{data.scopes[id]}</span>}</button>)}</div>
      {loading && !data ? <Loading /> : data && (
        <div className="stack" style={{ gap: 24 }}>
          {data.excluded > 0 && <div className="alert"><ShieldAlert size={16} strokeWidth={1.5} />{data.excluded} other result{data.excluded > 1 ? 's' : ''} match but sit outside your access, so they are hidden.</div>}
          {data.people.length > 0 && <section><h2 className="aside__label" style={{ marginBottom: 8 }}>People</h2><div className="stack">{data.people.map((p) => (
            <div className="card" key={p.id}><div className="card__body">
              <div className="row"><Avatar name={p.name} initials={p.initials} dept={p.dept} /><div style={{ flex: 1 }}><b>{p.name}</b> {p.badges.map((b) => <span className="badge" key={b} style={{ marginLeft: 4 }}>{b}</span>)}<div className="muted" style={{ fontSize: 13 }}><span className="mono">{p.uid}</span>{p.designation ? ` · ${p.designation}` : ''}{p.cabin ? ` · ${p.cabin}` : ''}</div></div>
                {p.restriction && <span className="badge">{p.restriction}</span>}
                {p.dm?.allowed && <button className="btn btn--primary btn--sm" onClick={() => dm(p.id)}>Message</button>}</div>
              {p.restricted && !p.restriction && <div className="alert">Direct messages are not allowed with this person. {p.route?.message ?? ''}
                <div className="row" style={{ marginLeft: 'auto' }}>{p.route?.type === 'CR' && p.route.userId && <button className="btn btn--primary btn--sm" onClick={() => dm(p.route!.userId!)}>{p.route.label ?? 'Message your CR'}</button>}<Link className="btn btn--secondary btn--sm" to="/desks/cs-coordinator">File an inquiry at the desk</Link></div></div>}
            </div></div>))}</div></section>}
          {data.circulars.length > 0 && <section><h2 className="aside__label" style={{ marginBottom: 8 }}>Circulars</h2><div className="stack">{data.circulars.map((c) => <Link key={c.id} to={`/board/${c.id}`} className="card"><div className="card__body"><span className="mono muted" style={{ fontSize: 12 }}>{c.refNo ?? c.officeLabel} · {new Date(c.createdAt).toLocaleDateString('en-GB')}</span><b style={{ fontFamily: 'var(--font-serif)', fontSize: 17 }}>{c.title}</b><span className="muted" style={{ fontSize: 13 }}>{c.snippet}</span></div></Link>)}</div></section>}
          {data.channels.length > 0 && <section><h2 className="aside__label" style={{ marginBottom: 8 }}>Channel posts</h2><div className="stack">{data.channels.map((c) => <Link key={c.id} to={`/channels/${c.slug}`} className="card"><div className="card__body"><span className="mono muted" style={{ fontSize: 12 }}>★ {c.channel}</span><b>{c.title}</b></div></Link>)}</div></section>}
          {data.groups.length > 0 && <section><h2 className="aside__label" style={{ marginBottom: 8 }}>Groups</h2><div className="stack">{data.groups.map((g) => <Link key={g.id} to={`/g/${g.id}`} className="card"><div className="card__body"><b># {g.name}</b></div></Link>)}</div></section>}
          {data.messages.length > 0 && <section><h2 className="aside__label" style={{ marginBottom: 8 }}>Messages</h2><div className="stack">{data.messages.map((m) => <Link key={m.id} to={`/g/${m.groupId}`} className="card"><div className="card__body"><span className="mono muted" style={{ fontSize: 12 }}>{m.sender}</span><span>{m.snippet}</span></div></Link>)}</div></section>}
          {data.tickets.length > 0 && <section><h2 className="aside__label" style={{ marginBottom: 8 }}>Your tickets</h2><div className="stack">{data.tickets.map((t) => <Link key={t.id} to={`/tickets/${t.id}`} className="card"><div className="card__body"><span className="mono">{t.code}</span><b>{t.subject}</b></div></Link>)}</div></section>}
          {data.scopes.all === 0 && <p className="muted">No results you have access to.</p>}
        </div>
      )}
    </Page>
  )
}
