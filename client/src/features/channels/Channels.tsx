import { useEffect, useState } from 'react'
import { Link, NavLink, useNavigate, useParams } from 'react-router-dom'
import { FileText, Bookmark, ThumbsUp } from 'lucide-react'
import { Alert, Button, ErrorState, Field, Loading, Page, PageHead, LinkButton } from '../../components/ui'
import { api, fileHref } from '../../lib/api'
import { fmtSize } from '../../lib/format'
import { socket } from '../../lib/socket'
import { useFetch } from '../../lib/useFetch'
import { useAuth } from '../../store/auth'
import { useUi } from '../../store/ui'
import type { Attachment } from '../../lib/types'

export interface ChPost {
  id: string; channel: { id: string; slug: string; name: string }; refNo?: string; title: string; body?: string; attachments: Attachment[]; checklist?: string[]; scopeLine: string
  eligibility?: string; applyBy?: string; hoursLeft: number | null; daysLeft: number | null; urgent: boolean; closed: boolean; status: string; interestedCount: number
  interested: boolean; saved: boolean; ask: { slug?: string; label?: string }; author?: { name: string }; submission?: any; rejectReason?: string; waitingApproval: boolean; createdAt: string; ref?: string; submittedAgo?: number
}
interface Browse {
  id: string; slug: string; name: string; initials: string; kind: string; tag?: string; description?: string; subscribers: number; following: boolean; immutable: boolean; canLeave: boolean
  custodian?: string; lead?: string; audience?: string; canPublish: boolean; canManage: boolean; openSubmissions?: boolean; joinMode: string
}

const Tag = ({ children }: { children: React.ReactNode }) => <span className="badge" style={{ color: 'var(--ink-2)' }}>{children}</span>

export function ChannelTabs() {
  const me = useAuth((s) => s.me)!
  const { data } = useFetch<unknown[]>(me.capabilities.moderateChannels ? '/channels/moderation' : null)
  return (
    <div className="tabs">
      <NavLink to="/channels" end>Browse</NavLink>
      <NavLink to="/channels/submissions">My submissions</NavLink>
      {me.capabilities.moderateChannels && <NavLink to="/channels/moderation">Approval queue{data && data.length > 0 && <span className="count">{data.length}</span>}</NavLink>}
    </div>
  )
}

export function BrowseChannels() {
  const { data, loading, error, setData } = useFetch<Browse[]>('/channels')
  const toast = useUi((s) => s.toast)
  async function toggle(c: Browse) {
    try {
      await (c.following ? api.del(`/channels/${c.id}/follow`) : api.post(`/channels/${c.id}/follow`))
      setData((d) => d && d.map((x) => (x.id === c.id ? { ...x, following: !c.following } : x))); useAuth.getState().refreshMe()
    } catch (e: any) { toast(e.meta?.reason ?? e.message, 'error') }
  }
  if (loading && !data) return <Loading />
  if (error || !data) return <ErrorState error={error} />
  const groups: [string, string, Browse[]][] = [
    ['Official channels', 'Sent by university offices. You are enrolled automatically.', data.filter((c) => c.kind === 'INSTITUTIONAL')],
    ['Societies and utilities', 'Opt in to what you care about.', data.filter((c) => c.kind === 'SOCIETY' || c.kind === 'UTILITY')],
    ['Department channels', 'Events and notices from your department.', data.filter((c) => c.kind === 'DEPARTMENT')],
  ]
  return (
    <Page narrow>
      <PageHead title="Channels" sub="Posts are shown only to the students they are meant for." />
      <ChannelTabs />
      {groups.filter((g) => g[2].length).map(([title, sub, list]) => (
        <section key={title} style={{ marginBottom: 32 }}>
          <h2 style={{ font: '600 15px/22px var(--font-sans)' }}>{title}</h2><p className="muted" style={{ marginBottom: 8, fontSize: 13 }}>{sub}</p>
          <div className="chlist">{list.map((c) => (
            <div className="chitem" key={c.id}>
              <span className="avatar avatar--40">{c.initials}</span>
              <div className="chitem__main">
                <h3><Link to={`/channels/${c.slug}`}>★ {c.name}</Link>{c.tag && <Tag>{c.tag}</Tag>}</h3>
                <p>{c.description}</p>
                <div className="chitem__meta">{c.subscribers} subscribers{c.lead ? ` · Lead: ${c.lead}` : c.custodian ? ` · ${c.custodian}` : ''}{c.audience ? ` · ${c.audience}` : ''}</div>
              </div>
              {c.immutable ? <Tag>Can't leave</Tag> : <Button size="sm" variant={c.following ? 'secondary' : 'primary'} onClick={() => toggle(c)}>{c.following ? (c.canLeave ? 'Following' : 'Mute only') : 'Follow'}</Button>}
            </div>
          ))}</div>
        </section>
      ))}
    </Page>
  )
}

export function PostCard({ p, onChange, showStatus }: { p: ChPost; onChange?: (p: ChPost) => void; showStatus?: boolean }) {
  const toast = useUi((s) => s.toast)
  async function tog(kind: 'interest' | 'save') {
    try { const r = await api.post<{ on: boolean; interestedCount: number }>(`/channel-posts/${p.id}/${kind}`); onChange?.({ ...p, ...(kind === 'interest' ? { interested: r.on, interestedCount: r.interestedCount } : { saved: r.on }) }) } catch (e: any) { toast(e.message, 'error') }
  }
  const dl = p.applyBy && (p.closed ? `Closed ${new Date(p.applyBy).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : `Apply by ${new Date(p.applyBy).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} · ${p.hoursLeft! <= 48 ? `${p.hoursLeft} hours left` : `${p.daysLeft} days left`}`)
  return (
    <article className={`cpost ${p.urgent && !p.closed ? 'cpost--urgent' : ''} ${p.closed ? 'cpost--closed' : ''}`}>
      <div className="row row--between"><div className="cpost__scope">{p.scopeLine}</div>{p.closed && <Tag>Cycle closed</Tag>}{p.urgent && !p.closed && <span className="badge badge--danger">Urgent</span>}{p.waitingApproval && <Tag>Waiting for approval</Tag>}{p.status === 'REJECTED' && <span className="badge badge--danger">Rejected</span>}</div>
      <h3 className="cpost__title">{p.title}</h3>
      {p.eligibility && <div className="cpost__elig">{p.eligibility}</div>}
      {p.body && <p className="cpost__body">{p.body}</p>}
      {p.checklist && p.checklist.length > 0 && <ul className="checklist" style={{ margin: 0, padding: 12 }}>{p.checklist.map((c) => <li key={c}>{c}</li>)}</ul>}
      {p.attachments.map((a) => <a key={a.url} className="file" href={fileHref(a.url)} target="_blank" rel="noreferrer"><FileText size={16} strokeWidth={1.5} />{a.name}<small>{[a.label, fmtSize(a.size)].filter(Boolean).join(' · ')}</small></a>)}
      {dl && <span className={`deadline ${p.urgent && !p.closed ? 'deadline--urgent' : ''}`}>{dl}</span>}
      {p.rejectReason && <Alert tone="error">Rejected: {p.rejectReason}</Alert>}
      {!showStatus && p.status === 'PUBLISHED' && (
        <div className="cpost__actions">
          {!p.closed && <Button size="sm" onClick={() => tog('interest')}><ThumbsUp size={14} strokeWidth={1.5} /> {p.interested ? 'Interested ✓' : 'Interested'} <span className="mono muted">({p.interestedCount})</span></Button>}
          <Button size="sm" onClick={() => tog('save')}><Bookmark size={14} strokeWidth={1.5} /> {p.saved ? 'Saved' : 'Save'}</Button>
          {p.ask.slug && <Link className="btn btn--quiet" style={{ marginLeft: 'auto', fontSize: 13 }} to={`/desks/${p.ask.slug}/new?post=${p.id}`}>{p.ask.label ?? 'Ask the desk'} →</Link>}
        </div>
      )}
    </article>
  )
}

interface Detail {
  channel: { id: string; slug: string; name: string; tag?: string; description?: string; about?: string; tags?: string[]; ownerLabel?: string; joinMode: string; subscribers: number; contact?: { office?: string; place?: string; ext?: string; email?: string; hours?: string }; deskSlug?: string }
  me: { following: boolean; muted: boolean; canLeave: boolean; canPublish: boolean; canManage: boolean; canSubmit: boolean }
  posts: ChPost[]; deadlines: { id: string; title: string; applyBy: string; hoursLeft: number; daysLeft: number; urgent: boolean }[]; activeDeadlines: number
}

export function ChannelFeed() {
  const { slug } = useParams()
  const { data, loading, error, reload, setData } = useFetch<Detail>(`/channels/${slug}`)
  const toast = useUi((s) => s.toast)
  useEffect(() => { const h = () => reload(); socket.on('channel:post', h); return () => { socket.off('channel:post', h) } }, [reload])
  if (loading && !data) return <Loading />
  if (error || !data) return <ErrorState error={error} />
  const c = data.channel
  const patch = (p: ChPost) => setData((d) => d && ({ ...d, posts: d.posts.map((x) => (x.id === p.id ? p : x)) }))
  async function mute(m: boolean) { try { await api.post(`/channels/${c.id}/mute`, { muted: m }); reload() } catch (e: any) { toast(e.meta?.reason ?? e.message, 'error') } }
  async function leave() { try { await api.del(`/channels/${c.id}/follow`); useAuth.getState().refreshMe(); reload() } catch (e: any) { toast(e.meta?.reason ?? e.message, 'error') } }
  return (
    <Page>
      <PageHead crumb="Channels" title={`★ ${c.name}`} sub={`${c.tag ? c.tag + ' · ' : ''}${c.subscribers} subscribers${c.ownerLabel ? ` · Managed by ${c.ownerLabel}` : ''}`}
        actions={<>
          {data.me.canManage && <Link className="btn btn--secondary" to={`/channels/${c.slug}/insights`}>Insights</Link>}
          {(data.me.canPublish || data.me.canSubmit) && <LinkButton variant="primary" to={`/channels/${c.slug}/new`}>{data.me.canPublish ? 'New post' : 'Submit a post'}</LinkButton>}
        </>} />
      <div className="grid2">
        <div className="stack" style={{ gap: 16 }}>
          {data.posts.map((p) => <PostCard key={p.id} p={p} onChange={patch} />)}
          {data.posts.length === 0 && <div className="empty" style={{ padding: 0 }}>No posts for you here yet.</div>}
          <Alert>This is an official channel. Questions go to the <Link to={`/desks/${c.deskSlug ?? 'student-affairs'}`} style={{ color: 'var(--primary)', textDecoration: 'underline' }}>desk</Link>, not as replies here.</Alert>
        </div>
        <aside className="aside">
          {(c.about || c.description) && <div className="aside__sec"><span className="aside__label">About</span><p style={{ fontSize: 13, lineHeight: '20px', color: 'var(--ink-2)' }}>{c.about ?? c.description}</p><div className="chips">{c.tags?.map((t) => <Tag key={t}>{t}</Tag>)}</div></div>}
          <div className="aside__sec"><span className="aside__label">Upcoming deadlines · {data.activeDeadlines}</span>
            {data.deadlines.map((d) => <div className={`dl ${d.urgent ? 'dl--urgent' : ''}`} key={d.id}><b>{d.title}</b><small>{d.hoursLeft <= 48 ? `${d.hoursLeft}h left` : `${d.daysLeft} days left`} · {new Date(d.applyBy).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</small></div>)}
            {data.deadlines.length === 0 && <span className="muted" style={{ fontSize: 13 }}>No open deadlines.</span>}</div>
          {c.contact?.office && <div className="aside__sec"><span className="aside__label">Office</span><div className="dl"><b>{c.contact.office}</b>{c.contact.place && <span>{c.contact.place}</span>}<small>{[c.contact.ext, c.contact.email, c.contact.hours].filter(Boolean).join(' · ')}</small></div></div>}
          <div className="aside__sec"><span className="aside__label">Your preferences</span>
            <div className="dl"><span>{data.me.following ? (data.me.muted ? 'Muted' : 'Subscribed') : 'Not subscribed'}</span></div>
            {c.joinMode === 'AUTO_LOCKED' && <small className="muted">Official channel: you can't leave or mute it.</small>}
            {c.joinMode !== 'AUTO_LOCKED' && data.me.following && <Button size="sm" onClick={() => mute(!data.me.muted)}>{data.me.muted ? 'Unmute' : 'Mute'}</Button>}
            {c.joinMode === 'OPT_IN' && data.me.following && <Button size="sm" variant="danger" onClick={leave}>Unfollow</Button>}</div>
        </aside>
      </div>
    </Page>
  )
}

export function MySubmissions() {
  const { data, loading, setData } = useFetch<ChPost[]>('/channels/submissions')
  return (
    <Page narrow><PageHead title="My submissions" sub="Posts you sent for approval." /><ChannelTabs />
      {loading && !data ? <Loading /> : <div className="stack">{data?.map((p) => <PostCard key={p.id} p={p} showStatus onChange={(x) => setData((d) => d && d.map((y) => (y.id === x.id ? x : y)))} />)}{data?.length === 0 && <div className="empty" style={{ padding: 0 }}>You haven't submitted anything. Open a society or Lost & Found channel and choose Submit a post.</div>}</div>}
    </Page>
  )
}

export function Moderation() {
  const { data, loading, error, reload } = useFetch<ChPost[]>('/channels/moderation')
  const toast = useUi((s) => s.toast)
  const [rejecting, setRejecting] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  async function act(id: string, kind: 'approve' | 'reject') {
    try { await api.post(`/channel-posts/${id}/${kind}`, kind === 'reject' ? { reason } : {}); toast(kind === 'approve' ? 'Approved and published' : 'Rejected'); setRejecting(null); setReason(''); reload() } catch (e: any) { toast(e.message, 'error') }
  }
  if (loading && !data) return <Loading />
  if (error || !data) return <ErrorState error={error} />
  return (
    <Page narrow><PageHead title="Approval queue" sub="Society and Lost & Found submissions wait here until an officer approves them." /><ChannelTabs />
      <div className="stack">{data.map((p) => (
        <div className="card" key={p.id}>
          <div className="card__head"><span className="mono muted" style={{ fontSize: 12 }}>#{p.ref} · {p.channel.name}</span><span className="mono muted" style={{ fontSize: 12 }}>{p.submittedAgo}m ago</span></div>
          <div className="card__body">
            <h3 style={{ font: '600 15px/22px var(--font-sans)' }}>{p.title}</h3><p style={{ fontSize: 14, color: 'var(--ink-2)' }}>{p.body}</p>
            <dl className="kv"><dt>Submitter</dt><dd>{p.submission?.submitterName ?? p.author?.name}</dd><dt>Registration</dt><dd className="mono">{p.submission?.regNo}</dd>{p.applyBy && <><dt>Cut-off</dt><dd className="mono">{new Date(p.applyBy).toLocaleDateString('en-GB')}</dd></>}</dl>
            {p.attachments.map((a) => <a key={a.url} className="file" href={fileHref(a.url)} target="_blank" rel="noreferrer"><FileText size={16} strokeWidth={1.5} />{a.name}</a>)}
            {rejecting === p.id ? <div className="stack"><Field label="Reason (the author is told)" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /><div className="row"><Button variant="danger" disabled={reason.trim().length < 2} onClick={() => act(p.id, 'reject')}>Reject</Button><Button onClick={() => setRejecting(null)}>Cancel</Button></div></div>
              : <div className="row"><Button variant="primary" onClick={() => act(p.id, 'approve')}>Approve and publish</Button><Button onClick={() => { setRejecting(p.id); setReason('') }}>Reject</Button></div>}
          </div>
        </div>
      ))}{data.length === 0 && <div className="empty" style={{ padding: 0 }}>Nothing is waiting for approval.</div>}</div>
    </Page>
  )
}

export function ChannelCompose() {
  const { slug } = useParams()
  const { data, loading, error } = useFetch<Detail>(`/channels/${slug}`)
  const nav = useNavigate()
  const toast = useUi((s) => s.toast)
  const [title, setTitle] = useState(''); const [body, setBody] = useState(''); const [eligibility, setElig] = useState('')
  const [applyBy, setApplyBy] = useState(''); const [files, setFiles] = useState<Attachment[]>([])
  const [programs, setPrograms] = useState(''); const [intakes, setIntakes] = useState<string[]>([]); const [batches, setBatches] = useState('')
  const [count, setCount] = useState<number | null>(null)
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null)
  const target = { programs: programs.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean), intakes, batchCodes: batches.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean) }
  const all = !target.programs.length && !intakes.length && !target.batchCodes.length
  useEffect(() => { const t = setTimeout(() => api.post<{ count: number }>('/channels/audience', all ? { all: true } : target).then((r) => setCount(r.count)).catch(() => {}), 300); return () => clearTimeout(t) }, [programs, intakes, batches]) // eslint-disable-line
  if (loading) return <Loading />
  if (error || !data) return <ErrorState error={error} />
  const publisher = data.me.canPublish
  async function go() {
    setBusy(true); setErr(null)
    try { await api.post(`/channels/${data!.channel.id}/posts`, { title, body, eligibility: eligibility || undefined, applyBy: applyBy || undefined, attachments: files, target: all ? { all: true } : target }); toast(publisher ? 'Published' : 'Sent for approval'); nav(publisher ? `/channels/${slug}` : '/channels/submissions') }
    catch (e: any) { setErr(e.meta?.reason ?? e.message) } finally { setBusy(false) }
  }
  return (
    <Page narrow>
      <PageHead crumb={data.channel.name} title={publisher ? 'New post' : 'Submit a post'} sub={publisher ? 'Only students who match the audience will see it.' : 'An officer approves it before it appears in the channel.'} />
      <div className="stack" style={{ gap: 20 }}>
        <Field label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <div className="field"><label className="field__label">Details</label><textarea className="input" rows={6} value={body} onChange={(e) => setBody(e.target.value)} /></div>
        {publisher && <Field label="Who is it for? (shown under the title)" placeholder="For FA23 and SP23, BSCS" value={eligibility} onChange={(e) => setElig(e.target.value)} />}
        <div className="card"><div className="card__head">Audience <span className="mono muted" style={{ fontSize: 12 }}>{count ?? '…'} students</span></div><div className="card__body">
          <div className="formgrid"><Field label="Programs" placeholder="BCS, BSE (blank = all)" value={programs} onChange={(e) => setPrograms(e.target.value)} /><Field label="Batches" placeholder="FA23-BCS, SP23-BCS" value={batches} onChange={(e) => setBatches(e.target.value)} /></div>
          <div className="chips">{['FA', 'SP'].map((i) => <label key={i} className="checkrow"><input type="checkbox" checked={intakes.includes(i)} onChange={(e) => setIntakes((x) => (e.target.checked ? [...x, i] : x.filter((y) => y !== i)))} />{i === 'FA' ? 'Fall intake' : 'Spring intake'}</label>)}</div>
        </div></div>
        <Field label="Apply-by date (optional)" type="date" value={applyBy} onChange={(e) => setApplyBy(e.target.value)} />
        <div className="field"><span className="field__label">Attachment</span>{files.map((f) => <span className="file" key={f.url}>{f.name}</span>)}<input type="file" accept="application/pdf,image/png,image/jpeg" onChange={async (e) => { if (e.target.files?.length) { try { setFiles((await api.upload([...e.target.files])).files) } catch (x: any) { toast(x.meta?.reason ?? x.message, 'error') } } }} /></div>
        {err && <Alert tone="error">{err}</Alert>}
        <div className="row"><Button onClick={() => nav(-1)}>Cancel</Button><Button variant="primary" loading={busy} disabled={title.trim().length < 3} onClick={go}>{publisher ? `Publish to ${count ?? '…'} students` : 'Submit for approval'}</Button></div>
      </div>
    </Page>
  )
}

export function Insights() {
  const { slug } = useParams()
  const { data, loading, error } = useFetch<{ channel: string; subscribers: number; posts: { id: string; title: string; interested: number; saved: number }[]; totals: { interested: number; saved: number } }>(`/channels/${slug}/insights`)
  if (loading) return <Loading />
  if (error || !data) return <ErrorState error={error} />
  return (
    <Page narrow><PageHead crumb={data.channel} title="Insights" sub="Totals only. Individual student activity is never shown." />
      <div className="stats"><div className="stat"><div className="stat__label">Subscribers</div><div className="stat__value">{data.subscribers}</div></div><div className="stat"><div className="stat__label">Interested</div><div className="stat__value">{data.totals.interested}</div></div><div className="stat"><div className="stat__label">Saved</div><div className="stat__value">{data.totals.saved}</div></div></div>
      <div className="tablewrap"><table className="table"><thead><tr><th>Post</th><th>Interested</th><th>Saved</th></tr></thead><tbody>{data.posts.map((p) => <tr key={p.id}><td>{p.title}</td><td className="mono">{p.interested}</td><td className="mono">{p.saved}</td></tr>)}</tbody></table></div>
    </Page>
  )
}
