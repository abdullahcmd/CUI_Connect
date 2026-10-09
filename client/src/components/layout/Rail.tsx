import { useRef, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { AtSign, Bell, Home, LogOut, ScrollText, Settings } from 'lucide-react'
import logo from '../../assets/img/cui-logo.png'
import { Avatar } from '../ui'
import { useAuth } from '../../store/auth'
import { useChat } from '../../store/chat'
import { useClickAway } from './useClickAway'

export default function Rail() {
  const me = useAuth((s) => s.me)!
  const logout = useAuth((s) => s.logout)
  const unread = useChat((s) => s.unread)
  const nav = useNavigate()
  const [menu, setMenu] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useClickAway(ref, () => setMenu(false))
  const dms = me.sidebar.directMessages.reduce((n, d) => n + (unread[d.id] ?? 0), 0)
  const item = (to: string, icon: React.ReactElement, label: string, badge = 0) => (
    <NavLink to={to} end={to === '/home'} className="rail__btn" aria-label={label} title={label}>{icon}{badge > 0 && <span className="rail__dot">{badge > 9 ? '9+' : badge}</span>}</NavLink>
  )
  return (
    <aside className="rail">
      <div className="rail__logo"><img src={logo} alt="CUI Connect" /></div>
      <nav className="rail__nav" aria-label="Workspace">
        {item('/home', <Home size={20} strokeWidth={1.5} />, 'Home')}
        {item('/dm', <AtSign size={20} strokeWidth={1.5} />, 'Direct messages', dms)}
        {item('/board', <ScrollText size={20} strokeWidth={1.5} />, 'Announcements', me.sidebar.announcements.unread)}
        {item('/activity', <Bell size={20} strokeWidth={1.5} />, 'Activity')}
      </nav>
      <div className="rail__btn" style={{ marginBottom: 8 }}>{item('/settings', <Settings size={20} strokeWidth={1.5} />, 'Settings')}</div>
      <div className="rail__profile" ref={ref}>
        <button onClick={() => setMenu((m) => !m)} aria-label="Account menu"><Avatar name={me.user.name} initials={me.user.initials} dept={me.user.dept} online /></button>
        {menu && (
          <div className="menu" style={{ left: 56, bottom: 0 }}>
            <div style={{ padding: '8px 12px' }}><b style={{ font: '600 14px/20px var(--font-sans)' }}>{me.user.name}</b><div className="mono" style={{ fontSize: 12, color: 'var(--ink-3)' }}>{me.user.uid}</div></div>
            <div className="menu__sep" />
            <button className="menu__item" onClick={() => { setMenu(false); nav('/settings') }}><Settings size={16} strokeWidth={1.5} /> Settings</button>
            <button className="menu__item menu__item--danger" onClick={() => logout()}><LogOut size={16} strokeWidth={1.5} /> Sign out</button>
          </div>
        )}
      </div>
    </aside>
  )
}
