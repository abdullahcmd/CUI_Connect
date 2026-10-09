import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Button, Alert, Field } from '../../components/ui'
import { api } from '../../lib/api'
import { emit } from '../../lib/socket'
import { useUi } from '../../store/ui'
import { useAuth } from '../../store/auth'
import type { Message, PersonCard } from '../../lib/types'

export function Dialog({ title, onClose, children, actions }: { title: string; onClose: () => void; children: React.ReactNode; actions?: React.ReactNode }) {
  useEffect(() => { const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h) }, [onClose])
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title}>
        <h2 className="dialog__title">{title}</h2>
        {children}
        {actions && <div className="dialog__actions">{actions}</div>}
      </div>
    </div>
  )
}

export function RelayDialog({ message, target, onClose }: { message: Message; target: { id: string; name: string }; onClose: () => void }) {
  const [note, setNote] = useState('')
  const [warn, setWarn] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const toast = useUi((s) => s.toast)
  async function go(confirm = false) {
    setBusy(true)
    const r = await emit('message:relay', { messageId: message.id, toGroupId: target.id, note: note || undefined, confirm })
    setBusy(false)
    if (r.ok) { toast(`Relayed to ${target.name}`); return onClose() }
    if (r.code === 'CONFLICT' && r.meta?.reason === 'ALREADY_RELAYED') return setWarn(r.meta.message)
    toast(r.meta?.message ?? r.message ?? 'Could not relay.', 'error')
  }
  return (
    <Dialog title="Relay to class" onClose={onClose} actions={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => go(!!warn)}>{warn ? 'Relay anyway' : 'Relay'}</Button></>}>
      <div className="msg__quote" style={{ borderLeft: '3px solid var(--official)', paddingLeft: 12 }}><b style={{ font: '500 13px/18px var(--font-sans)' }}>{message.sender.name}</b><div style={{ whiteSpace: 'pre-wrap' }}>{message.body}</div></div>
      <div className="field"><label className="field__label">Add a note (optional)</label><textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></div>
      <p className="field__help">Goes to <b>{target.name}</b>. Students see it marked as relayed from the CR line.</p>
      {warn && <Alert>{warn}. Relay it again?</Alert>}
    </Dialog>
  )
}

export function ReportDialog({ message, onClose }: { message: Message; onClose: () => void }) {
  const [reason, setReason] = useState('harassment')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useUi((s) => s.toast)
  async function go() {
    setBusy(true)
    try { await api.post(`/messages/${message.id}/report`, { reason, note: note || undefined }); toast('Report sent. You will be told the outcome.'); onClose() }
    catch (e: any) { toast(e.message, 'error') } finally { setBusy(false) }
  }
  return (
    <Dialog title="Report message" onClose={onClose} actions={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={go}>Send report</Button></>}>
      <p className="field__help">Only this message is shared with the reviewer. The person you report is not told who reported.</p>
      <div className="msg__quote" style={{ borderLeft: '3px solid var(--rule-strong)', paddingLeft: 12 }}>{message.body}</div>
      <div className="field"><label className="field__label">Reason</label>
        <select className="input" value={reason} onChange={(e) => setReason(e.target.value)}><option value="harassment">Harassment</option><option value="spam">Spam</option><option value="inappropriate">Inappropriate</option><option value="other">Other</option></select></div>
      <div className="field"><label className="field__label">Note (optional)</label><textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></div>
    </Dialog>
  )
}

type Person = PersonCard & { dm: { allowed: boolean; route?: { type: string; message: string; userId?: string; deskSlug?: string } } }

function usePeople(q: string) {
  const [people, setPeople] = useState<Person[]>([])
  useEffect(() => { const t = setTimeout(() => api.get<Person[]>(`/people?q=${encodeURIComponent(q)}&limit=30`).then(setPeople).catch(() => {}), 200); return () => clearTimeout(t) }, [q])
  return people
}

import { Avatar } from '../../components/ui'
export function PersonLine({ p }: { p: PersonCard }) {
  return <><Avatar name={p.name} initials={p.initials} dept={p.dept} /><div className="pick__main"><b>{p.name}</b> {p.badges.map((b) => <span key={b} className="badge" style={{ marginLeft: 4 }}>{b}</span>)}<br /><span style={{ color: 'var(--ink-3)' }}><span className="mono">{p.uid}</span>{p.designation ? ` · ${p.designation}` : ''}</span></div></>
}

export function NewMessageDialog({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('')
  const people = usePeople(q)
  const nav = useNavigate()
  const toast = useUi((s) => s.toast)
  async function start(p: Person) {
    const r = await emit('dm:open', { userId: p.id })
    if (!r.ok) return toast(r.meta?.route?.message ?? 'You cannot message this person.', 'error')
    onClose(); nav(`/g/${r.data.groupId}`)
  }
  return (
    <Dialog title="New message" onClose={onClose}>
      <Field label="To" autoFocus placeholder="Search by name or ID" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="picker">
        {people.map((p) => p.dm.allowed ? (
          <button key={p.id} className="pick" onClick={() => start(p)}><PersonLine p={p} /></button>
        ) : (
          <div key={p.id} className="pick pick--off"><PersonLine p={p} /><span className="badge">Not allowed</span>
            <div className="pick__why">{p.dm.route?.message ?? 'Direct messages are not allowed between these roles.'}
              {p.dm.route?.type === 'CR' && p.dm.route.userId && <> <button className="btn btn--quiet" style={{ fontSize: 12 }} onClick={() => start({ ...p, id: p.dm.route!.userId! })}>Message your CR</button></>}
              {p.dm.route?.type === 'DESK' && p.dm.route.deskSlug && <> <Link className="btn btn--quiet" style={{ fontSize: 12 }} to={`/desks/${p.dm.route.deskSlug}`} onClick={onClose}>Open the desk</Link></>}
            </div></div>
        ))}
        {people.length === 0 && <p className="field__help">No one found.</p>}
      </div>
    </Dialog>
  )
}

export function CreateGroupDialog({ onClose }: { onClose: () => void }) {
  const me = useAuth((x) => x.me?.user)
  const [name, setName] = useState('')
  const [purpose, setPurpose] = useState('')
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<Person[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const people = usePeople(q)
  const nav = useNavigate()
  const toast = useUi((s) => s.toast)
  const isStudent = me?.kind === 'STUDENT'
  const limit = isStudent ? 15 : 50
  async function go() {
    setBusy(true); setErr(null)
    try {
      const r = await api.post<{ id: string }>('/groups', { name, purpose, memberIds: picked.map((p) => p.id) })
      toast(`${name} created`); onClose(); nav(`/g/${r.id}`)
    } catch (e: any) { setErr(e.meta?.reason ?? e.message) } finally { setBusy(false) }
  }
  return (
    <Dialog title="Create a group" onClose={onClose} actions={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!name.trim()} onClick={go}>Create group</Button></>}>
      <p className="field__help">{isStudent ? 'Students can add classmates only (up to 15 people, 5 groups).' : 'You can add people you are allowed to message (up to 50).'}</p>
      <Field label="Name" value={name} maxLength={64} onChange={(e) => setName(e.target.value)} autoFocus />
      <div className="field"><label className="field__label">Purpose</label><textarea className="input" rows={2} value={purpose} onChange={(e) => setPurpose(e.target.value)} /></div>
      {picked.length > 0 && <div className="chips">{picked.map((p) => <span key={p.id} className="chip">{p.name}<button aria-label={`Remove ${p.name}`} onClick={() => setPicked((x) => x.filter((y) => y.id !== p.id))}>×</button></span>)}</div>}
      <Field label={`Add people (${picked.length + 1}/${limit})`} placeholder="Search by name or ID" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="picker">
        {people.filter((p) => p.dm.allowed && !picked.some((x) => x.id === p.id)).map((p) => <button key={p.id} className="pick" onClick={() => setPicked((x) => [...x, p])}><PersonLine p={p} /></button>)}
      </div>
      {err && <Alert tone="error">{err}</Alert>}
    </Dialog>
  )
}
