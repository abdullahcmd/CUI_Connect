import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Alert, Button, ErrorState, Loading, Page, PageHead, Stat, Tabs } from '../../components/ui'
import { api } from '../../lib/api'
import { fmtStamp } from '../../lib/format'
import { useFetch } from '../../lib/useFetch'
import { useAuth } from '../../store/auth'
import { useUi } from '../../store/ui'

interface Item { id: string; code: string; kind: string; priority: string; status: string; route: string; subject: string; target?: string; targetName?: string; group?: string; evidenceCount: number; ago: string }
export function Reports() {
  const [tab, setTab] = useState('all')
  const { data, loading, error } = useFetch<{ kpis: Record<string, number>; tabCounts: Record<string, number>; items: Item[] }>(`/reports?tab=${tab}`)
  if (loading && !data) return <Loading />
  if (error || !data) return <ErrorState error={error} />
  const k = data.kpis
  return (
    <Page>
      <PageHead title="Reports" sub="Reported messages routed to the right reviewer. You only see the messages the reporter included." />
      <div className="stats"><Stat label="Unresolved" value={k.unresolved} tone={k.unresolved ? 'warn' : 'good'} /><Stat label="SLA breach" value={k.slaBreach} tone={k.slaBreach ? 'bad' : 'good'} /><Stat label="Resolved (30 days)" value={k.resolved30d} /><Stat label="Median turnaround" value={`${k.medianTurnaroundHours}h`} /><Stat label="Escalated" value={k.escalatedToCdc} /></div>
      <Tabs value={tab} onChange={setTab} items={[{ id: 'all', label: 'All', count: data.tabCounts.all }, { id: 'custom', label: 'Custom groups', count: data.tabCounts.custom }, { id: 'class', label: 'Class', count: data.tabCounts.class }, { id: 'direct', label: 'Direct', count: data.tabCounts.direct }]} />
      <div className="tablewrap"><table className="table"><thead><tr><th>Report</th><th>Subject</th><th>Target</th><th>Where</th><th>Status</th><th /></tr></thead><tbody>
        {data.items.map((r) => <tr key={r.id}><td className="mono">#{r.code}{r.priority === 'HIGH' && <span className="badge badge--danger" style={{ marginLeft: 6 }}>High</span>}</td><td>{r.subject}</td><td>{r.targetName}<div className="mono muted" style={{ fontSize: 12 }}>{r.target}</div></td><td>{r.group}<div className="muted" style={{ fontSize: 12 }}>{r.evidenceCount} messages · {r.ago}</div></td><td><span className="badge">{r.status.replace('_', ' ')}</span></td><td><Link className="btn btn--quiet" to={`/reports/${r.id}`}>Open</Link></td></tr>)}
        {data.items.length === 0 && <tr><td colSpan={6} className="muted">No reports. When someone reports a message, it shows up here.</td></tr>}</tbody></table></div>
    </Page>
  )
}

export function ReportDetail() {
  const { id } = useParams(); const me = useAuth((s) => s.me)!; const nav = useNavigate(); const toast = useUi((s) => s.toast)
  const { data, loading, error, reload } = useFetch<any>(`/reports/${id}`)
  const [note, setNote] = useState('')
  if (loading && !data) return <Loading />
  if (error || !data) return <ErrorState error={error} />
  async function act(action: string) { try { const r = await api.post<{ outcome: string }>(`/reports/${id}/action`, { action, note: note || undefined }); toast(r.outcome); reload() } catch (e: any) { toast(e.meta?.reason ?? e.message, 'error') } }
  async function suspend() { if (!window.confirm(`Suspend ${data.target?.name}? Live sessions end immediately.`)) return; try { await api.post(`/reports/${id}/suspend`, { reason: `Disciplinary: ${data.code}` }); toast('Account suspended'); reload() } catch (e: any) { toast(e.meta?.reason ?? e.message, 'error') } }
  const closed = ['RESOLVED', 'DISMISSED'].includes(data.status)
  return (
    <Page narrow>
      <PageHead crumb="Reports" title={`Case #${data.code}`} sub={`${data.group ?? ''} · filed ${fmtStamp(data.createdAt)}`} actions={<><span className="badge">{data.status.replace('_', ' ')}</span><Link className="btn btn--secondary" to="/reports">Back</Link></>} />
      <Alert>You see only the {data.evidence.length} message{data.evidence.length === 1 ? '' : 's'} the reporter included. The rest of the conversation is not visible to reviewers.</Alert>
      <div className="formgrid" style={{ margin: '16px 0' }}>
        <div className="card"><div className="card__body"><span className="aside__label">Reported person</span><b>{data.target?.name}</b><span className="mono muted" style={{ fontSize: 12 }}>{data.target?.uid} · {data.target?.batch}</span><span style={{ color: data.target?.priorInfractions ? 'var(--danger)' : 'var(--ink-3)', fontSize: 13 }}>Prior infractions: {data.target?.priorInfractions ?? 0}</span></div></div>
        <div className="card"><div className="card__body"><span className="aside__label">Reporter</span><b>Protected</b><span className="mono muted" style={{ fontSize: 12 }}>{data.reporter?.uid} · {data.reporter?.batch}</span><span className="muted" style={{ fontSize: 13 }}>{data.reporter?.role}. Never revealed to the reported person.</span></div></div></div>
      {data.statement && <div className="card" style={{ marginBottom: 16 }}><div className="card__body"><span className="aside__label">Reporter's statement</span><p style={{ fontStyle: 'italic' }}>“{data.statement}”</p></div></div>}
      <h2 className="aside__label" style={{ marginBottom: 8 }}>Included messages</h2>
      <div className="stack" style={{ marginBottom: 24 }}>{data.evidence.map((e: any) => <div className="card" key={e.messageId}><div className="card__body"><div className="row row--between"><b>{e.senderName} <span className="mono muted" style={{ fontSize: 12 }}>{e.senderUid}</span></b><span className="mono muted" style={{ fontSize: 12 }}>{fmtStamp(e.at)}</span></div><p>“{e.body}”</p>{!closed && data.groupKind !== 'DIRECT' && <div><Button size="sm" variant="danger" onClick={async () => { try { await api.post(`/reports/${id}/action`, { action: 'remove', messageId: e.messageId, note: note || 'Removed after report review' }); toast('Message removed'); reload() } catch (x: any) { toast(x.meta?.reason ?? x.message, 'error') } }}>Remove this message</Button></div>}</div></div>)}</div>
      {closed ? <Alert>Closed: {data.outcome}</Alert> : (
        <div className="card"><div className="card__head">Decision</div><div className="card__body">
          <div className="field"><label className="field__label">Note (kept in the audit log)</label><textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></div>
          <div className="row" style={{ flexWrap: 'wrap' }}><Button onClick={() => act('dismiss')}>Dismiss report</Button><Button onClick={() => act('warn')}>Issue formal warning</Button><Button onClick={() => act('mute')}>Mute in group (24 h)</Button>{!me.capabilities.admin && <Button variant="danger" onClick={() => act('escalate')}>Escalate to Admin</Button>}{me.capabilities.admin && <Button variant="danger" onClick={suspend}>Suspend account</Button>}</div></div></div>)}
      {void nav}
    </Page>
  )
}
