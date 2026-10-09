import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import Rail from './Rail'
import Sidebar from './Sidebar'
import TopBar from './TopBar'
import { NewMessageDialog, CreateGroupDialog } from '../../features/chat/dialogs'
import { Toasts } from '../Toasts'
import { socket } from '../../lib/socket'
import { useAuth } from '../../store/auth'
import { useChat, wireSocket } from '../../store/chat'
import { useUi } from '../../store/ui'
import { api } from '../../lib/api'
import { applyTheme } from '../../features/account/Account'
import './shell.css'

export default function AppShell() {
  const refreshMe = useAuth((s) => s.refreshMe)
  const online = useUi((s) => s.online)
  const [dm, setDm] = useState(false)
  const [grp, setGrp] = useState(false)
  const [nav, setNav] = useState(false)
  const loc = useLocation()
  useEffect(() => setNav(false), [loc.pathname])

  useEffect(() => {
    wireSocket()
    socket.connect()
    api.get<Record<string, number>>('/unread').then((u) => useChat.getState().setUnreadFromSidebar(u)).catch(() => {})
    return () => { socket.disconnect() }
  }, [])
  useEffect(() => {
    const open = () => setDm(true)
    window.addEventListener('ui:new-dm', open)
    const grpOpen = () => setGrp(true)
    window.addEventListener('ui:new-group', grpOpen)
    return () => { window.removeEventListener('ui:new-dm', open); window.removeEventListener('ui:new-group', grpOpen) }
  }, [])
  useEffect(() => { const t = setInterval(refreshMe, 60_000); return () => clearInterval(t) }, [refreshMe])
  const theme = useAuth((s) => (s.me?.user.settings as any)?.theme as string | undefined)
  useEffect(() => { applyTheme(theme ?? 'system') }, [theme])

  return (
    <div className={`shell ${nav ? 'shell--nav' : ''}`}>
      <Rail />
      <Sidebar onNewDm={() => setDm(true)} onNewGroup={() => setGrp(true)} />
      <div className="shell__scrim" onClick={() => setNav(false)} />
      <div className="shell__main">
        {!online && <div className="offline" role="status">You are offline. Reconnecting…</div>}
        <TopBar onMenu={() => setNav((v) => !v)} />
        <main className="shell__content"><Outlet /></main>
      </div>
      {dm && <NewMessageDialog onClose={() => setDm(false)} />}
      {grp && <CreateGroupDialog onClose={() => setGrp(false)} />}
      <Toasts />
    </div>
  )
}
