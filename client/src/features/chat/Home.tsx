import { Link } from 'react-router-dom'
import { Avatar } from '../../components/ui'
import { useAuth } from '../../store/auth'
import { useChat } from '../../store/chat'
import { useUi } from '../../store/ui'
import { ago } from '../../lib/format'
import './chat.css'

export default function Home() {
  const me = useAuth((s) => s.me)!
  const unread = useChat((s) => s.unread)
  const notices = useUi((s) => s.notices)
  const sb = me.sidebar
  const all = [...sb.roleGroups, ...sb.classes, ...sb.crLines, ...sb.customGroups, ...sb.directMessages]
  const busy = all.filter((g) => unread[g.id]).sort((a, b) => unread[b.id] - unread[a.id])
  const recent = all.filter((g) => !unread[g.id] && g.lastMessageAt).sort((a, b) => +new Date(b.lastMessageAt!) - +new Date(a.lastMessageAt!)).slice(0, 5)
  return (
    <div className="home">
      <h1>{me.user.name}</h1>
      <p className="home__sub">{me.roles.filter((r) => r.role !== 'STUDENT').map((r) => r.label + (r.orgUnit ? ` · ${r.orgUnit}` : '')).join(' · ') || `Student · ${me.user.batch?.code ?? ''}`}</p>
      <div className="home__grid">
        <section className="home__card">
          <h2>Unread</h2>
          {busy.length === 0 && <div className="home__row" style={{ color: 'var(--ink-3)' }}>You're all caught up.</div>}
          {busy.map((g) => <Link key={g.id} className="home__row" to={`/g/${g.id}`}><span className="mono" style={{ color: 'var(--ink-3)' }}>{g.glyph ?? '#'}</span><span style={{ flex: 1 }}>{g.code ?? g.name}</span><span className="side-item__count">{unread[g.id]}</span></Link>)}
          {recent.length > 0 && <h2 style={{ borderTop: '1px solid var(--rule)' }}>Recent</h2>}
          {recent.map((g) => <Link key={g.id} className="home__row" to={`/g/${g.id}`}><span className="mono" style={{ color: 'var(--ink-3)' }}>{g.glyph ?? '#'}</span><span style={{ flex: 1 }}>{g.code ?? g.name}</span><span className="mono" style={{ color: 'var(--ink-3)', fontSize: 12 }}>{ago(g.lastMessageAt!)}</span></Link>)}
        </section>
        <section className="home__card">
          <h2>Activity</h2>
          {notices.length === 0 && <div className="home__row" style={{ color: 'var(--ink-3)' }}>Nothing yet.</div>}
          {notices.slice(0, 7).map((n) => <Link key={n.id} className="home__row" to={n.link ?? '/activity'}><span style={{ flex: 1 }}>{n.title}</span><span className="mono" style={{ color: 'var(--ink-3)', fontSize: 12 }}>{ago(n.at)}</span></Link>)}
        </section>
      </div>
      <button className="btn btn--primary" style={{ marginTop: 24 }} onClick={() => window.dispatchEvent(new Event('ui:new-dm'))}>New message</button>
    </div>
  )
}

export function DmIndex() {
  const me = useAuth((s) => s.me)!
  const unread = useChat((s) => s.unread)
  const online = useChat((s) => s.presence)
  return (
    <div className="home">
      <h1>Direct messages</h1>
      <p className="home__sub">One-to-one conversations. People outside the messaging rules are routed to the right place.</p>
      <section className="home__card">
        {me.sidebar.directMessages.length === 0 && <div className="home__row" style={{ color: 'var(--ink-3)' }}>No conversations yet.</div>}
        {me.sidebar.directMessages.map((d) => <Link key={d.id} className="home__row" to={`/g/${d.id}`}><Avatar name={d.name} initials={d.peer?.initials} dept={d.peer?.dept} online={d.peer ? online.has(d.peer.id) : false} /><span style={{ flex: 1 }}>{d.name}</span>{!!unread[d.id] && <span className="side-item__count">{unread[d.id]}</span>}</Link>)}
      </section>
      <button className="btn btn--primary" style={{ marginTop: 24 }} onClick={() => window.dispatchEvent(new Event('ui:new-dm'))}>New message</button>
    </div>
  )
}

export function Pending({ what }: { what: string }) {
  return (
    <div className="state"><h2>{what}</h2><p>This area is part of the next build step. Everything in the sidebar's groups, classes, CR lines and direct messages is live now.</p><Link to="/home" className="btn btn--secondary">Go home</Link></div>
  )
}
