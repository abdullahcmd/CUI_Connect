import { useRef, useState, type KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import { Paperclip, X, Send, FileText } from 'lucide-react'
import { Button } from '../../components/ui'
import { api } from '../../lib/api'
import { emit } from '../../lib/socket'
import { useChat } from '../../store/chat'
import { useUi } from '../../store/ui'
import type { Attachment, Composer as ComposerState } from '../../lib/types'

export function Composer({ groupId, name, state, threadOf, placeholder }: { groupId: string; name: string; state: ComposerState; threadOf?: string; placeholder?: string }) {
  const [text, setText] = useState('')
  const [files, setFiles] = useState<Attachment[]>([])
  const [busy, setBusy] = useState(false)
  const last = useRef(0)
  const input = useRef<HTMLInputElement>(null)
  const send = useChat((s) => s.send)
  const toast = useUi((s) => s.toast)

  // boundary state: a sentence that says who can post, never a bare disabled control
  if (!state.canPost) return (
    <div className="composer"><div className="composer--blocked" role="note">
      <span>{state.message ?? 'You cannot post here.'}</span>
      {state.deskLink && <Link className="btn btn--primary btn--sm" to={`/desks/${state.deskLink.slug}`}>{state.deskLink.label}</Link>}
    </div></div>
  )

  function typing() {
    const now = Date.now()
    if (now - last.current > 2500) { last.current = now; emit('typing', { groupId, state: 'start' }) }
  }
  async function pick(list: FileList | null) {
    if (!list?.length) return
    setBusy(true)
    try { const r = await api.upload([...list]); setFiles((f) => [...f, ...r.files].slice(0, 5)) } catch (e: any) { toast(e.meta?.reason ?? e.message, 'error') } finally { setBusy(false); if (input.current) input.current.value = '' }
  }
  function submit() {
    const body = text.trim()
    if (!body && !files.length) return
    send(groupId, body, { attachments: files, threadOf })
    setText(''); setFiles([]); last.current = 0
  }
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit() } }

  return (
    <div className="composer">
      {state.prefix && <div className="composer__prefix"><b>{state.prefix}</b></div>}
      <div className="composer__box">
        {files.length > 0 && <div className="composer__files">{files.map((f) => <span className="file" key={f.url}><FileText size={14} strokeWidth={1.5} />{f.name}<button aria-label={`Remove ${f.name}`} onClick={() => setFiles((x) => x.filter((y) => y.url !== f.url))}><X size={14} /></button></span>)}</div>}
        <textarea rows={1} value={text} placeholder={placeholder ?? `Message ${name}`} aria-label={`Message ${name}`}
          onChange={(e) => { setText(e.target.value); typing(); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px' }} onKeyDown={onKey} />
        <div className="composer__bar">
          <div>
            <input ref={input} type="file" hidden multiple accept="application/pdf,image/png,image/jpeg" onChange={(e) => pick(e.target.files)} />
            <Button variant="icon" aria-label="Attach a file" onClick={() => input.current?.click()} loading={busy}><Paperclip size={16} strokeWidth={1.5} /></Button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className="composer__hint">Enter to send · Shift+Enter for a new line</span>
            <Button variant="primary" size="sm" onClick={submit} disabled={!text.trim() && !files.length}><Send size={14} strokeWidth={1.5} /> Send</Button>
          </div>
        </div>
      </div>
    </div>
  )
}
