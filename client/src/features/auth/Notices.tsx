import { Link, useNavigate } from 'react-router-dom'
import { AuthLayout } from './AuthLayout'
import { Button } from '../../components/ui'
import { useAuth } from '../../store/auth'

export function Suspended() {
  const { suspended } = useAuth()
  const nav = useNavigate()
  return (
    <AuthLayout>
      <span className="auth__status">Account suspended</span>
      <div className="auth__head">
        <h1>You can't sign in right now</h1>
        <p>{suspended?.reason ? `Reason: ${suspended.reason}` : 'Your account was suspended by the university.'} Your messages and records are kept, and nothing is deleted.</p>
      </div>
      <div className="auth__contact"><b>Admin Office</b><br />it-support@comsats.edu.pk · Ext. 5114<br />Mon–Fri, 09:00 – 15:30</div>
      <Button block onClick={() => { useAuth.setState({ suspended: null }); nav('/login') }}>Back to sign in</Button>
    </AuthLayout>
  )
}

export function NoAccess({ message }: { message?: string }) {
  return (
    <div className="empty">
      <h1 style={{ font: '600 18px/26px var(--font-sans)', color: 'var(--ink)' }}>You don't have access to this</h1>
      <p>{message ?? "It may belong to another department or role. Use the sidebar to open something you can see."}</p>
      <Link to="/" className="btn btn--secondary empty__action">Go home</Link>
    </div>
  )
}

export function NotFound() {
  return (
    <div className="empty">
      <h1 style={{ font: '600 18px/26px var(--font-sans)', color: 'var(--ink)' }}>This page doesn't exist</h1>
      <p>The link may be old, or the item was archived.</p>
      <Link to="/" className="btn btn--secondary empty__action">Go home</Link>
    </div>
  )
}

export function Maintenance({ message }: { message?: string }) {
  return (
    <AuthLayout>
      <div className="auth__head"><h1>Back soon</h1><p>{message || 'CUI Connect is under maintenance. Please try again in a few minutes.'}</p></div>
      <Button block onClick={() => location.reload()}>Try again</Button>
    </AuthLayout>
  )
}
