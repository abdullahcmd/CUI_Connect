import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { ChevronDown, ChevronRight, Plus } from 'lucide-react'
import { useAuth } from '../../store/auth'
import { useChat } from '../../store/chat'
import type { SidebarItem } from '../../lib/types'

function Section({ label, children, onAdd, addLabel }: { label: string; children: React.ReactNode; onAdd?: () => void; addLabel?: string }) {
  const [open, setOpen] = useState(true)
  return (
    <section>
      <div className="side-sec__head">
        <button onClick={() => setOpen((o) => !o)} aria-expanded={open}>{open ? <ChevronDown size={12} /> : <ChevronRight size={12} />} {label}</button>
        {onAdd && <button className="plus" onClick={onAdd} aria-label={addLabel}><Plus size={14} /></button>}
      </div>
      {open && children}
    </section>
  )
}

function Row({ to, mark, name, code, unread, tag, presence }: { to: string; mark: string; name: string; code?: boolean; unread?: number; tag?: string; presence?: boolean }) {
  return (
    <NavLink to={to} className={({ isActive }) => `side-item ${isActive ? 'active' : ''} ${unread ? 'side-item--unread' : ''}`}>
      {presence === undefined ? <span className="side-item__mark" aria-hidden>{mark}</span> : <span className="side-item__presence" data-on={presence} aria-hidden />}
      <span className={`side-item__name ${code ? 'side-item__code' : ''}`}>{name}</span>
      {tag && <span className="side-item__tag">{tag}</span>}
      {!!unread && <span className="side-item__count" aria-label={`${unread} unread`}>{unread}</span>}
    </NavLink>
  )
}

export default function Sidebar({ onNewDm, onNewGroup }: { onNewDm: () => void; onNewGroup: () => void }) {
  const me = useAuth((s) => s.me)!
  const unread = useChat((s) => s.unread)
  const online = useChat((s) => s.presence)
  const sb = me.sidebar
  const caps = me.capabilities
  const u = (i: SidebarItem) => unread[i.id] ?? 0
  const group = (i: SidebarItem, mark = '#', code = false) => <Row key={i.id} to={`/g/${i.id}`} mark={i.restricted && i.kind === 'CR_LINE' ? '#' : mark} name={code && i.code ? i.code : i.name} code={code} unread={u(i)} tag={i.kind === 'CR_LINE' ? 'CR' : undefined} />

  return (
    <aside className="sidebar">
      <header className="sidebar__head">
        <div className="sidebar__title"><span>CUI Connect</span>{sb.term && <span className="side-item__code sidebar__term">{sb.term.code}</span>}</div>
        <span className="sidebar__sub">Islamabad{me.user.department ? ` · ${me.user.department.code}` : ''}</span>
      </header>
      <nav className="sidebar__nav" aria-label="Places">
        <NavLink to="/board" className={({ isActive }) => `side-item ${isActive ? 'active' : ''} ${sb.announcements.unread ? 'side-item--unread' : ''}`}>
          <span className="side-item__mark">§</span><span className="side-item__name">Announcements</span>{!!sb.announcements.unread && <span className="side-item__count">{sb.announcements.unread}</span>}
        </NavLink>
        {sb.roleGroups.length > 0 && <Section label="Role groups">{sb.roleGroups.map((g) => group(g))}</Section>}
        {sb.classes.length > 0 && <Section label="Classes">{sb.classes.map((g) => group(g, '#', true))}</Section>}
        {sb.crLines.length > 0 && <Section label="CR lines">{sb.crLines.map((g) => group(g, '#', true))}</Section>}
        <Section label="Groups" onAdd={onNewGroup} addLabel="Create a group">
          {sb.customGroups.map((g) => group(g))}
          {sb.customGroups.length === 0 && <div className="side-item" style={{ opacity: 0.7 }}>No groups yet</div>}
        </Section>
        <Section label="Channels">
          {sb.channels.map((c) => <Row key={c.id} to={`/channels/${c.slug}`} mark="★" name={c.name} unread={c.unread} />)}
          <NavLink to="/channels" end className="side-item"><span className="side-item__mark" /><span className="side-item__name">Browse channels</span></NavLink>
        </Section>
        {sb.desks.length > 0 && <Section label="Desks">{sb.desks.map((d) => <Row key={d.id} to={d.mode === 'agent' ? `/desks/${d.slug}/queue` : `/desks/${d.slug}`} mark="◇" name={d.name} unread={d.mode === 'agent' ? d.open : 0} />)}</Section>}
        <Section label="Direct messages" onAdd={onNewDm} addLabel="New message">
          {sb.directMessages.map((d) => <Row key={d.id} to={`/g/${d.id}`} mark="@" name={d.name} unread={u(d)} presence={d.peer ? online.has(d.peer.id) : false} />)}
        </Section>
        {(caps.admin || caps.dept || caps.reports || caps.examCell || caps.publishBoard || caps.moderateChannels) && (
          <Section label="Manage">
            {caps.admin && <Row to="/admin/dashboard" mark="⚙" name="Admin console" />}
            {caps.dept && <Row to="/dept/dashboard" mark="▦" name="Department" />}
            {caps.examCell && <Row to="/exam" mark="§" name="Examination Cell" />}
            {caps.reports && <Row to="/reports" mark="⚑" name="Reports" />}
            {caps.moderateChannels && <Row to="/channels/moderation" mark="★" name="Channel approvals" />}
          </Section>
        )}
      </nav>
    </aside>
  )
}
