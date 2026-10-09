import { useState } from 'react'
import { Link } from 'react-router-dom'
import { FileText } from 'lucide-react'
import { Alert, Button, ErrorState, Field, Loading, Page, PageHead, Progress, Stat, Tabs } from '../../components/ui'
import { Dialog } from '../chat/dialogs'
import { api, fileHref } from '../../lib/api'
import { useFetch } from '../../lib/useFetch'
import { useUi } from '../../store/ui'

interface Gazette { id: string; number: number; refNo: string; title: string; body: string; targetAudience?: string; digestShort?: string; signatureVerified: boolean; streamState: string; ackCount: number; audienceCount: number; pending: number; progressPercent: number; attachments: { url: string; name: string }[]; createdAt: string }
interface Console { header: { code: string; title: string }; kpis: { activeCirculars: { count: number; queued: number }; overallAckRate: { percent: number; acked: number; roster: number }; examWindow: { label?: string; session?: string; countdown?: string }; auditRepository: { status?: string; vault?: string; registryKey?: string } }; ledger: Gazette[]; protocol?: { title: string; body: string }; token?: { slot: string; signatory: string; publicKeyExpires: string }; halls: { name: string; seats: number; capacity: number }[]; contacts: { name: string; ext: string; person: string }[] }

export default function Exam() {
  const [filter, setFilter] = useState<'ALL' | 'ACTIVE' | 'ARCHIVED'>('ALL')
  const { data, loading, error, reload } = useFetch<Console>(`/exam/console?filter=${filter}`)
  const [dispatch, setDispatch] = useState(false); const [bd, setBd] = useState<any>(null); const toast = useUi((s) => s.toast)
  if (loading && !data) return <Loading />
  if (error || !data) return <ErrorState error={error} />
  const k = data.kpis
  async function remind(id: string) { try { const r = await api.post<{ reminded: number }>(`/exam/circulars/${id}/remind`); toast(`Reminder sent to ${r.reminded} students`) } catch (e: any) { toast(e.message, 'error') } }
  async function breakdown(id: string) { setBd(await api.get(`/exam/circulars/${id}/breakdown`)) }
  async function keypad() { const token = window.prompt('Enter the signing token slot code to validate the keypad:'); if (!token) return; const r = await api.post<{ ok: boolean; signatory: string; slot: string }>('/exam/keypad/validate', { token }); toast(r.ok ? `Keypad valid · ${r.slot} · ${r.signatory}` : 'Token not recognised', r.ok ? 'info' : 'error') }
  return (
    <Page>
      <PageHead crumb={data.header.code} title="Examination Cell" sub="Gazette and circular publishing, hall ticket rollouts and acknowledgement tracking." actions={<><Button onClick={keypad}>Validate keypad</Button><Button variant="primary" onClick={() => setDispatch(true)}>Draft and dispatch circular</Button></>} />
      <div className="stats">
        <Stat label="Active circulars" value={String(k.activeCirculars.count).padStart(2, '0')} sub={`${k.activeCirculars.queued} queued for registrar seal`} />
        <Stat label="Overall acknowledgement" value={`${k.overallAckRate.percent}%`} sub={`${k.overallAckRate.acked} of ${k.overallAckRate.roster} on the roster`} tone="good" />
        <Stat label="Examination window" value={k.examWindow.label ?? '—'} sub={`${k.examWindow.session ?? ''} · ${k.examWindow.countdown ?? ''}`} />
        <Stat label="Audit repository" value={k.auditRepository.status ?? '—'} sub={`${k.auditRepository.vault ?? ''} · ${k.auditRepository.registryKey ?? ''}`} />
      </div>
      <div className="grid2">
        <div>
          <Tabs value={filter} onChange={setFilter} items={[{ id: 'ALL', label: 'All' }, { id: 'ACTIVE', label: 'Active' }, { id: 'ARCHIVED', label: 'Archived' }]} />
          <div className="stack" style={{ gap: 16 }}>{data.ledger.map((g) => (
            <article className="bpost" key={g.id}>
              <div className="bpost__scope">Gazette notice #{String(g.number).slice(-2)} · Doc ref {g.refNo}</div>
              <span className="bpost__cat" style={{ color: g.streamState.startsWith('ACTIVE') ? 'var(--st-resolved)' : 'var(--ink-3)' }}>{g.streamState}{g.signatureVerified ? ' · Signature verified' : ''}</span>
              <h2 className="bpost__title"><Link to={`/board/${g.id}`}>{g.title}</Link></h2>
              <p className="bpost__body">{g.body}</p>
              {g.targetAudience && <span className="badge">{g.targetAudience}</span>}
              <div><div className="row row--between mono" style={{ fontSize: 12 }}><span>Acknowledgement progress</span><span>{g.ackCount} of {g.audienceCount} ({g.progressPercent}%)</span></div><Progress pct={g.progressPercent} tone={g.progressPercent >= 90 ? 'good' : undefined} /><div className="muted mono" style={{ fontSize: 12, marginTop: 4 }}>{g.pending} pending confirmations</div></div>
              <div className="row" style={{ flexWrap: 'wrap' }}>{g.attachments[0] && <a className="btn btn--secondary btn--sm" href={fileHref(g.attachments[0].url)} target="_blank" rel="noreferrer"><FileText size={14} /> Download signed PDF</a>}<Button size="sm" onClick={() => breakdown(g.id)}>View batch breakdown</Button>{g.streamState.startsWith('ACTIVE') && <Button size="sm" variant="primary" onClick={() => remind(g.id)}>Send reminder ping</Button>}</div>
            </article>))}</div>
        </div>
        <aside className="aside">
          {data.protocol && <div className="dl"><b>{data.protocol.title}</b><span>{data.protocol.body}</span></div>}
          {data.token && <dl className="kv" style={{ gridTemplateColumns: '110px 1fr' }}><dt>Hardware token</dt><dd className="mono">{data.token.slot}</dd><dt>Active signatory</dt><dd>{data.token.signatory}</dd><dt>Public key exp.</dt><dd className="mono">{data.token.publicKeyExpires}</dd></dl>}
          <div className="aside__sec"><span className="aside__label">Direct inquiries desk</span>{data.contacts.map((c) => <div className="dl" key={c.name}><b>{c.name}</b><small>Ext. {c.ext} · {c.person}</small></div>)}</div>
          <div className="aside__sec"><span className="aside__label">Real-time hall capacity</span>{data.halls.map((h) => <div key={h.name}><div className="row row--between" style={{ fontSize: 13 }}><span>{h.name}</span><span className="mono">{h.seats} / {h.capacity}</span></div><Progress pct={(h.seats / h.capacity) * 100} tone={h.seats / h.capacity > 0.9 ? 'bad' : undefined} /></div>)}</div>
        </aside>
      </div>
      {dispatch && <Dispatch onClose={() => setDispatch(false)} onDone={() => { setDispatch(false); reload() }} />}
      {bd && <Dialog title="Batch breakdown" onClose={() => setBd(null)}><div className="tablewrap"><table className="table"><thead><tr><th>Cohort</th><th>Receipts</th><th>Rate</th></tr></thead><tbody>{bd.cohorts.map((c: any) => <tr key={c.code}><td className="mono">{c.code}</td><td className="mono">{c.acked} / {c.total}</td><td className="mono" style={{ color: c.status === 'LAG' ? 'var(--danger)' : undefined }}>{c.rate}% {c.status}</td></tr>)}</tbody></table></div></Dialog>}
    </Page>
  )
}

function Dispatch({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ title: '', body: '', batches: '', audience: 'All Undergraduate Batches' }); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false); const toast = useUi((s) => s.toast)
  async function go() { setBusy(true); try { const r = await api.post<{ audienceCount: number }>('/exam/circulars', { title: f.title, body: f.body, audienceLabel: f.audience, batchCodes: f.batches.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean), mandatoryAck: true }); toast(`Dispatched to ${r.audienceCount} students`); onDone() } catch (e: any) { setErr(e.meta?.reason ?? e.message) } finally { setBusy(false) } }
  return (
    <Dialog title="Draft and dispatch circular" onClose={onClose} actions={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={f.title.length < 3 || !f.body} onClick={go}>Dispatch</Button></>}>
      <Field label="Subject" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
      <div className="field"><label className="field__label">Text</label><textarea className="input" rows={6} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></div>
      <Field label="Target batches (blank = everyone)" placeholder="FA23-BCS, SP23-BCS" value={f.batches} onChange={(e) => setF({ ...f, batches: e.target.value })} />
      <Field label="Audience label" value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value })} />
      <Alert>Gazettes are signed when dispatched. They can be edited for 60 minutes, then they are locked in the ledger.</Alert>{err && <Alert tone="error">{err}</Alert>}
    </Dialog>
  )
}
