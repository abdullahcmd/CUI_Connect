import { useState } from 'react'
import { MessageSquareReply, MoreHorizontal, Pin, Pencil, SmilePlus, Trash2, Flag, FileText, Send, ThumbsUp } from 'lucide-react'
import { Avatar, Button, RoleBadge } from '../../components/ui'
import { fileHref } from '../../lib/api'
import { fmtSize, fmtTime, isUrdu } from '../../lib/format'
import type { Message } from '../../lib/types'
import { emit } from '../../lib/socket'
import { useUi } from '../../store/ui'
import { useChat } from '../../store/chat'
import { useClickAway } from '../../components/layout/useClickAway'
import { useRef } from 'react'

export interface RowCtx {
  meId: string; managers: Set<string>; canRelay: boolean; isModerator: boolean; groupId: string
  onRelay: (m: Message) => void; onReport: (m: Message) => void; onThread: (m: Message) => void; inThread?: boolean
}

const QUICK = ['👍', '✅', '🙏']

export function MessageRow({ m, first, ctx }: { m: Message; first: boolean; ctx: RowCtx }) {
  const own = m.sender.id === ctx.meId
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(m.body)
  const [menu, setMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  useClickAway(menuRef, () => setMenu(false))
  const toast = useUi((s) => s.toast)
  const retry = useChat((s) => s.retry)
  const manager = ctx.managers.has(m.sender.id)
  const urdu = isUrdu(m.body)

  async function react(emoji: string) { const r = await emit('message:react', { messageId: m.id, emoji }); if (!r.ok) toast(r.message ?? "Couldn't react.", 'error') }
  async function saveEdit() {
    const r = await emit('message:edit', { messageId: m.id, body: draft })
    if (!r.ok) return toast(r.meta?.reason ?? 'Messages can be edited for 15 minutes.', 'error')
    setEditing(false)
  }
  async function remove() {
    const reason = own ? undefined : window.prompt('Reason for removing this message (the author is told):') ?? ''
    if (!own && !reason) return
    const r = await emit('message:delete', { messageId: m.id, reason })
    if (!r.ok) toast(r.message ?? "Couldn't remove.", 'error')
  }
  async function pin() { const r = await emit('message:pin', { messageId: m.id }); r.ok ? toast(r.data.pinned ? 'Pinned' : 'Unpinned') : toast(r.meta?.reason ?? "Couldn't pin.", 'error') }

  if (m.deleted) return (
    <div className={`msg ${first ? 'msg--first' : ''}`}><span className="msg__gutter" /><div style={{ width: 32 }} /><div className="msg__main"><span className="msg__deleted">Message removed{m.deleteReason ? ` by a moderator — ${m.deleteReason}` : ''}</span></div></div>
  )

  const quoted = !!m.relayOf
  const body = m.kind === 'DIRECTIVE' ? (
    <div className="msg__directive"><div className="msg__directive-label">Directive</div>{m.body}</div>
  ) : <div className="msg__body" dir={urdu ? 'rtl' : undefined} lang={urdu ? 'ur' : undefined}>{m.body}</div>

  return (
    <div className={`msg ${first ? 'msg--first' : ''} ${own ? 'msg--own' : ''} ${manager ? 'msg--manager' : ''} ${m.pending ? 'msg--pending' : ''}`} data-id={m.id}>
      {first ? <Avatar name={m.sender.name} initials={m.sender.initials} dept={m.sender.dept} /> : <span className="msg__gutter">{fmtTime(m.createdAt)}</span>}
      <div className="msg__main">
        {first && (
          <div className="msg__head">
            <span className="msg__name">{m.sender.name}</span>
            {(m.sender.badges ?? []).map((b) => <RoleBadge key={b} label={b} />)}
            {manager && <span className="badge badge--manager">Manager</span>}
            {m.postedAs && !['RELAY', 'FORWARD', 'NUDGE'].includes(m.postedAs) && !(m.sender.badges ?? []).includes(m.postedAs) && <span className="badge">As {m.postedAs}</span>}
            {m.sender.course && <span className="msg__course">{m.sender.course}</span>}
            <span className="msg__time">{fmtTime(m.createdAt)}</span>
          </div>
        )}
        {quoted && <div className="msg__relayed-from">Relayed from CR line · {m.relayOf!.sourceName}{m.relayOf!.course ? ` (${m.relayOf!.course})` : ''}</div>}
        {m.forwardOf && <div className="msg__relayed-from">Forwarded from the Announcement Board</div>}
        {editing ? (
          <div className="msg__edit">
            <textarea className="input" value={draft} rows={3} onChange={(e) => setDraft(e.target.value)} autoFocus onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit() } if (e.key === 'Escape') setEditing(false) }} />
            <div style={{ display: 'flex', gap: 8 }}><Button size="sm" variant="primary" onClick={saveEdit}>Save</Button><Button size="sm" onClick={() => { setEditing(false); setDraft(m.body) }}>Cancel</Button></div>
          </div>
        ) : quoted ? <div className="msg__quote">{body}</div> : body}
        {m.editedAt && !editing && <span className="msg__state"> (edited)</span>}
        {m.attachments.length > 0 && (
          <div className="msg__files">{m.attachments.map((a) => (
            <a key={a.url} className="file" href={fileHref(a.url)} target="_blank" rel="noreferrer"><FileText size={16} strokeWidth={1.5} />{a.name}<small>{[a.label, fmtSize(a.size)].filter(Boolean).join(' · ')}</small></a>
          ))}</div>
        )}
        {m.relayedTo.length > 0 && m.relayedTo.map((r) => <div key={r.groupId} className="msg__relayed-to">Relayed to {r.groupName.replace(' Class', '')} by {r.byName} · {fmtTime(r.at)}</div>)}
        {m.reactions.length > 0 && <div className="msg__reactions">{m.reactions.map((r) => <button key={r.emoji} className="react" data-mine={r.mine} onClick={() => react(r.emoji)}>{r.emoji} {r.count}</button>)}</div>}
        {!ctx.inThread && m.threadCount > 0 && <button className="msg__thread" onClick={() => ctx.onThread(m)}>{m.threadCount} {m.threadCount === 1 ? 'reply' : 'replies'}</button>}
        {m.pending && <span className="msg__state">Sending…</span>}
        {m.failed && <div className="msg__state msg__state--failed">Not sent · {m.failed} · <button className="btn btn--quiet" style={{ fontSize: 12, color: 'var(--danger)' }} onClick={() => m.clientId && retry(ctx.groupId, m.clientId)}>Retry</button></div>}
      </div>
      {!m.pending && !m.failed && !editing && (
        <div className="msg__actions" role="toolbar" aria-label="Message actions">
          {QUICK.slice(0, 1).map((e) => <Button key={e} variant="icon" aria-label={`React ${e}`} onClick={() => react(e)}><ThumbsUp size={15} strokeWidth={1.5} /></Button>)}
          {!ctx.inThread && <Button variant="icon" aria-label="Reply in thread" onClick={() => ctx.onThread(m)}><MessageSquareReply size={15} strokeWidth={1.5} /></Button>}
          {ctx.canRelay && !m.relayOf && !own && <Button variant="icon" className="relay" aria-label="Relay to class" onClick={() => ctx.onRelay(m)}><Send size={14} strokeWidth={1.5} /> Relay to class</Button>}
          <div ref={menuRef} style={{ position: 'relative' }}>
            <Button variant="icon" aria-label="More" onClick={() => setMenu((x) => !x)}><MoreHorizontal size={16} strokeWidth={1.5} /></Button>
            {menu && (
              <div className="menu" style={{ right: 0, top: 30 }} onClick={() => setMenu(false)}>
                {QUICK.slice(1).map((e) => <button key={e} className="menu__item" onClick={() => react(e)}><SmilePlus size={15} strokeWidth={1.5} /> React {e}</button>)}
                {ctx.isModerator && !ctx.inThread && <button className="menu__item" onClick={pin}><Pin size={15} strokeWidth={1.5} /> {m.pinned ? 'Unpin' : 'Pin'}</button>}
                {own && <button className="menu__item" onClick={() => setEditing(true)}><Pencil size={15} strokeWidth={1.5} /> Edit</button>}
                {(own || ctx.isModerator) && <button className="menu__item menu__item--danger" onClick={remove}><Trash2 size={15} strokeWidth={1.5} /> Remove</button>}
                {!own && <button className="menu__item" onClick={() => ctx.onReport(m)}><Flag size={15} strokeWidth={1.5} /> Report</button>}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
