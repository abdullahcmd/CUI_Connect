import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { FileText, Lock, Phone, Mail, Clock } from 'lucide-react'
import { Alert, Avatar, Button, ErrorState, Field, Loading, Page, PageHead, Stat, Status, Tabs } from '../../components/ui'
import { Dialog } from '../chat/dialogs'
import { api, fileHref } from '../../lib/api'
import { fmtStamp, ago, fmtSize } from '../../lib/format'
import { emit, socket } from '../../lib/socket'
import { useFetch } from '../../lib/useFetch'
import { useAuth } from '../../store/auth'
import { useUi } from '../../store/ui'
import type { Attachment, Message } from '../../lib/types'

export interface Ticket {
  id: string; code: string; deskId: string; deskSlug: string; deskName: string; category: string; subject: string; description?: string; attachments: Attachment[]
  status: string; priority: string; level: number; levelLabel?: string; levelOf: number; requester?: { id: string; uid: string; name: string; batch?: string }
  assignee?: { id: string; name: string }; counterNo?: number; overdue: boolean; resolution?: string; createdAt: string; resolvedAt?: string; canReopen: boolean; ageHours: number
  steps: { level: number; label: string; state: 'past' | 'current' | 'future' }[]
}
interface DeskProfile {
  id: string; slug: string; name: string; prefix: string; kind: string; description?: string; location?: string; hours?: string; block?: string; online: boolean; categories: string[]
  counters: { no: number; name: string; handles: string; status: string; ext?: string; open: number }[]; contacts: { label: string; ext?: string; phone?: string; email?: string; hours?: string; person?: string }[]
  advisory?: { title: string; body: string }; safeguard?: { title: string; body: string; ref?: string }; checklist?: string[]; requestForm?: { code: string; accepted: string; maxMb: number }
  chain: { level: number; label: string }[]; targetReplyHours: number; me: { isAgent: boolean; level: number; canSettings: boolean }; stats: { open: number }
}

// ---------- hub
export function DeskHub() {
  const me = useAuth((s) => s.me)!
  const { data: tickets, loading } = useFetch<Ticket[]>('/tickets/mine')
  const [sel, setSel] = useState<string | null>(null)
  const [tab, setTab] = useState<'active' | 'done'>('active')
  const desks = me.sidebar.desks
  const list = (tickets ?? []).filter((t) => (tab === 'active' ? ['OPEN', 'IN_PROGRESS', 'ESCALATED'].includes(t.status) : ['RESOLVED', 'CLOSED'].includes(t.status)))
  useEffect(() => { if (!sel && list[0]) setSel(list[0].id) }, [list, sel])
  return (
    <Page>
      <PageHead title="Help desks" sub="Ask the right office. Every ticket has an owner, a reply time and a clear escalation path." actions={<Link className="btn btn--primary" to={`/desks/${desks.find((d) => d.mode === 'requester')?.slug ?? 'student-affairs'}/new`}>New ticket</Link>} />
      <div className="stats">{desks.filter((d) => d.mode === 'requester').map((d) => <Link key={d.id} to={`/desks/${d.slug}`} className="stat"><div className="stat__label">{d.kind.replace('_', ' ')}</div><div style={{ font: '600 16px/24px var(--font-sans)' }}>◇ {d.name}</div><div className="stat__sub">{d.open ? `${d.open} open` : 'No open tickets'}</div></Link>)}</div>
      {loading && !tickets ? <Loading /> : (
        <div className="grid2" style={{ gridTemplateColumns: '340px minmax(0,1fr)' }}>
          <div>
            <Tabs value={tab} onChange={setTab} items={[{ id: 'active', label: 'Active' }, { id: 'done', label: 'Resolved / closed' }]} />
            <div className="stack" style={{ gap: 8 }}>{list.map((t) => (
              <button key={t.id} className="card" style={{ textAlign: 'left', padding: 12, boxShadow: sel === t.id ? 'inset 0 0 0 2px var(--cui-blue)' : undefined }} onClick={() => setSel(t.id)}>
                <div className="row row--between"><span className="mono muted" style={{ fontSize: 12 }}>#{t.code} · {t.deskName}</span><Status s={t.status} /></div>
                <div style={{ font: '600 15px/22px var(--font-serif)' }}>{t.subject}</div>
                <div className="muted" style={{ fontSize: 12 }}>Level {t.level} of {t.levelOf}{t.levelLabel ? ` · ${t.levelLabel}` : ''} · {ago(t.createdAt)}</div>
              </button>))}
              {list.length === 0 && <div className="muted" style={{ fontSize: 14 }}>No tickets here. When you raise one, it shows up in this list.</div>}
              <Alert>Tickets can be reopened within 72 hours of resolution. After that they lock, and a new ticket is needed.</Alert></div>
          </div>
          <div>{sel ? <TicketView id={sel} embedded /> : <div className="muted">Select a ticket to read the thread.</div>}</div>
        </div>)}
    </Page>
  )
}

// ---------- desk page + new ticket (requester)
export function DeskPage() {
  const { slug } = useParams()
  const { data, loading, error } = useFetch<DeskProfile>(`/desks/${slug}`)
  const { data: mine, reload } = useFetch<Ticket[]>('/tickets/mine')
  if (loading) return <Loading />
  if (error || !data) return <ErrorState error={error} />
  const rows = (mine ?? []).filter((t) => t.deskSlug === slug)
  return (
    <Page>
      <PageHead crumb="Help desks" title={`◇ ${data.name}`} sub={data.description} actions={<>{data.me.isAgent && <Link className="btn btn--secondary" to={`/desks/${slug}/queue`}>Open queue</Link>}<Link className="btn btn--primary" to={`/desks/${slug}/new`}>New ticket</Link></>} />
      <div className="grid2">
        <div className="stack" style={{ gap: 20 }}>
          {data.advisory && <Alert><div><b>{data.advisory.title}</b><div>{data.advisory.body}</div></div></Alert>}
          {data.counters.length > 0 && <div><h2 className="aside__label" style={{ marginBottom: 8 }}>Counters</h2><div className="chlist">{data.counters.map((c) => <div className="chitem" key={c.no}><span className="avatar">{String(c.no).padStart(2, '0')}</span><div className="chitem__main"><h3>{c.name}</h3><p>{c.handles}</p></div><span className={`status ${c.status === 'OPEN' ? 'status--resolved' : 'status--open'}`}>{c.status[0] + c.status.slice(1).toLowerCase()}</span></div>)}</div></div>}
          <div><h2 className="aside__label" style={{ marginBottom: 8 }}>Your tickets here</h2>
            <div className="tablewrap"><table className="table"><thead><tr><th>ID</th><th>Category</th><th>Opened</th><th>Status</th><th /></tr></thead><tbody>
              {rows.map((t) => <tr key={t.id}><td className="mono">#{t.code}</td><td>{t.category}</td><td className="mono muted">{new Date(t.createdAt).toLocaleDateString('en-GB')}</td><td><Status s={t.status} /></td><td><Link className="btn btn--quiet" to={`/tickets/${t.id}`}>View trail</Link></td></tr>)}
              {rows.length === 0 && <tr><td colSpan={5} className="muted">No tickets at this desk yet.</td></tr>}</tbody></table></div></div>
          {void reload}
        </div>
        <aside className="aside">
          <div className="aside__sec"><span className="aside__label">Desk</span><div className="dl"><b>{data.name}</b>{data.location && <span>{data.location}</span>}<small>Reply within {data.targetReplyHours / 24 >= 1 ? `${data.targetReplyHours / 24} working days` : `${data.targetReplyHours} hours`}</small></div></div>
          {data.contacts.map((c) => <div className="dl" key={c.label}><b>{c.label}</b>{c.ext && <span className="row"><Phone size={13} /> {c.ext}</span>}{c.email && <span className="row"><Mail size={13} /> {c.email}</span>}{c.hours && <span className="row"><Clock size={13} /> {c.hours}</span>}{c.person && <small>{c.person}</small>}</div>)}
          <div className="aside__sec"><span className="aside__label">Escalation</span><div className="dl">{data.chain.map((c) => <span key={c.level}>Level {c.level} · {c.label}</span>)}</div></div>
          {data.checklist && <div className="aside__sec"><span className="aside__label">Documents to bring</span><ul className="checklist" style={{ gridTemplateColumns: '1fr', margin: 0 }}>{data.checklist.map((c) => <li key={c}>{c}</li>)}</ul></div>}
          {data.safeguard && <div className="dl"><b>{data.safeguard.title}</b><span>{data.safeguard.body}</span><small>{data.safeguard.ref}</small></div>}
        </aside>
      </div>
    </Page>
  )
}

export function NewTicket() {
  const { slug } = useParams()
  const [sp] = useSearchParams()
  const { data, loading, error } = useFetch<DeskProfile>(`/desks/${slug}`)
  const nav = useNavigate()
  const toast = useUi((s) => s.toast)
  const me = useAuth((s) => s.me)!
  const [category, setCategory] = useState(''); const [subject, setSubject] = useState(''); const [desc, setDesc] = useState(''); const [files, setFiles] = useState<Attachment[]>([])
  const [dup, setDup] = useState<{ code: string; ticketId: string } | null>(null); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  if (loading) return <Loading />
  if (error || !data) return <ErrorState error={error} />
  async function go(force = false) {
    setBusy(true); setErr(null)
    try {
      const r = await api.post<{ ticket: Ticket; expectedReplyHours: number; routedTo: string }>('/tickets', { deskSlug: slug, category: category || data!.categories[0], subject, description: desc, attachments: files, linkedPostId: sp.get('post') || undefined, force })
      toast(`Ticket #${r.ticket.code} sent to ${r.routedTo}. Expected reply within ${r.expectedReplyHours / 24} working days.`); useAuth.getState().refreshMe(); nav(`/tickets/${r.ticket.id}`)
    } catch (e: any) { if (e.meta?.reason === 'DUPLICATE_OPEN_TICKET') setDup({ code: e.meta.code, ticketId: e.meta.ticketId }); else setErr(e.meta?.reason ?? e.message) } finally { setBusy(false) }
  }
  return (
    <Page narrow>
      <PageHead crumb={data.name} title="New ticket" sub={`Goes to ${data.name}. Reply expected within ${data.targetReplyHours / 24} working days.`} />
      <div className="stack" style={{ gap: 20 }}>
        <div className="formgrid"><div className="field"><span className="field__label">Your ID</span><div className="input mono" style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface)' }}><Lock size={14} />{me.user.uid}</div></div>
          <div className="field"><label className="field__label">Category</label><select className="input" value={category || data.categories[0]} onChange={(e) => setCategory(e.target.value)}>{data.categories.map((c) => <option key={c}>{c}</option>)}</select></div></div>
        <Field label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Request for splitting Fall 2026 tuition into 2 instalments" />
        <div className="field"><label className="field__label">What do you need?</label><textarea className="input" rows={6} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Give the facts, reference numbers and what you would like done." /></div>
        <div className="field"><span className="field__label">Supporting document</span>
          {files.map((f) => <span key={f.url} className="file"><FileText size={14} />{f.name}</span>)}
          <input ref={file} type="file" accept="application/pdf,image/png,image/jpeg" onChange={async (e) => { if (e.target.files?.length) { try { setFiles((await api.upload([...e.target.files])).files) } catch (x: any) { toast(x.meta?.reason ?? x.message, 'error') } } }} />
          {data.requestForm && <span className="field__help">{data.requestForm.accepted}</span>}</div>
        {dup && <Alert tone="error"><div>You already have an open {category || data.categories[0]} ticket (#{dup.code}). <Link to={`/tickets/${dup.ticketId}`} style={{ textDecoration: 'underline' }}>Open it</Link> or <button className="btn btn--quiet" onClick={() => go(true)}>raise a new one anyway</button>.</div></Alert>}
        {err && <Alert tone="error">{err}</Alert>}
        <div className="row"><Button onClick={() => nav(-1)}>Cancel</Button><Button variant="primary" loading={busy} disabled={subject.trim().length < 3} onClick={() => go(false)}>Send ticket</Button></div>
      </div>
    </Page>
  )
}

// ---------- ticket thread (requester + agent)
interface Detail { ticket: Ticket; thread: Message[]; history: { at: string; action: string; note?: string }[]; me: { isRequester: boolean; isAgent: boolean; level: number; canEscalate: boolean; canResolve: boolean } }

export function TicketView({ id: idProp, embedded }: { id?: string; embedded?: boolean }) {
  const params = useParams()
  const id = idProp ?? params.id!
  const [d, setD] = useState<Detail | null>(null)
  const [err, setErr] = useState<any>(null)
  const [text, setText] = useState(''); const [note, setNote] = useState(false)
  const [dlg, setDlg] = useState<'escalate' | 'resolve' | null>(null)
  const [reason, setReason] = useState('')
  const toast = useUi((s) => s.toast)
  const end = useRef<HTMLDivElement>(null)

  async function load() { const r = await emit('ticket:open', { ticketId: id }); r.ok ? (setD(r.data), setErr(null)) : setErr(r) }
  useEffect(() => {
    setD(null); load()
    const onMsg = (m: Message) => m.ticketId === id && setD((x) => x && (x.thread.some((y) => y.id === m.id) ? x : { ...x, thread: [...x.thread, m] }))
    const onUpd = (t: Ticket) => t.id === id && load()
    socket.on('ticket:message', onMsg); socket.on('ticket:updated', onUpd); socket.on('connect', load)
    return () => { socket.off('ticket:message', onMsg); socket.off('ticket:updated', onUpd); socket.off('connect', load) }
  }, [id]) // eslint-disable-line
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }) }, [d?.thread.length])
  if (err) return <ErrorState error={{ message: err.meta?.reason ?? err.message ?? 'No access', code: err.code }} />
  if (!d) return <Loading />
  const t = d.ticket
  async function send() {
    const r = await emit('ticket:reply', { ticketId: id, body: text, internal: note })
    if (!r.ok) return toast(r.meta?.reason ?? r.message ?? "Couldn't send", 'error')
    setText('')
  }
  async function act(ev: string, payload: object, msg: string) { const r = await emit(ev, { ticketId: id, ...payload }); r.ok ? (toast(msg), setDlg(null), setReason(''), load()) : toast(r.meta?.reason ?? r.message ?? 'Failed', 'error') }
  const body = (
    <div className="stack" style={{ gap: 16 }}>
      <div><div className="row"><span className="badge badge--official">#{t.code}</span><span className="muted" style={{ fontSize: 13 }}>{t.deskName} · opened {fmtStamp(t.createdAt)}</span><Status s={t.status} />{t.overdue && <span className="badge badge--danger">Overdue</span>}</div>
        <h1 style={{ font: '600 22px/30px var(--font-serif)', marginTop: 8 }}>{t.subject}</h1>
        <dl className="kv" style={{ marginTop: 8 }}><dt>Requester</dt><dd>{t.requester?.name} <span className="mono muted">{t.requester?.uid}</span></dd><dt>Category</dt><dd>{t.category}</dd><dt>Assigned</dt><dd>{t.assignee?.name ?? 'Waiting for an agent'}{t.counterNo ? ` · Counter ${t.counterNo}` : ''}</dd></dl></div>
      <div className="card"><div className="card__head" style={{ fontSize: 12 }}><span className="mono muted">ESCALATION</span><span className="mono">Level {t.level} of {t.levelOf}</span></div><div className="card__body" style={{ flexDirection: 'row', gap: 8 }}>{t.steps.map((s) => <div key={s.level} className="dl" style={{ flex: 1, background: s.state === 'current' ? 'var(--cui-blue)' : undefined, color: s.state === 'current' ? '#fff' : s.state === 'future' ? 'var(--ink-3)' : undefined }}><small style={{ color: 'inherit' }}>LEVEL {s.level}</small><b>{s.label}</b></div>)}</div></div>
      {t.description && <div className="card"><div className="card__body"><div className="row"><Avatar name={t.requester?.name} /><b>{t.requester?.name}</b></div><p style={{ whiteSpace: 'pre-wrap' }}>{t.description}</p>{t.attachments.map((a) => <a key={a.url} className="file" href={fileHref(a.url)} target="_blank" rel="noreferrer"><FileText size={14} />{a.name}<small>{fmtSize(a.size)}</small></a>)}</div></div>}
      {d.thread.map((m) => <div key={m.id} className="card" style={m.internal ? { background: 'color-mix(in srgb, var(--st-open) 8%, var(--bg))', borderStyle: 'dashed' } : m.kind === 'SYSTEM' ? { background: 'var(--surface)' } : undefined}><div className="card__body"><div className="row"><Avatar name={m.sender.name} initials={m.sender.initials} dept={m.sender.dept} /><b>{m.sender.name}</b>{(m.sender.badges ?? []).map((b) => <span className="badge" key={b}>{b}</span>)}{m.internal && <span className="badge badge--danger">Internal note</span>}<span className="mono muted" style={{ fontSize: 12, marginLeft: 'auto' }}>{fmtStamp(m.createdAt)}</span></div><p style={{ whiteSpace: 'pre-wrap' }}>{m.body}</p></div></div>)}
      {t.resolution && <Alert>Resolution: {t.resolution}</Alert>}
      <div ref={end} />
      {t.status === 'CLOSED' ? <Alert>This ticket is closed (locked after 72 hours). Open a new ticket and mention {t.code}.</Alert> : (
        <div className="card"><div className="card__body">
          <textarea className="input" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={d.me.isAgent && !d.me.isRequester ? (note ? 'Internal note — only agents see this' : 'Reply to the requester') : 'Add a follow-up note'} />
          <div className="row row--between" style={{ flexWrap: 'wrap' }}>
            <div className="row">{d.me.isAgent && !d.me.isRequester && <label className="checkrow"><input type="checkbox" checked={note} onChange={(e) => setNote(e.target.checked)} />Internal note</label>}</div>
            <div className="row">
              {d.me.isAgent && !d.me.isRequester && <><Button onClick={() => act('ticket:assign', {}, 'Assigned to you')}>Assign to me</Button>{d.me.canEscalate && <Button onClick={() => setDlg('escalate')}>Escalate</Button>}{d.me.canResolve && <Button onClick={() => setDlg('resolve')}>Resolve</Button>}</>}
              {d.me.isRequester && t.canReopen && <Button onClick={() => act('ticket:reopen', {}, 'Reopened')}>Reopen</Button>}
              {d.me.isRequester && ['OPEN', 'IN_PROGRESS'].includes(t.status) && t.level < t.levelOf && !d.me.isAgent && <span className="muted" style={{ fontSize: 12 }}>Escalation is done by the office.</span>}
              <Button variant="primary" disabled={!text.trim()} onClick={send}>{note ? 'Add note' : 'Send'}</Button></div></div>
        </div></div>)}
      {dlg && <Dialog title={dlg === 'escalate' ? `Escalate to level ${t.level + 1}` : 'Resolve ticket'} onClose={() => setDlg(null)} actions={<><Button onClick={() => setDlg(null)}>Cancel</Button><Button variant="primary" disabled={reason.trim().length < 3} onClick={() => act(dlg === 'escalate' ? 'ticket:escalate' : 'ticket:resolve', dlg === 'escalate' ? { reason } : { note: reason }, dlg === 'escalate' ? 'Escalated' : 'Resolved')}>{dlg === 'escalate' ? 'Escalate' : 'Resolve'}</Button></>}>
        <div className="field"><label className="field__label">{dlg === 'escalate' ? 'Reason (required)' : 'Resolution note'}</label><textarea className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></div></Dialog>}
    </div>
  )
  return embedded ? body : <Page narrow><PageHead crumb="Help desks" title="Ticket" actions={<Link className="btn btn--secondary" to={d.me.isAgent && !d.me.isRequester ? `/desks/${t.deskSlug}/queue` : '/desks'}>Back</Link>} />{body}</Page>
}

// ---------- agent queue
export function Queue() {
  const { slug } = useParams()
  const [status, setStatus] = useState('OPEN'); const [assignee, setAssignee] = useState(''); const [q, setQ] = useState('')
  const { data, loading, error, reload } = useFetch<{ items: Ticket[]; total: number; counts: Record<string, number> }>(`/desks/${slug}/queue?status=${status}${assignee ? `&assignee=${assignee}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`)
  const nav = useNavigate()
  useEffect(() => { const h = () => reload(); socket.on('ticket:created', h); socket.on('ticket:updated', h); return () => { socket.off('ticket:created', h); socket.off('ticket:updated', h) } }, [reload])
  if (error) return <ErrorState error={error} />
  const c = data?.counts ?? {}
  return (
    <Page>
      <PageHead crumb="Help desks" title="Queue" sub="Tickets for your desk. New ones appear live." actions={<><Link className="btn btn--secondary" to={`/desks/${slug}/reports`}>Reports</Link><Link className="btn btn--secondary" to={`/desks/${slug}`}>Desk page</Link></>} />
      <Tabs value={status} onChange={setStatus} items={['OPEN', 'IN_PROGRESS', 'ESCALATED', 'RESOLVED', 'CLOSED', 'ALL'].map((s) => ({ id: s, label: s === 'ALL' ? 'All' : s.replace('_', ' ').toLowerCase().replace(/^./, (x) => x.toUpperCase()), count: s === 'ALL' ? undefined : c[s] ?? 0 }))} />
      <div className="toolbar"><input className="input" placeholder="Search ID, requester or subject" value={q} onChange={(e) => setQ(e.target.value)} /><select className="input" value={assignee} onChange={(e) => setAssignee(e.target.value)}><option value="">Anyone</option><option value="me">Assigned to me</option><option value="unassigned">Unassigned</option></select></div>
      {loading && !data ? <Loading /> : <div className="tablewrap"><table className="table"><thead><tr><th>ID</th><th>Requester</th><th>Category</th><th>Age</th><th>Status</th><th>Assignee</th><th>Level</th></tr></thead><tbody>
        {data?.items.map((t) => <tr key={t.id} style={{ cursor: 'pointer' }} onClick={() => nav(`/tickets/${t.id}`)}><td className="mono">#{t.code}</td><td>{t.requester?.name}<div className="mono muted" style={{ fontSize: 12 }}>{t.requester?.uid}</div></td><td>{t.category}</td><td className="mono">{t.ageHours < 48 ? `${t.ageHours}h` : `${Math.round(t.ageHours / 24)}d`}{t.overdue && <span className="badge badge--danger" style={{ marginLeft: 6 }}>Overdue</span>}</td><td><Status s={t.status} /></td><td>{t.assignee?.name ?? <span className="muted">—</span>}</td><td className="mono">{t.level}/{t.levelOf}</td></tr>)}
        {data?.items.length === 0 && <tr><td colSpan={7} className="muted">No tickets match. When students raise issues at this desk, they appear here.</td></tr>}</tbody></table></div>}
    </Page>
  )
}

export function DeskReports() {
  const { slug } = useParams()
  const { data, loading, error } = useFetch<{ open: number; overdue: number; resolved: number; avgFirstReplyHours: number; byCategory: Record<string, number>; slaResolution: number }>(`/desks/${slug}/reports`)
  if (loading) return <Loading />
  if (error || !data) return <ErrorState error={error} />
  return (
    <Page narrow><PageHead crumb="Help desks" title="Desk reports" actions={<Link className="btn btn--secondary" to={`/desks/${slug}/queue`}>Queue</Link>} />
      <div className="stats"><Stat label="Open" value={data.open} /><Stat label="Overdue" value={data.overdue} tone={data.overdue ? 'bad' : 'good'} /><Stat label="Resolved" value={data.resolved} /><Stat label="Avg first reply" value={`${data.avgFirstReplyHours}h`} /><Stat label="Resolution rate" value={`${data.slaResolution}%`} tone="good" /></div>
      <div className="tablewrap"><table className="table"><thead><tr><th>Category</th><th>Tickets</th></tr></thead><tbody>{Object.entries(data.byCategory).map(([k, v]) => <tr key={k}><td>{k}</td><td className="mono">{v}</td></tr>)}</tbody></table></div>
    </Page>
  )
}
