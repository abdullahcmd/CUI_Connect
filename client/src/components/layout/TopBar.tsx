import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Bell, Menu, Search } from 'lucide-react'
import { useAuth } from '../../store/auth'
import { useUi } from '../../store/ui'
import { useClickAway } from './useClickAway'
import { ago } from '../../lib/format'

export default function TopBar({ onMenu }: { onMenu: () => void }) {
  const me = useAuth((s) => s.me)!
  const { notices, unread, loadNotices, markAllRead } = useUi()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const nav = useNavigate()
  const ref = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  useClickAway(ref, () => setOpen(false))
  useEffect(() => { loadNotices() }, [loadNotices])
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); input.current?.focus() } }
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h)
  }, [])
  return (
    <header className="topbar">
      <button className="btn btn--icon topbar__menu" aria-label="Open navigation" onClick={onMenu}><Menu size={20} strokeWidth={1.5} /></button>
      <form className="topbar__search" onSubmit={(e) => { e.preventDefault(); if (q.trim()) nav(`/search?q=${encodeURIComponent(q.trim())}`) }} role="search">
        <Search size={16} strokeWidth={1.5} />
        <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people, groups, circulars" aria-label="Search" />
        <kbd>Ctrl K</kbd>
      </form>
      <div className="topbar__right">
        {me.sidebar.term && <span className="topbar__chip">{me.sidebar.term.code}</span>}
        <div className="topbar__bell" ref={ref} style={{ position: 'relative' }}>
          <button className="btn btn--icon" aria-label="Notifications" onClick={() => { setOpen((o) => !o); loadNotices() }}><Bell size={18} strokeWidth={1.5} />{unread > 0 && <span className="rail__dot">{unread > 9 ? '9+' : unread}</span>}</button>
          {open && (
            <div className="menu notices">
              <div className="notices__head">Notifications {unread > 0 && <button className="btn btn--quiet" style={{ fontSize: 12 }} onClick={markAllRead}>Mark all read</button>}</div>
              {notices.length === 0 && <div className="notice">Nothing yet.</div>}
              {notices.slice(0, 20).map((n) => (
                <Link key={n.id} to={n.link ?? '/activity'} className="notice" data-unread={!n.read} onClick={() => setOpen(false)}>{n.title}{n.body && <span style={{ color: 'var(--ink-3)' }}> — {n.body.slice(0, 80)}</span>}<small>{ago(n.at)}</small></Link>
              ))}
              <Link to="/activity" className="notice" style={{ textAlign: 'center', color: 'var(--primary)' }} onClick={() => setOpen(false)}>See all activity</Link>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
