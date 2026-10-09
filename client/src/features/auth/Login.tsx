import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { AuthLayout } from './AuthLayout'
import { Alert, Button, Field } from '../../components/ui'
import { ApiError } from '../../lib/api'
import { useAuth } from '../../store/auth'

export default function Login() {
  const { status, me, login, expired, suspended } = useAuth()
  const nav = useNavigate()
  const loc = useLocation() as { state?: { from?: string } }
  const [uid, setUid] = useState('')
  const [pw, setPw] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (status === 'authed' && me) return <Navigate to={loc.state?.from ?? me.landing} replace />
  if (status === 'activation') return <Navigate to="/activate" replace />
  if (suspended) return <Navigate to="/suspended" replace />

  async function submit(e: FormEvent) {
    e.preventDefault()
    setErr(null); setBusy(true)
    try {
      const s = await login(uid.trim(), pw)
      nav(s === 'activation' ? '/activate' : loc.state?.from ?? useAuth.getState().me!.landing, { replace: true })
    } catch (ex) {
      if (ex instanceof ApiError && ex.code === 'ACCOUNT_SUSPENDED') { useAuth.setState({ suspended: { reason: ex.meta.reason, message: ex.message } }); nav('/suspended', { replace: true }) }
      else setErr(ex instanceof ApiError ? ex.message : 'Could not reach the server. Check your connection.')
    } finally { setBusy(false) }
  }

  return (
    <AuthLayout>
      <div className="auth__head">
        <h1>Sign in</h1>
        <p>Use your registration number or employee ID.</p>
      </div>
      {expired && <Alert>Your session ended. Sign in again to continue.</Alert>}
      <form className="auth__form" onSubmit={submit} noValidate>
        <Field label="ID" mono autoFocus autoComplete="username" placeholder="FA23-BCS-052 or EMP-CS-001" value={uid} onChange={(e) => setUid(e.target.value)} required />
        <Field label="Password" reveal autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} required
          aside={<Link to="/forgot" className="btn btn--quiet" style={{ fontSize: 13 }}>Forgot password?</Link>} />
        {err && <Alert tone="error">{err}</Alert>}
        <Button variant="primary" type="submit" block loading={busy} disabled={!uid || !pw}>Sign in</Button>
      </form>
      <div className="auth__foot">
        <span>First time? Sign in with the temporary password from your email and you will be asked to choose a new one.</span>
        <span>There is no sign-up. Accounts are created by the Admin Office.</span>
      </div>
    </AuthLayout>
  )
}
