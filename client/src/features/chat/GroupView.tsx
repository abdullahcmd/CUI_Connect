import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Info, Lock, X } from 'lucide-react'
import { Avatar, Button, Spinner } from '../../components/ui'
import { MessageRow, type RowCtx } from './MessageRow'
import { Composer } from './Composer'
import { RelayDialog, ReportDialog } from './dialogs'
import { useAuth } from '../../store/auth'
import { useChat } from '../../store/chat'
import { useUi } from '../../store/ui'
import { fmtDay } from '../../lib/format'
import type { GroupSummary, Message } from '../../lib/types'
import './chat.css'

const EMPTY: Message[] = []

export default function GroupView() {
  const { groupId = '' } = useParams()
  const me = useAuth((s) => s.me)!
  const room = useChat((s) => s.rooms[groupId])
  const typing = useChat((s) => s.typing[groupId])
  const { open, setActive, loadOlder, openThread, threadFor, markRead } = useChat()
  const { detailsOpen, toggleDetails } = useUi()
  const [relay, setRelay] = useState<Message | null>(null)
  const [report, setReport] = useState<Message | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  useEffect(() => { setActive(groupId); open(groupId); return () => setActive(null) }, [groupId, open, setActive])
  useEffect(() => { const h = () => document.visibilityState === 'visible' && markRead(groupId); document.addEventListener('visibilitychange', h); return () => document.removeEventListener('visibilitychange', h) }, [groupId, markRead])

  const messages = room?.messages ?? EMPTY
  const summary = room?.summary
  useLayoutEffect(() => { const el = scroller.current; if (el && stick.current) el.scrollTop = el.scrollHeight }, [messages.length, groupId, room?.loading])
  const onScroll = () => { const el = scroller.current!; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120 }

  const ctx: RowCtx | null = useMemo(() => summary ? ({
    meId: me.user.id, managers: new Set(summary.managers.map((m) => m.id)), groupId,
    canRelay: me.capabilities.relay && summary.group.kind === 'CR_LINE' && !!summary.relayTarget, isModerator: summary.me.isModerator,
    onRelay: setRelay, onReport: setReport, onThread: (m) => { openThread(m) },
  }) : null, [summary, me, groupId, openThread])

  if (room?.error) return <Blocked err={room.error} />
  if (!summary || !ctx) return <div className="state"><Spinner /></div>

  const dmItem = me.sidebar.directMessages.find((d) => d.id === groupId)
  const title = dmItem ? dmItem.name : summary.group.name
  const g = summary.group
  const rows: React.ReactNode[] = []
  let prev: Message | null = null
  for (const m of messages) {
    const newDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString()
    if (newDay) rows.push(<div key={`d-${m.id}`} className="day">{fmtDay(m.createdAt)}</div>)
    const first = newDay || !prev || prev.sender.id !== m.sender.id || +new Date(m.createdAt) - +new Date(prev.createdAt) > 5 * 60_000 || prev.deleted || m.relayOf !== undefined || prev.kind !== m.kind
    rows.push(<MessageRow key={m.id} m={m} first={first} ctx={ctx} />)
    prev = m
  }
  const names = Object.values(typing ?? {})

  return (
    <div className="group">
      <div className="group__col">
        <header className="group__head">
          <div>
            <h1 className="group__title">
              {dmItem ? <Avatar name={title} initials={dmItem.peer?.initials} dept={dmItem.peer?.dept} /> : <span aria-hidden>{g.restricted && g.kind === 'CR_LINE' ? '#' : g.glyph ?? '#'}</span>}
              <span className={g.kind === 'CLASS' || g.kind === 'CR_LINE' ? 'code' : ''}>{title}</span>
              {g.restricted && <span title="Restricted access"><Lock size={14} strokeWidth={1.5} color="var(--ink-3)" /></span>}
              {g.announceOnly && <span className="badge badge--official">Announce-only</span>}
              {g.archived && <span className="badge">Archived</span>}
            </h1>
            <p className="group__meta">{metaLine(summary)}</p>
          </div>
          <div className="group__tools">
            {summary.crLine && me.user.kind === 'STUDENT' && <Link className="btn btn--secondary btn--sm" to={`/g/${summary.crLine.id}`}>CR line</Link>}
            <Button variant="icon" aria-label="Toggle details" onClick={toggleDetails}><Info size={18} strokeWidth={1.5} /></Button>
          </div>
        </header>

        <div className="msgs" ref={scroller} onScroll={onScroll} role="log" aria-live="polite" aria-label={`Messages in ${title}`}>
          {room.hasMore && <div className="msgs__older"><Button size="sm" onClick={() => loadOlder(groupId)}>Load earlier messages</Button></div>}
          {rows}
          {messages.length === 0 && !room.loading && <div className="empty">No messages yet. Start with a question for {g.kind === 'CLASS' ? 'your class' : 'the group'}.</div>}
        </div>
        <div className="typing" aria-live="polite">{names.length > 0 && `${names.slice(0, 2).join(' and ')} ${names.length > 1 ? 'are' : 'is'} typing…`}</div>
        <Composer groupId={groupId} name={dmItem ? title : g.name} state={summary.composer} />
      </div>

      {threadFor && threadFor.groupId === groupId
        ? <ThreadPanel parent={threadFor} ctx={ctx} composer={summary.composer} onClose={() => openThread(null)} />
        : detailsOpen && <Details s={summary} dm={!!dmItem} />}
      {relay && summary.relayTarget && <RelayDialog message={relay} target={summary.relayTarget} onClose={() => setRelay(null)} />}
      {report && <ReportDialog message={report} onClose={() => setReport(null)} />}
    </div>
  )
}

function metaLine(s: GroupSummary) {
  const g = s.group
  const mgr = s.managers[0]
  if (g.kind === 'CLASS') return `Class group · ${s.studentCount ?? g.memberCount} students${s.crs?.length ? ` · CR: ${s.crs.map((c) => c.name).join(', ')}` : ' · No CR assigned yet'}`
  if (g.kind === 'CR_LINE') return `${s.faculty?.length ?? 0} courses · ${s.crs?.length ?? 0} CRs · restricted line between faculty and CRs`
  if (g.kind === 'DIRECT') return 'Direct message'
  return `${g.memberCount} members${mgr ? ` · Managed by ${mgr.name} (${mgr.badges[0] ?? 'manager'})` : ''}`
}

function Blocked({ err }: { err: { code: string; message: string; meta?: any } }) {
  const me = useAuth((s) => s.me)!
  const crLine = err.meta?.route?.type === 'CR_LINE' ? me.sidebar.crLines[0] : null
  return (
    <div className="state">
      <h2>{err.code === 'NOT_FOUND' ? "This group doesn't exist" : "You don't have access to this group"}</h2>
      <p>{err.message}</p>
      {crLine && <Link className="btn btn--primary" to={`/g/${crLine.id}`}>Open CR line →</Link>}
      {!crLine && <Link className="btn btn--secondary" to="/home">Go home</Link>}
    </div>
  )
}

function ThreadPanel({ parent, ctx, composer, onClose }: { parent: Message; ctx: RowCtx; composer: GroupSummary['composer']; onClose: () => void }) {
  const replies = useChat((s) => s.threads[parent.id]) ?? EMPTY
  const tctx = { ...ctx, inThread: true }
  return (
    <aside className="panel" aria-label="Thread">
      <div className="panel__head">Thread<Button variant="icon" aria-label="Close thread" onClick={onClose}><X size={16} /></Button></div>
      <div style={{ borderBottom: '1px solid var(--rule)' }}><MessageRow m={parent} first ctx={tctx} /></div>
      <div style={{ flex: 1 }}>{replies.map((m, i) => <MessageRow key={m.id} m={m} first={i === 0 || replies[i - 1].sender.id !== m.sender.id} ctx={tctx} />)}</div>
      <Composer groupId={parent.groupId!} name="thread" state={composer} threadOf={parent.id} placeholder="Reply…" />
    </aside>
  )
}

function Person({ p, sub }: { p: { name: string; initials: string; dept?: string; badges: string[]; uid: string }; sub?: string }) {
  return <div className="person"><Avatar name={p.name} initials={p.initials} dept={p.dept} /><div><b>{p.name}</b><small>{sub ?? p.uid}</small></div></div>
}

function Details({ s, dm }: { s: GroupSummary; dm: boolean }) {
  const g = s.group
  return (
    <aside className="panel" aria-label="Details">
      <div className="panel__head">Details</div>
      {g.description && !dm && <div className="panel__sec"><span className="panel__label">About</span><p>{g.mandate ?? g.description}</p></div>}
      {!dm && <div className="panel__sec"><span className="panel__label">Who can post</span><p>{s.whoCanPost}</p>
        {g.kind === 'CLASS' && <p style={{ color: 'var(--ink-3)' }}>Teachers reach this class through the CR line{s.crLine ? ' — ' : ''}{s.crLine && <Link to={`/g/${s.crLine.id}`} style={{ color: 'var(--primary)' }}>open it</Link>}.</p>}
        {g.slowModeSeconds > 0 && <p className="mono">Slow mode: {g.slowModeSeconds}s</p>}</div>}
      {s.managers.length > 0 && <div className="panel__sec"><span className="panel__label">Manager</span>{s.managers.map((m) => <Person key={m.id} p={m} sub={m.badges[0]} />)}</div>}
      {s.moderators.length > 0 && <div className="panel__sec"><span className="panel__label">Moderators</span>{s.moderators.map((m) => <Person key={m.id} p={m} sub="CR" />)}</div>}
      {s.crs && s.crs.length > 0 && g.kind === 'CR_LINE' && <div className="panel__sec"><span className="panel__label">Class representatives <span>{s.crs.length}</span></span>{s.crs.map((m) => <Person key={m.id} p={m} />)}</div>}
      {s.faculty && s.faculty.length > 0 && <div className="panel__sec"><span className="panel__label">Faculty this term <span>{s.faculty.length}</span></span>
        {s.faculty.map((f) => f.teacher && <div className="person" key={f.courseCode}><Avatar name={f.teacher.name} initials={f.teacher.initials} dept={f.teacher.dept} /><div><b>{f.teacher.name}</b><small>{f.courseCode} · {f.title}{f.teacher.cabin ? ` · ${f.teacher.cabin}` : ''}</small></div></div>)}</div>}
      {s.pinned.length > 0 && <div className="panel__sec"><span className="panel__label">Pinned <span>{s.pinned.length}</span></span>{s.pinned.map((p) => <p key={p.id}>{p.body.slice(0, 120)}</p>)}</div>}
      {s.files.length > 0 && <div className="panel__sec"><span className="panel__label">Files <span>{s.files.length}</span></span>{s.files.slice(0, 8).map((f) => <a key={f.url} className="file" href={`${f.url}`} target="_blank" rel="noreferrer" onClick={(e) => { e.preventDefault(); import('../../lib/api').then(({ fileHref }) => window.open(fileHref(f.url), '_blank')) }}>{f.name}</a>)}</div>}
      {g.rules?.length > 0 && !dm && <div className="panel__sec"><span className="panel__label">Rules</span><ul className="rules">{g.rules.map((r) => <li key={r}>{r}</li>)}</ul></div>}
      {!dm && <div className="panel__sec"><span className="panel__label">Members</span><p>{g.memberCount} people</p></div>}
    </aside>
  )
}
