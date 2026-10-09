import { forwardRef, useId, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react'
import './ui.css'

export function Button({ variant = 'secondary', size, block, loading, children, className = '', ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'quiet' | 'danger' | 'icon'; size?: 'sm'; block?: boolean; loading?: boolean }) {
  return (
    <button className={`btn btn--${variant} ${size ? `btn--${size}` : ''} ${block ? 'btn--block' : ''} ${className}`} disabled={p.disabled || loading} {...p}>
      {loading && <span className="spinner" aria-hidden />}{children}
    </button>
  )
}

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> { label: string; help?: ReactNode; error?: string; mono?: boolean; aside?: ReactNode; reveal?: boolean }
export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field({ label, help, error, mono, aside, reveal, type, className = '', ...p }, ref) {
  const id = useId()
  const [shown, setShown] = useState(false)
  const input = <input ref={ref} id={id} className={`input ${mono ? 'input--mono' : ''} ${className}`} aria-invalid={!!error} aria-describedby={`${id}-d`} type={reveal ? (shown ? 'text' : 'password') : type} {...p} />
  return (
    <div className="field">
      <div className="field__row"><label className="field__label" htmlFor={id}>{label}</label>{aside}</div>
      {reveal ? <div className="input-wrap">{input}<button type="button" className="input-wrap__toggle" onClick={() => setShown((s) => !s)}>{shown ? 'Hide' : 'Show'}</button></div> : input}
      <div id={`${id}-d`}>{error ? <p className="field__error" role="alert">{error}</p> : help ? <p className="field__help">{help}</p> : null}</div>
    </div>
  )
})

export const Alert = ({ tone = 'info', children }: { tone?: 'info' | 'error'; children: ReactNode }) => <div className={`alert alert--${tone}`} role={tone === 'error' ? 'alert' : 'status'}>{children}</div>

export function Avatar({ name, initials, dept, size, online }: { name?: string; initials?: string; dept?: string; size?: 24 | 40; online?: boolean }) {
  const t = initials ?? (name ?? '').replace(/^(Dr\.|Prof\.|Engr\.)\s*/i, '').split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()
  const d = (dept ?? '').toLowerCase()
  const cls = ['cs', 'ee', 'ms'].includes(d) ? `avatar--${d}` : ''
  return <span className={`avatar ${size ? `avatar--${size}` : ''} ${cls}`} aria-hidden>{t}{online && <span className="avatar__presence" />}</span>
}

const OFFICIAL = ['ADMIN OFFICE', 'CAMPUS INCHARGE', 'STUDENT AFFAIRS', 'SUPER ADMIN', 'EXAM CELL']
export const RoleBadge = ({ label }: { label: string }) => <span className={`badge ${OFFICIAL.includes(label) ? 'badge--official' : ''}`}>{label}</span>
export const Spinner = () => <span className="spinner" role="status" aria-label="Loading" />

import { Link, type LinkProps } from 'react-router-dom'
import '../page.css'

export function Page({ children, narrow }: { children: ReactNode; narrow?: boolean }) {
  return <div className="page"><div className={`page__in ${narrow ? 'page__in--narrow' : ''}`}>{children}</div></div>
}
export function PageHead({ title, sub, crumb, actions }: { title: string; sub?: ReactNode; crumb?: string; actions?: ReactNode }) {
  return <div className="page__head"><div>{crumb && <div className="page__crumb">{crumb}</div>}<h1>{title}</h1>{sub && <p>{sub}</p>}</div>{actions && <div className="page__actions">{actions}</div>}</div>
}
export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'warn' | 'bad' | 'good' }) {
  return <div className={`stat ${tone ? `stat--${tone}` : ''}`}><div className="stat__label">{label}</div><div className="stat__value">{value}</div>{sub && <div className="stat__sub">{sub}</div>}</div>
}
export const Status = ({ s }: { s: string }) => <span className={`status status--${s.toLowerCase()}`}>{s.replace('_', ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase())}</span>
export const Progress = ({ pct, tone }: { pct: number; tone?: 'good' | 'bad' }) => <div className={`progress ${tone ? `progress--${tone}` : ''}`}><i style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} /></div>
export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { id: T; label: string; count?: number }[] }) {
  return <div className="tabs" role="tablist">{items.map((i) => <button key={i.id} role="tab" aria-selected={value === i.id} onClick={() => onChange(i.id)}>{i.label}{i.count != null && <span className="count">{i.count}</span>}</button>)}</div>
}
export const LinkButton = ({ variant = 'secondary', ...p }: LinkProps & { variant?: 'primary' | 'secondary' | 'quiet' }) => <Link className={`btn btn--${variant}`} {...p} />
export function ErrorState({ error }: { error: { message: string; code?: string } | null }) {
  return <div className="state"><h2>{error?.code === 'NOT_FOUND' ? 'Not found' : "You can't open this"}</h2><p>{error?.message}</p><Link className="btn btn--secondary" to="/home">Go home</Link></div>
}
export function Loading() { return <div className="state"><Spinner /></div> }
