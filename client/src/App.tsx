import { useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import AppShell from './components/layout/AppShell'
import Login from './features/auth/Login'
import Activate from './features/auth/Activate'
import Forgot from './features/auth/Forgot'
import { Maintenance, NotFound, Suspended } from './features/auth/Notices'
import GroupView from './features/chat/GroupView'
import Home, { DmIndex } from './features/chat/Home'
import { Spinner } from './components/ui'
import Board from './features/board/Board'
import { PostPage, Versions } from './features/board/PostPage'
import Compose from './features/board/Compose'
import AckReportPage from './features/board/AckReportPage'
import { BrowseChannels, ChannelFeed, ChannelCompose, Insights, Moderation, MySubmissions } from './features/channels/Channels'
import { DeskHub, DeskPage, DeskReports, NewTicket, Queue, TicketView } from './features/desks/Desks'
import Dept, { BatchDossier, DeptIndex } from './features/dept/Dept'
import Exam from './features/exam/Exam'
import { ReportDetail, Reports } from './features/admin/Reports'
import { Admins, Audit, Dashboard, DeptDetail, DeptWizard, Departments, Groups, Import, NewUser, Offices, System, Terms, UserDetail, Users } from './features/admin/Admin'
import Search from './features/search/Search'
import Settings, { Activity } from './features/account/Account'
import { useAuth } from './store/auth'

function Protected() {
  const { status, me } = useAuth()
  const loc = useLocation()
  if (status === 'loading') return <div style={{ padding: 48 }}><Spinner /></div>
  if (status === 'anon') return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />
  if (status === 'activation') return <Navigate to="/activate" replace />
  return me ? <AppShell /> : null
}

export default function App() {
  const boot = useAuth((s) => s.boot)
  useEffect(() => { boot() }, [boot])
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/forgot" element={<Forgot />} />
      <Route path="/activate" element={<Activate />} />
      <Route path="/suspended" element={<Suspended />} />
      <Route path="/maintenance" element={<Maintenance />} />
      <Route element={<Protected />}>
        <Route index element={<Navigate to="/home" replace />} />
        <Route path="/home" element={<Home />} />
        <Route path="/dm" element={<DmIndex />} />
        <Route path="/g/:groupId" element={<GroupView />} />
        <Route path="/board" element={<Board />} />
        <Route path="/board/archive" element={<Board archive />} />
        <Route path="/board/new" element={<Compose />} />
        <Route path="/board/:id" element={<PostPage />} />
        <Route path="/board/:id/acks" element={<AckReportPage />} />
        <Route path="/board/:id/versions" element={<Versions />} />
        <Route path="/activity" element={<Activity />} />
        <Route path="/channels" element={<BrowseChannels />} />
        <Route path="/channels/moderation" element={<Moderation />} />
        <Route path="/channels/submissions" element={<MySubmissions />} />
        <Route path="/channels/:slug" element={<ChannelFeed />} />
        <Route path="/channels/:slug/new" element={<ChannelCompose />} />
        <Route path="/channels/:slug/insights" element={<Insights />} />
        <Route path="/desks" element={<DeskHub />} />
        <Route path="/desks/:slug" element={<DeskPage />} />
        <Route path="/desks/:slug/new" element={<NewTicket />} />
        <Route path="/desks/:slug/queue" element={<Queue />} />
        <Route path="/desks/:slug/reports" element={<DeskReports />} />
        <Route path="/tickets/:id" element={<TicketView />} />
        <Route path="/dept/dashboard" element={<DeptIndex />} />
        <Route path="/dept/batch/:id" element={<BatchDossier />} />
        <Route path="/dept/:deptId/:tab?" element={<Dept />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/reports/:id" element={<ReportDetail />} />
        <Route path="/admin" element={<Navigate to="/admin/dashboard" replace />} />
        <Route path="/admin/dashboard" element={<Dashboard />} />
        <Route path="/admin/departments" element={<Departments />} />
        <Route path="/admin/departments/new" element={<DeptWizard />} />
        <Route path="/admin/departments/:id" element={<DeptDetail />} />
        <Route path="/admin/users" element={<Users />} />
        <Route path="/admin/users/new" element={<NewUser />} />
        <Route path="/admin/users/:id" element={<UserDetail />} />
        <Route path="/admin/import" element={<Import />} />
        <Route path="/admin/terms" element={<Terms />} />
        <Route path="/admin/offices" element={<Offices />} />
        <Route path="/admin/groups" element={<Groups />} />
        <Route path="/admin/audit" element={<Audit />} />
        <Route path="/admin/admins" element={<Admins />} />
        <Route path="/admin/system" element={<System />} />
        <Route path="/exam" element={<Exam />} />
        <Route path="/search" element={<Search />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}
