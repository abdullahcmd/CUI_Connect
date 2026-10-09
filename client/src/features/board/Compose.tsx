import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, Button, Field, Page, PageHead, Loading } from '../../components/ui'
import { api } from '../../lib/api'
import { useFetch } from '../../lib/useFetch'
import { useUi } from '../../store/ui'
import { useAuth } from '../../store/auth'
import type { Attachment } from '../../lib/types'

interface Scopes { scopes: { id: string; type: string; code: string; name: string; audienceCount: number }[]; categories: string[] }
const TYPE_LABEL: Record<string, string> = { CAMPUS: 'University', DEPARTMENT: 'Department', PROGRAM: 'Program', BATCH: 'Batch' }

export default function Compose() {
  const { data, loading } = useFetch<Scopes>('/board/scopes')
  const me = useAuth((s) => s.me)!
  const nav = useNavigate()
  const toast = useUi((s) => s.toast)
  const [scopeId, setScopeId] = useState('')
  const [category, setCategory] = useState('GENERAL')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [files, setFiles] = useState<Attachment[]>([])
  const [effective, setEffective] = useState('')
  const [expires, setExpires] = useState('')
  const [pinned, setPinned] = useState(false)
  const [ackReq, setAckReq] = useState(false)
  const [forward, setForward] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (data && !scopeId) setScopeId(data.scopes[0]?.id ?? '') }, [data, scopeId])
  if (loading) return <Loading />
  if (!data?.scopes.length) return <Page narrow><PageHead title="Publish notice" sub="You don't publish to any board scope." /></Page>
  const scope = data.scopes.find((s) => s.id === scopeId)

  async function publish() {
    setBusy(true); setErr(null)
    try {
      const r = await api.post<{ id: string }>('/board', { scopeId, category, title, body, attachments: files, effectiveFrom: effective || undefined, expiresAt: expires || undefined, pinned, mandatoryAck: ackReq, forwardToCRs: forward })
      toast('Published'); nav(`/board/${r.id}`)
    } catch (e: any) { setErr(e.meta?.reason ?? e.message) } finally { setBusy(false) }
  }
  async function upload(list: FileList | null) { if (!list?.length) return; try { const r = await api.upload([...list]); setFiles((f) => [...f, ...r.files]) } catch (e: any) { toast(e.meta?.reason ?? e.message, 'error') } }

  return (
    <Page narrow>
      <PageHead crumb="Announcements" title="Publish notice" sub="Notices can be edited, with history, and removed within one hour. After that they can only be archived." />
      <div className="stack" style={{ gap: 20 }}>
        <div className="field"><span className="field__label">Who should see it</span>
          <div className="seg">{data.scopes.map((s) => <button key={s.id} aria-pressed={scopeId === s.id} onClick={() => setScopeId(s.id)}>{TYPE_LABEL[s.type] ?? s.type}: {s.code}<small>{s.name} · {s.audienceCount} people</small></button>)}</div></div>
        <div className="field"><span className="field__label">Category</span><div className="chips">{data.categories.map((c) => <button key={c} className="chip" style={{ cursor: 'pointer', boxShadow: category === c ? 'inset 0 0 0 2px var(--cui-blue)' : undefined }} onClick={() => setCategory(c)}>{c[0] + c.slice(1).toLowerCase()}</button>)}</div></div>
        <Field label="Title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} />
        <div className="field"><label className="field__label">Body</label><textarea className="input" rows={8} value={body} onChange={(e) => setBody(e.target.value)} /></div>
        <div className="field"><span className="field__label">Attachments (PDF or image, up to 10 MB)</span>
          {files.map((f) => <span className="file" key={f.url}>{f.name} <button onClick={() => setFiles((x) => x.filter((y) => y.url !== f.url))} aria-label="Remove">×</button></span>)}
          <input type="file" multiple accept="application/pdf,image/png,image/jpeg" onChange={(e) => upload(e.target.files)} /></div>
        <div className="formgrid"><Field label="Applies from" type="date" value={effective} onChange={(e) => setEffective(e.target.value)} /><Field label="Expires (optional)" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} /></div>
        <label className="checkrow"><input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} /><span>Pin to the top<small>Up to 3 pinned notices per scope.</small></span></label>
        <label className="checkrow"><input type="checkbox" checked={ackReq} onChange={(e) => setAckReq(e.target.checked)} /><span>Require acknowledgement<small>Readers press Acknowledge, and you see who hasn't.</small></span></label>
        {me.capabilities.forwardBoard && <label className="checkrow"><input type="checkbox" checked={forward} onChange={(e) => setForward(e.target.checked)} /><span>Forward to the CRs group<small>CRs can then relay it to their classes.</small></span></label>}
        {err && <Alert tone="error">{err}</Alert>}
        <div className="row"><Button onClick={() => nav('/board')}>Cancel</Button><Button variant="primary" loading={busy} disabled={title.trim().length < 3} onClick={publish}>Publish to {scope?.audienceCount ?? 0} people</Button></div>
      </div>
    </Page>
  )
}
