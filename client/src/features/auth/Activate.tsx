import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { AuthLayout } from './AuthLayout'
import { Alert, Button, Field } from '../../components/ui'
import { api, ApiError } from '../../lib/api'
import { useAuth } from '../../store/auth'

export const passwordRules = (pw: string, uid = '') => [
  { ok: pw.length >= 10, text: 'At least 10 characters' },
  { ok: !uid || !pw.toLowerCase().includes(uid.toLowerCase()), text: 'Does not contain your ID' },
  { ok: /[A-Za-z]/.test(pw) && /\d/.test(pw), text: 'Letters and numbers' },
]

export default function Activate() {
  const { status, me, boot, logout } = useAuth()
  const nav = useNavigate()
  const [cur, setCur] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [ok, setOk] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (status === 'anon') return <Navigate to="/login" replace />
  if (status === 'authed') return <Navigate to={me!.landing} replace />
  const rules = passwordRules(pw, me?.user.uid)
  const valid = cur && rules.every((r) => r.ok) && pw === pw2 && ok

  async function submit(e: FormEvent) {
    e.preventDefault(); setErr(null); setBusy(true)
    try {
      await api.post('/auth/activate', { currentPassword: cur, newPassword: pw, acceptPolicy: true })
      await boot()
      nav(useAuth.getState().me!.landing, { replace: true })
    } catch (ex) { setErr(ex instanceof ApiError ? (ex.meta?.reason ?? ex.message) : 'Could not reach the server.') } finally { setBusy(false) }
  }

  return (
    <AuthLayout>
      <div className="auth__head">
        <h1>Choose your password</h1>
        <p>Welcome, {me?.user.name.split(' ')[0]}. Replace the temporary password to finish setting up.</p>
      </div>
      <form className="auth__form" onSubmit={submit} noValidate>
        <Field label="Temporary password" reveal autoFocus autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} />
        <Field label="New password" reveal autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
        <ul className="auth__rules">{rules.map((r) => <li key={r.text} data-ok={r.ok}>{r.text}</li>)}</ul>
        <Field label="Confirm new password" reveal autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} error={pw2 && pw !== pw2 ? 'Passwords do not match.' : undefined} />
        <label className="auth__check"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} /> I accept the university IT usage policy. Messages are logged for compliance.</label>
        {err && <Alert tone="error">{err}</Alert>}
        <Button variant="primary" type="submit" block loading={busy} disabled={!valid}>Activate account</Button>
      </form>
      <div className="auth__foot"><button className="btn btn--quiet" style={{ alignSelf: 'flex-start' }} onClick={() => logout()}>Sign out</button></div>
    </AuthLayout>
  )
}
