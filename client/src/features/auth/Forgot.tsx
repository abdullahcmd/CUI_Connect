import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AuthLayout } from './AuthLayout'
import { passwordRules } from './Activate'
import { Alert, Button, Field } from '../../components/ui'
import { api, ApiError } from '../../lib/api'

export default function Forgot() {
  const nav = useNavigate()
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1)
  const [uid, setUid] = useState('')
  const [code, setCode] = useState('')
  const [token, setToken] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const run = (fn: () => Promise<void>) => async (e: FormEvent) => {
    e.preventDefault(); setErr(null); setBusy(true)
    try { await fn() } catch (ex) { setErr(ex instanceof ApiError ? (ex.meta?.reason ?? ex.message) : 'Could not reach the server.') } finally { setBusy(false) }
  }
  const rules = passwordRules(pw, uid)

  return (
    <AuthLayout>
      {step < 4 && <div className="auth__steps" aria-label={`Step ${step} of 3`}>{[1, 2, 3].map((n) => <i key={n} data-on={n <= step} />)}</div>}

      {step === 1 && <>
        <div className="auth__head"><h1>Reset your password</h1><p>Enter your ID. We will email a 6-digit code to your university address.</p></div>
        <form className="auth__form" onSubmit={run(async () => { await api.post('/auth/forgot', { uid: uid.trim() }); setStep(2) })}>
          <Field label="ID" mono autoFocus placeholder="FA23-BCS-052 or EMP-CS-001" value={uid} onChange={(e) => setUid(e.target.value)} />
          {err && <Alert tone="error">{err}</Alert>}
          <Button variant="primary" type="submit" block loading={busy} disabled={uid.trim().length < 3}>Send code</Button>
        </form>
      </>}

      {step === 2 && <>
        <div className="auth__head"><h1>Check your email</h1><p>If this account exists, a code was sent. It works for 10 minutes.</p></div>
        <form className="auth__form" onSubmit={run(async () => { const r = await api.post<{ resetToken: string }>('/auth/verify', { uid: uid.trim(), code }); setToken(r.resetToken); setStep(3) })}>
          <Field label="6-digit code" className="auth__code" inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
          {import.meta.env.DEV && <p className="field__help">Local development: read the code at <a href="/api/dev/mailbox" target="_blank" rel="noreferrer" style={{ textDecoration: 'underline' }}>the dev mailbox</a> (sign-in is not needed).</p>}
          {err && <Alert tone="error">{err}</Alert>}
          <Button variant="primary" type="submit" block loading={busy} disabled={code.length !== 6}>Verify code</Button>
          <button type="button" className="btn btn--quiet" style={{ alignSelf: 'flex-start' }} onClick={() => { setCode(''); setErr(null); setStep(1) }}>Use a different ID</button>
        </form>
      </>}

      {step === 3 && <>
        <div className="auth__head"><h1>Choose a new password</h1><p>All other devices will be signed out.</p></div>
        <form className="auth__form" onSubmit={run(async () => { await api.post('/auth/reset', { resetToken: token, password: pw }); setStep(4) })}>
          <Field label="New password" reveal autoFocus autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
          <ul className="auth__rules">{rules.map((r) => <li key={r.text} data-ok={r.ok}>{r.text}</li>)}</ul>
          <Field label="Confirm new password" reveal autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} error={pw2 && pw !== pw2 ? 'Passwords do not match.' : undefined} />
          {err && <Alert tone="error">{err}</Alert>}
          <Button variant="primary" type="submit" block loading={busy} disabled={!rules.every((r) => r.ok) || pw !== pw2}>Update password</Button>
        </form>
      </>}

      {step === 4 && <>
        <div className="auth__head"><h1>Password updated</h1><p>Sign in with your new password.</p></div>
        <Button variant="primary" block onClick={() => nav('/login')}>Go to sign in</Button>
      </>}

      {step < 4 && <div className="auth__foot"><Link to="/login" className="btn btn--quiet" style={{ alignSelf: 'flex-start' }}>← Back to sign in</Link></div>}
    </AuthLayout>
  )
}
