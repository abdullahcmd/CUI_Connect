import { Link } from 'react-router-dom'
import { useUi } from '../store/ui'
export function Toasts() {
  const { toasts, dismiss } = useUi()
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => <div key={t.id} className={`toast ${t.tone === 'error' ? 'toast--error' : ''}`}>{t.text}{t.action && <Link to={t.action.to} onClick={() => dismiss(t.id)}>{t.action.label}</Link>}</div>)}
    </div>
  )
}
