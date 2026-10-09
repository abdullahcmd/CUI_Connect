import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { FileText } from 'lucide-react'
import { Button, ErrorState, Loading, Page, PageHead, Progress, LinkButton } from '../../components/ui'
import { api, fileHref } from '../../lib/api'
import { fmtSize } from '../../lib/format'
import { socket } from '../../lib/socket'
import { useFetch } from '../../lib/useFetch'
import { useAuth } from '../../store/auth'
import { useUi } from '../../store/ui'
import type { Feed, Post } from './types'

const SCOPES = [['all', 'All'], ['university', 'University'], ['department', 'Department'], ['program', 'Program'], ['batch', 'Batch']] as const
const CATS = ['', 'SCHEDULE', 'HOLIDAY', 'EXAM', 'FEE', 'EVENT', 'GENERAL']
const day = (d?: string) => d && new Date(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })

export function PostCard({ p, full, onChange }: { p: Post; full?: boolean; onChange?: (p: Post) => void }) {
  const me = useAuth((s) => s.me)!
  const toast = useUi((s) => s.toast)
  const nav = useNavigate()
  async function ack() {
    try { const r = await api.post<{ count: number }>(`/board/${p.id}/ack`); onChange?.({ ...p, acknowledged: true, ackCount: r.count }); useAuth.getState().refreshMe() } catch (e: any) { toast(e.message, 'error') }
  }
  async function forward() { try { await api.post(`/board/${p.id}/forward`); toast('Forwarded to the CRs group') } catch (e: any) { toast(e.message, 'error') } }
  async function remove() {
    if (!window.confirm('Remove this notice? After one hour it can only be archived.')) return
    try { const r = await api.del<{ archived: boolean }>(`/board/${p.id}`); toast(r.archived ? 'Archived' : 'Deleted'); nav('/board') } catch (e: any) { toast(e.message, 'error') }
  }
  return (
    <article className={`bpost ${p.acknowledged && !p.canManage ? 'bpost--seen' : ''}`}>
      <div className="bpost__scope">{p.scopeLine}{p.refNo ? ` · ${p.refNo}` : ''}</div>
      <span className="bpost__cat">{p.category}{p.pinned ? ' · Pinned' : ''}{p.status === 'ARCHIVED' ? ' · Archived' : ''}</span>
      <h2 className="bpost__title">{full ? p.title : <Link to={`/board/${p.id}`}>{p.title}</Link>}</h2>
      <p className={`bpost__body ${full ? 'bpost__body--full' : ''}`}>{p.body}</p>
      {p.attachments.map((a) => <a key={a.url} className="file" href={fileHref(a.url)} target="_blank" rel="noreferrer"><FileText size={16} strokeWidth={1.5} />{a.name}<small>{fmtSize(a.size)}</small></a>)}
      {p.effectiveFrom && <div className="bpost__date">Applies from {day(p.effectiveFrom)}{p.expiresAt ? ` · until ${day(p.expiresAt)}` : ''}</div>}
      <div className="bpost__foot">
        {p.canManage ? (
          <div className="bpost__ack">Acknowledged by {p.ackCount} of {p.audienceCount}<Progress pct={p.audienceCount ? (p.ackCount / p.audienceCount) * 100 : 0} /></div>
        ) : p.acknowledged ? <span className="status status--resolved">Acknowledged</span> : <Button onClick={ack}>Acknowledge{p.mandatoryAck ? ' (required)' : ''}</Button>}
        <div className="row">
          {p.canManage && <Link className="btn btn--secondary btn--sm" to={`/board/${p.id}/acks`}>Report</Link>}
          {p.canManage && me.capabilities.forwardBoard && <Button size="sm" onClick={forward}>Forward to CRs</Button>}
          {p.canManage && full && <Button size="sm" variant="danger" onClick={remove}>Remove</Button>}
          {p.versionCount > 0 && <Link className="btn btn--quiet" style={{ fontSize: 13 }} to={`/board/${p.id}/versions`}>Edited · history</Link>}
        </div>
      </div>
      <Link to={`/desks/${p.helpDesk.slug}`} className="btn btn--quiet" style={{ fontSize: 12, alignSelf: 'flex-start' }}>{p.helpDesk.label} →</Link>
    </article>
  )
}

export default function Board({ archive }: { archive?: boolean }) {
  const me = useAuth((s) => s.me)!
  const [scope, setScope] = useState<string>('all')
  const [cat, setCat] = useState('')
  const q = `${archive ? '/board/archive' : '/board'}?scope=${scope}${cat ? `&category=${cat}` : ''}`
  const { data, error, loading, reload, setData } = useFetch<Feed>(q)
  const [fresh, setFresh] = useState(0)

  useEffect(() => {
    const onNew = (p: Post) => { setFresh((n) => n + 1); useAuth.getState().refreshMe(); void p }
    const onAck = (d: { id: string; count: number }) => setData((f) => f && ({ ...f, pinned: f.pinned.map((x) => x.id === d.id ? { ...x, ackCount: d.count } : x), latest: f.latest.map((x) => x.id === d.id ? { ...x, ackCount: d.count } : x), items: f.items }))
    socket.on('board:new', onNew); socket.on('board:ack', onAck); socket.on('board:updated', reload)
    return () => { socket.off('board:new', onNew); socket.off('board:ack', onAck); socket.off('board:updated', reload) }
  }, [reload, setData])

  const patch = (p: Post) => setData((f) => f && ({ ...f, pinned: f.pinned.map((x) => x.id === p.id ? p : x), latest: f.latest.map((x) => x.id === p.id ? p : x), items: f.items }))

  return (
    <Page>
      <PageHead title={archive ? 'Board archive' : 'Announcements'} sub={archive ? 'Expired and older notices.' : 'Official notices from the university, your department and your batch.'}
        actions={<>
          {!archive && <Link className="btn btn--secondary" to="/board/archive">Archive</Link>}
          {archive && <Link className="btn btn--secondary" to="/board">Back to board</Link>}
          {me.capabilities.publishBoard && !archive && <LinkButton variant="primary" to="/board/new">Publish notice</LinkButton>}
        </>} />
      <div className="toolbar">
        <div className="tabs" style={{ margin: 0, border: 0 }} role="tablist">{SCOPES.map(([id, label]) => <button key={id} role="tab" aria-selected={scope === id} onClick={() => setScope(id)}>{label}</button>)}</div>
        <select className="input" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category">{CATS.map((c) => <option key={c} value={c}>{c ? c[0] + c.slice(1).toLowerCase() : 'All categories'}</option>)}</select>
      </div>
      {fresh > 0 && <button className="newbar" onClick={() => { setFresh(0); reload() }}>{fresh} new announcement{fresh > 1 ? 's' : ''} — show</button>}
      {loading && !data ? <Loading /> : error ? <ErrorState error={error} /> : (
        <div className="board">
          {(data?.pinned.length ?? 0) > 0 && <div className="board__label">Pinned</div>}
          {data?.pinned.map((p) => <PostCard key={p.id} p={p} onChange={patch} />)}
          {(data?.latest.length ?? 0) > 0 && <div className="board__label">Latest</div>}
          {data?.latest.map((p) => <PostCard key={p.id} p={p} onChange={patch} />)}
          {data && data.items.length === 0 && <div className="empty" style={{ padding: 0 }}>No notices here yet.</div>}
        </div>
      )}
    </Page>
  )
}
