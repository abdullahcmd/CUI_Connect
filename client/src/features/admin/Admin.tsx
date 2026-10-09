import { useState } from 'react'
import { Link, NavLink, useNavigate, useParams } from 'react-router-dom'
import { Alert, Avatar, Button, ErrorState, Field, Loading, Page, PageHead, Progress, Stat, Tabs } from '../../components/ui'
import { Dialog } from '../chat/dialogs'
import { api, fileHref } from '../../lib/api'
import { fmtStamp } from '../../lib/format'
import { useFetch } from '../../lib/useFetch'
import { useAuth } from '../../store/auth'
import { useUi } from '../../store/ui'
import type { PersonCard } from '../../lib/types'

export function AdminNav() {
  const caps = useAuth((s) => s.me)!.capabilities
  const items: [string, string][] = [['dashboard', 'Dashboard'], ['departments', 'Departments'], ['users', 'Users'], ['terms', 'Terms'], ['offices', 'Offices'], ['groups', 'Groups'], ['audit', 'Audit log']]
  if (caps.superAdmin) items.push(['admins', 'Admins'], ['system', 'System'])
  return <div className="tabs">{items.map(([to, l]) => <NavLink key={to} to={`/admin/${to}`}>{l}</NavLink>)}</div>
}
const Shell = ({ title, sub, actions, children }: { title: string; sub?: string; actions?: React.ReactNode; children: React.ReactNode }) => <Page><PageHead crumb="Admin console" title={title} sub={sub} actions={actions} /><AdminNav />{children}</Page>

export function Dashboard() {
  const { data, loading, error } = useFetch<{ counts: Record<string, number>; currentTerm: { code: string; name: string } | null; importJobs: { id: string; file: string; status: string; summary: any; at: string }[]; suspended: number }>('/admin/dashboard')
  if (loading && !data) return <Loading />
  if (error || !data) return <ErrorState error={error} />
  const c = data.counts
  return (
    <Shell title="Dashboard" sub="Structure, people and what needs attention.">
      <div className="stats"><Stat label="Users" value={c.users} sub={`${c.students} students · ${c.staff} staff`} /><Stat label="Online now" value={c.online} tone="good" /><Stat label="Departments" value={c.departments} sub={`${c.batches} active batches`} /><Stat label="Open reports" value={c.openReports} tone={c.openReports ? 'warn' : 'good'} /><Stat label="Open tickets" value={c.openTickets} /><Stat label="Current term" value={data.currentTerm?.code ?? '—'} sub={data.currentTerm?.name} /></div>
      <h2 className="aside__label" style={{ marginBottom: 8 }}>Recent imports</h2>
      <div className="tablewrap"><table className="table"><thead><tr><th>File</th><th>Status</th><th>Rows</th><th>When</th></tr></thead><tbody>{data.importJobs.map((j) => <tr key={j.id}><td>{j.file}</td><td>{j.status}</td><td className="mono">{j.summary?.imported ?? j.summary?.valid ?? 0}/{j.summary?.total ?? 0}</td><td className="mono muted">{fmtStamp(j.at)}</td></tr>)}{data.importJobs.length === 0 && <tr><td colSpan={4} className="muted">No imports yet.</td></tr>}</tbody></table></div>
    </Shell>
  )
}

interface Dept { id: string; code: string; name: string; status: string; hod: { id: string; name: string } | null; programs: { id: string; code: string; name: string }[]; batchCount: number; students: number; staff: number; coordinators: number }
export function Departments() {
  const { data, loading, error } = useFetch<Dept[]>('/admin/departments')
  if (loading && !data) return <Loading />
  if (error || !data) return <ErrorState error={error} />
  return (
    <Shell title="Departments" sub="A department can't be archived while it has active batches." actions={<Link className="btn btn--primary" to="/admin/departments/new">New department</Link>}>
      <div className="tablewrap"><table className="table"><thead><tr><th>Department</th><th>HOD</th><th>Programs</th><th>Batches</th><th>People</th><th /></tr></thead><tbody>{data.map((d) => <tr key={d.id}><td><b>{d.name}</b> <span className="mono muted">{d.code}</span>{d.status === 'ARCHIVED' && <span className="badge" style={{ marginLeft: 6 }}>Archived</span>}</td><td>{d.hod?.name ?? '—'}</td><td>{d.programs.map((p) => <span key={p.id} className="badge" style={{ marginRight: 4 }}>{p.code}</span>)}</td><td className="mono">{d.batchCount}</td><td className="mono muted">{d.students} students · {d.staff} staff</td><td><Link className="btn btn--quiet" to={`/admin/departments/${d.id}`}>Manage</Link> <Link className="btn btn--quiet" to={`/dept/${d.id}`}>Dashboard</Link></td></tr>)}</tbody></table></div>
    </Shell>
  )
}

type Staff = PersonCard & { roles: unknown[] }
function StaffPicker({ label, value, onChange }: { label: string; value: string; onChange: (id: string, p?: Staff) => void }) {
  const [q, setQ] = useState(''); const [open, setOpen] = useState(false); const [name, setName] = useState('')
  const { data } = useFetch<Staff[]>(open ? `/admin/staff?q=${encodeURIComponent(q)}` : null, [q, open])
  return (
    <div className="field" style={{ position: 'relative' }}><label className="field__label">{label}</label>
      <input className="input" value={open ? q : name} placeholder="Search staff by name or ID" onFocus={() => { setOpen(true); setQ('') }} onChange={(e) => setQ(e.target.value)} onBlur={() => setTimeout(() => setOpen(false), 150)} />
      {open && <div className="menu" style={{ top: 62, left: 0, right: 0 }}>{data?.slice(0, 8).map((p) => <button key={p.id} className="menu__item" onMouseDown={() => { onChange(p.id, p); setName(`${p.name} (${p.uid})`) }}>{p.name} <span className="mono muted">{p.uid}</span></button>)}</div>}
      {value && !open && <span className="field__help">Selected</span>}</div>
  )
}

export function DeptWizard() {
  const [step, setStep] = useState(0); const nav = useNavigate(); const toast = useUi((s) => s.toast)
  const [d, setD] = useState({ name: '', code: '' }); const [hod, setHod] = useState('')
  const [progs, setProgs] = useState<{ code: string; name: string; pi: string }[]>([{ code: '', name: '', pi: '' }]); const [coords, setCoords] = useState<string[]>(['']); const [teachers, setTeachers] = useState<string[]>([])
  const [err, setErr] = useState<{ message: string; missing?: string[] } | null>(null); const [busy, setBusy] = useState(false)
  const steps = ['Details', 'HOD', 'Programs', 'Coordinators', 'Teachers', 'Review']
  const okStep = [d.name && d.code, hod, progs.every((p) => p.code && p.name && p.pi), coords.some(Boolean), true, true][step]
  const complete = d.name && d.code && hod && progs.every((p) => p.code && p.name && p.pi) && coords.some(Boolean)
  async function create() {
    setBusy(true); setErr(null)
    try { const r = await api.post<{ id: string }>('/admin/departments', { name: d.name, code: d.code, hodId: hod, coordinatorIds: coords.filter(Boolean), teacherIds: teachers, programs: progs.map((p) => ({ code: p.code, name: p.name, programInchargeId: p.pi })) }); toast(`${d.name} created`); useAuth.getState().refreshMe(); nav(`/admin/departments/${r.id}`) }
    catch (e: any) { setErr({ message: e.message, missing: e.meta?.missing }) } finally { setBusy(false) }
  }
  return (
    <Shell title="New department" sub="A department can only be created with a HOD, a Program Incharge for every program and at least one coordinator.">
      <div className="grid2" style={{ gridTemplateColumns: '180px minmax(0,1fr)' }}>
        <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>{steps.map((s, i) => <li key={s}><button className="menu__item" style={{ background: i === step ? 'var(--select)' : undefined, fontWeight: i === step ? 600 : 400 }} onClick={() => i < step && setStep(i)}>{i + 1}. {s}</button></li>)}</ol>
        <div className="card"><div className="card__body">
          {step === 0 && <><Field label="Department name" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} /><Field label="Code" mono value={d.code} maxLength={5} onChange={(e) => setD({ ...d, code: e.target.value.toUpperCase() })} /></>}
          {step === 1 && <StaffPicker label="Head of department (required)" value={hod} onChange={setHod} />}
          {step === 2 && <>{progs.map((p, i) => <div key={i} className="formgrid"><Field label="Program name" value={p.name} onChange={(e) => setProgs(progs.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} /><Field label="Code" mono value={p.code} onChange={(e) => setProgs(progs.map((x, j) => j === i ? { ...x, code: e.target.value.toUpperCase() } : x))} /><StaffPicker label="Program Incharge" value={p.pi} onChange={(id) => setProgs(progs.map((x, j) => j === i ? { ...x, pi: id } : x))} /></div>)}<div><Button size="sm" onClick={() => setProgs([...progs, { code: '', name: '', pi: '' }])}>Add program</Button></div></>}
          {step === 3 && <>{coords.map((c, i) => <StaffPicker key={i} label={`Coordinator ${i + 1}`} value={c} onChange={(id) => setCoords(coords.map((x, j) => j === i ? id : x))} />)}<div><Button size="sm" onClick={() => setCoords([...coords, ''])}>Add coordinator</Button></div></>}
          {step === 4 && <><p className="field__help">Optional. Teachers can also be added later by the HOD.</p>{teachers.map((t, i) => <StaffPicker key={i} label={`Teacher ${i + 1}`} value={t} onChange={(id) => setTeachers(teachers.map((x, j) => j === i ? id : x))} />)}<div><Button size="sm" onClick={() => setTeachers([...teachers, ''])}>Add teacher</Button></div></>}
          {step === 5 && <><dl className="kv"><dt>Name</dt><dd>{d.name} ({d.code})</dd><dt>HOD</dt><dd>{hod ? 'Chosen' : 'Missing'}</dd><dt>Programs</dt><dd>{progs.map((p) => p.code).join(', ')}</dd><dt>Coordinators</dt><dd>{coords.filter(Boolean).length}</dd></dl><Alert>Creating adds the Teachers, CRs and Management groups, a Coordinator Desk, a board scope and an events channel. Everyone named is notified.</Alert>{err && <Alert tone="error">{err.message}{err.missing && ` Missing: ${err.missing.join(', ')}`}</Alert>}</>}
          <div className="row"><Button disabled={step === 0} onClick={() => setStep(step - 1)}>Back</Button>{step < 5 ? <Button variant="primary" disabled={!okStep} onClick={() => setStep(step + 1)}>Next</Button> : <Button variant="primary" loading={busy} disabled={!complete} onClick={create}>Create department</Button>}</div>
        </div></div>
      </div>
    </Shell>
  )
}

export function DeptDetail() {
  const { id } = useParams(); const toast = useUi((s) => s.toast)
  const { data, loading, error, reload } = useFetch<any>(`/admin/departments/${id}`)
  const [hod, setHod] = useState('')
  if (loading && !data) return <Loading />
  if (error || !data) return <ErrorState error={error} />
  async function run(fn: () => Promise<unknown>, msg: string) { try { await fn(); toast(msg); reload() } catch (e: any) { toast(e.meta?.reason ?? e.message, 'error') } }
  return (
    <Shell title={data.name} sub={`${data.code} · ${data.activeBatches} active batches`} actions={<Button variant="danger" onClick={() => window.confirm('Archive this department?') && run(() => api.post(`/admin/departments/${id}/archive`), 'Archived')}>Archive</Button>}>
      <div className="stack" style={{ gap: 20 }}>
        <div className="card"><div className="card__head">Head of department</div><div className="card__body"><div className="row"><Avatar name={data.hod?.name} initials={data.hod?.initials} /><b>{data.hod?.name}</b><span className="mono muted">{data.hod?.uid}</span></div><StaffPicker label="Replace HOD (new HOD is set first; the old one loses access in the same step)" value={hod} onChange={setHod} /><div><Button size="sm" disabled={!hod} onClick={() => run(() => api.patch(`/admin/departments/${id}`, { hodId: hod }), 'HOD replaced')}>Replace HOD</Button></div></div></div>
        <div className="card"><div className="card__head">Programs</div><div className="card__body">{data.programs.map((p: any) => <div className="row row--between" key={p.id}><span><b>{p.code}</b> {p.name} · {p.batches} batches</span><span className="muted">{p.programIncharge?.name ?? 'No Program Incharge'}</span></div>)}</div></div>
        <div className="card"><div className="card__head">Coordinators</div><div className="card__body">{data.coordinators.map((c: any) => <div className="row row--between" key={c.assignmentId}><span>{c.name} <span className="mono muted">{c.uid}</span></span><Button size="sm" variant="danger" onClick={() => run(() => api.del(`/admin/roles/${c.assignmentId}`), 'Removed')}>Remove</Button></div>)}<span className="field__help">A department always keeps at least one coordinator.</span></div></div>
      </div>
    </Shell>
  )
}

export function Users() {
  const [q, setQ] = useState(''); const [role, setRole] = useState(''); const [status, setStatus] = useState(''); const [page, setPage] = useState(1); const [sel, setSel] = useState<string[]>([])
  const { data, loading, reload } = useFetch<{ items: any[]; total: number; pages: number }>(`/admin/users?q=${encodeURIComponent(q)}&role=${role}&status=${status}&page=${page}`)
  const toast = useUi((s) => s.toast)
  async function bulk(action: string) { const r = await api.post<{ results: { ok: boolean }[] }>('/admin/users/bulk', { ids: sel, action, reason: 'Bulk action' }); toast(`${r.results.filter((x) => x.ok).length} of ${sel.length} done`); setSel([]); reload() }
  return (
    <Shell title="Users" actions={<><Link className="btn btn--secondary" to="/admin/import">Bulk CSV import</Link><Link className="btn btn--primary" to="/admin/users/new">Create user</Link></>}>
      <div className="toolbar"><input className="input" placeholder="Search name, ID or email" value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }} /><select className="input" value={role} onChange={(e) => setRole(e.target.value)}><option value="">Any role</option>{['ADMIN', 'HOD', 'COORDINATOR', 'PROGRAM_INCHARGE', 'TEACHER', 'CR', 'STUDENT', 'SA_OFFICER', 'LIBRARIAN', 'CAFE_MANAGER'].map((r) => <option key={r}>{r}</option>)}</select><select className="input" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Any status</option>{['ACTIVE', 'SUSPENDED', 'FROZEN', 'ALUMNI'].map((r) => <option key={r}>{r}</option>)}</select>{sel.length > 0 && <><Button size="sm" onClick={() => bulk('reset-password')}>Reset passwords ({sel.length})</Button><Button size="sm" variant="danger" onClick={() => bulk('suspend')}>Suspend ({sel.length})</Button></>}</div>
      {loading && !data ? <Loading /> : <><div className="tablewrap"><table className="table"><thead><tr><th /><th>ID</th><th>Name</th><th>Roles</th><th>Unit</th><th>Status</th><th /></tr></thead><tbody>{data?.items.map((u) => <tr key={u.id}><td><input type="checkbox" checked={sel.includes(u.id)} onChange={(e) => setSel((s) => e.target.checked ? [...s, u.id] : s.filter((x) => x !== u.id))} /></td><td className="mono">{u.uid}</td><td>{u.name}</td><td>{u.roles.map((r: any) => <span className="badge" key={r.role + r.orgUnit} style={{ marginRight: 4 }}>{r.label}</span>)}</td><td className="mono">{u.batch ?? u.department}</td><td><span className={`status ${u.status === 'ACTIVE' ? 'status--resolved' : 'status--escalated'}`}>{u.status.toLowerCase()}</span></td><td><Link className="btn btn--quiet" to={`/admin/users/${u.id}`}>Open</Link></td></tr>)}</tbody></table></div>
        <div className="row row--between" style={{ marginTop: 12 }}><span className="muted mono" style={{ fontSize: 12 }}>{data?.total} users · page {page} of {data?.pages}</span><div className="row"><Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><Button size="sm" disabled={page >= (data?.pages ?? 1)} onClick={() => setPage(page + 1)}>Next</Button></div></div></>}
    </Shell>
  )
}

export function UserDetail() {
  const { id } = useParams(); const toast = useUi((s) => s.toast)
  const { data, loading, error, reload } = useFetch<any>(`/admin/users/${id}`)
  const orgs = useFetch<{ scopes: { id: string; type: string; code: string }[] }>('/admin/board-scopes')
  const [role, setRole] = useState('TEACHER'); const [orgId, setOrgId] = useState(''); const [to, setTo] = useState('')
  if (loading && !data) return <Loading />
  if (error || !data) return <ErrorState error={error} />
  const u = data.user
  async function run(fn: () => Promise<unknown>, msg: string) { try { await fn(); toast(msg); reload() } catch (e: any) { toast(e.meta?.reason ?? e.message, 'error') } }
  return (
    <Shell title={u.name} sub={`${u.uid} · ${u.email}`} actions={<Link className="btn btn--secondary" to="/admin/users">All users</Link>}>
      {data.readOnly && <Alert>Admin and Super Admin accounts are read-only for Admins.</Alert>}
      <div className="grid2">
        <div className="stack" style={{ gap: 20 }}>
          <div className="card"><div className="card__head">Role assignments</div><div className="card__body">{data.roles.map((r: any) => <div className="row row--between" key={r.id}><span><span className="badge">{r.label}</span> <span className="mono muted">{r.orgUnit}</span> {!r.active && <span className="muted">(ended)</span>}</span>{r.active && r.role !== 'STUDENT' && !data.readOnly && <Button size="sm" variant="danger" onClick={() => run(() => api.del(`/admin/roles/${r.id}`), 'Role ended')}>End</Button>}</div>)}</div></div>
          {!data.readOnly && <div className="card"><div className="card__head">Assign a role</div><div className="card__body"><div className="formgrid"><div className="field"><label className="field__label">Role</label><select className="input" value={role} onChange={(e) => setRole(e.target.value)}>{['TEACHER', 'COORDINATOR', 'PROGRAM_INCHARGE', 'HOD', 'CR', 'SA_OFFICER', 'LIBRARY_STAFF', 'CAFE_STAFF', 'PUBLISHER', 'SOCIETY_LEAD', 'EXAM_OFFICER'].map((r) => <option key={r}>{r}</option>)}</select></div><div className="field"><label className="field__label">Where</label><select className="input" value={orgId} onChange={(e) => setOrgId(e.target.value)}><option value="">Choose a unit</option>{orgs.data?.scopes.map((s) => <option key={s.id} value={s.id}>{s.type.toLowerCase()} · {s.code}</option>)}</select></div></div><Field label="Ends on (optional)" type="date" value={to} onChange={(e) => setTo(e.target.value)} /><Alert>You can't assign yourself a role, or a role at or above your own. Every change is audited.</Alert><div><Button variant="primary" disabled={!orgId} onClick={() => run(() => api.post('/admin/roles', { userId: id, role, orgUnitId: orgId, to: to || undefined }), 'Role assigned')}>Assign role</Button></div></div></div>}
          <div className="card"><div className="card__head">History</div><div className="card__body">{data.audit.map((a: any) => <div className="row row--between" key={a.id}><span>{a.action}<span className="muted"> · {a.actor}</span></span><span className="mono muted" style={{ fontSize: 12 }}>{fmtStamp(a.at)}</span></div>)}</div></div>
        </div>
        <aside className="aside">
          <dl className="kv"><dt>Status</dt><dd>{u.status}</dd><dt>Kind</dt><dd>{u.kind}</dd><dt>Unit</dt><dd className="mono">{u.batch ?? u.department ?? '—'}</dd><dt>Last sign-in</dt><dd className="mono">{u.lastLoginAt ? fmtStamp(u.lastLoginAt) : 'Never'}</dd><dt>Sessions</dt><dd>{data.sessions.length}</dd></dl>
          {!data.readOnly && <div className="stack">
            <Button onClick={() => run(() => api.post(`/admin/users/${id}/reset-password`), 'Reset email sent; sessions revoked')}>Reset password</Button>
            {u.mustChangePassword && <Button onClick={() => run(() => api.post(`/admin/users/${id}/resend-activation`), 'Activation resent')}>Resend activation</Button>}
            {u.status === 'SUSPENDED' ? <Button onClick={() => run(() => api.post(`/admin/users/${id}/status`, { status: 'ACTIVE' }), 'Reinstated')}>Reinstate</Button> : <>{u.kind === 'STUDENT' && <Button onClick={() => run(() => api.post(`/admin/users/${id}/status`, { status: u.status === 'FROZEN' ? 'ACTIVE' : 'FROZEN' }), 'Updated')}>{u.status === 'FROZEN' ? 'Unfreeze' : 'Freeze semester'}</Button>}<Button variant="danger" onClick={() => { const reason = window.prompt('Reason for suspension (shown to the user):'); reason && run(() => api.post(`/admin/users/${id}/status`, { status: 'SUSPENDED', reason }), 'Suspended; live sessions closed') }}>Suspend</Button></>}</div>}
        </aside>
      </div>
    </Shell>
  )
}

export function NewUser() {
  const nav = useNavigate(); const toast = useUi((s) => s.toast)
  const [f, setF] = useState({ kind: 'STUDENT', uid: '', name: '', email: '', department: 'CS', designation: '' }); const [err, setErr] = useState<string | null>(null)
  async function go() { try { const r = await api.post<{ id: string }>('/admin/users', { ...f, department: f.kind === 'STAFF' ? f.department : undefined }); toast('Created. A temporary password was emailed.'); nav(`/admin/users/${r.id}`) } catch (e: any) { setErr(e.meta?.reason ?? e.message) } }
  return (
    <Shell title="Create user"><div className="card" style={{ maxWidth: 520 }}><div className="card__body">
      <div className="seg">{['STUDENT', 'STAFF'].map((k) => <button key={k} aria-pressed={f.kind === k} onClick={() => setF({ ...f, kind: k })}>{k === 'STUDENT' ? 'Student' : 'Staff'}</button>)}</div>
      <Field label={f.kind === 'STUDENT' ? 'Registration number' : 'Employee ID'} mono placeholder={f.kind === 'STUDENT' ? 'FA26-BCS-030' : 'EMP-CS-050'} value={f.uid} onChange={(e) => setF({ ...f, uid: e.target.value })} help={f.kind === 'STUDENT' ? 'The batch is read from the number. It must already exist.' : undefined} />
      <Field label="Full name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /><Field label="University email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
      {f.kind === 'STAFF' && <><Field label="Department code" mono value={f.department} onChange={(e) => setF({ ...f, department: e.target.value.toUpperCase() })} /><Field label="Designation" value={f.designation} onChange={(e) => setF({ ...f, designation: e.target.value })} /></>}
      {err && <Alert tone="error">{err}</Alert>}<div className="row"><Button onClick={() => nav(-1)}>Cancel</Button><Button variant="primary" disabled={!f.uid || !f.name || !f.email} onClick={go}>Create user</Button></div></div></div></Shell>
  )
}

export function Import() {
  const toast = useUi((s) => s.toast); const [prev, setPrev] = useState<any>(null); const [res, setRes] = useState<any>(null); const [busy, setBusy] = useState(false)
  async function upload(file?: File) { if (!file) return; const fd = new FormData(); fd.append('file', file); setBusy(true); try { setPrev(await api.post('/admin/users/import', fd as any)); setRes(null) } catch (e: any) { toast(e.meta?.reason ?? e.message, 'error') } finally { setBusy(false) } }
  async function commit() { setBusy(true); try { const r = await api.post<any>(`/admin/users/import/${prev.jobId}/commit`); setRes(r); setPrev(null); useAuth.getState().refreshMe() } catch (e: any) { toast(e.message, 'error') } finally { setBusy(false) } }
  return (
    <Shell title="Student CSV import" sub="Upload, check every row, see which class groups students will join, then import. Valid rows import even if others fail." actions={<a className="btn btn--secondary" href={fileHref('/api/admin/users/import/template.csv')}>Download template</a>}>
      {!prev && <label className="card" style={{ padding: 32, textAlign: 'center', cursor: 'pointer', borderStyle: 'dashed' }}>{busy ? 'Reading…' : 'Choose a CSV file (regNo, name, email, section)'}<input type="file" accept=".csv" hidden onChange={(e) => upload(e.target.files?.[0])} /></label>}
      {prev && <div className="stack" style={{ gap: 16 }}>
        <div className="stats"><Stat label="Valid" value={prev.summary.valid} tone="good" /><Stat label="Rows with errors" value={prev.summary.invalid} tone={prev.summary.invalid ? 'bad' : 'good'} /></div>
        {prev.groups.map((g: any) => <Alert key={g.code}>{g.message}</Alert>)}
        <div className="tablewrap"><table className="table"><thead><tr><th>Row</th><th>ID</th><th>Name</th><th>Email</th><th>Check</th></tr></thead><tbody>{prev.rows.map((r: any) => <tr key={r.row}><td className="mono">{r.row}</td><td className="mono">{r.uid}</td><td>{r.name}</td><td className="muted">{r.email}</td><td style={{ color: r.ok ? 'var(--st-resolved)' : 'var(--danger)' }}>{r.ok ? 'OK' : r.errors.join(' ')}</td></tr>)}</tbody></table></div>
        <div className="row"><Button onClick={() => setPrev(null)}>Choose another file</Button><Button variant="primary" loading={busy} disabled={!prev.summary.valid} onClick={commit}>Import {prev.summary.valid} students</Button></div></div>}
      {res && <Alert>Imported {res.imported} students. {res.errors.length > 0 && <>{res.errors.length} rows were skipped. <a style={{ textDecoration: 'underline' }} href={fileHref(`/api/admin/users/import/${prev?.jobId ?? ''}/errors.csv`)}>Error report</a></>}</Alert>}
    </Shell>
  )
}

export function Terms() {
  const { data, reload } = useFetch<{ id: string; code: string; name: string; startsAt: string; endsAt: string; current: boolean }[]>('/admin/terms')
  const [sel, setSel] = useState<string | null>(null); const [add, setAdd] = useState(false); const toast = useUi((s) => s.toast)
  const [f, setF] = useState({ code: '', startsAt: '', endsAt: '' })
  async function create() { try { await api.post('/admin/terms', f); toast('Term created'); setAdd(false); reload() } catch (e: any) { toast(e.meta?.reason ?? e.message, 'error') } }
  return (
    <Shell title="Terms and rollover" actions={<Button variant="primary" onClick={() => setAdd(true)}>New term</Button>}>
      <div className="tablewrap" style={{ marginBottom: 24 }}><table className="table"><thead><tr><th>Term</th><th>Dates</th><th /></tr></thead><tbody>{data?.map((t) => <tr key={t.id}><td><b className="mono">{t.code}</b> {t.name} {t.current && <span className="badge badge--official">Current</span>}</td><td className="mono muted">{t.startsAt.slice(0, 10)} → {t.endsAt.slice(0, 10)}</td><td>{!t.current && <Button size="sm" onClick={() => setSel(t.code)}>Rollover to {t.code}</Button>}</td></tr>)}</tbody></table></div>
      {sel && <Rollover code={sel} onDone={() => { setSel(null); reload() }} />}
      {add && <Dialog title="New term" onClose={() => setAdd(false)} actions={<><Button onClick={() => setAdd(false)}>Cancel</Button><Button variant="primary" onClick={create}>Create</Button></>}><Field label="Code" mono placeholder="FA27" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} /><div className="formgrid"><Field label="Starts" type="date" value={f.startsAt} onChange={(e) => setF({ ...f, startsAt: e.target.value })} /><Field label="Ends" type="date" value={f.endsAt} onChange={(e) => setF({ ...f, endsAt: e.target.value })} /></div></Dialog>}
    </Shell>
  )
}

function Rollover({ code, onDone }: { code: string; onDone: () => void }) {
  const { data, loading, error, reload } = useFetch<any>(`/admin/terms/${code}/rollover`); const toast = useUi((s) => s.toast); const [busy, setBusy] = useState(false)
  if (loading && !data) return <Loading />
  if (error || !data) return <ErrorState error={error} />
  async function run() { setBusy(true); try { const r = await api.post<any>(`/admin/terms/${code}/rollover`, { confirm: true }); toast(`Rolled over to ${code}. Archived: ${r.archived.join(', ') || 'none'}`); useAuth.getState().refreshMe(); onDone() } catch (e: any) { toast(e.meta?.message ?? e.message, 'error') } finally { setBusy(false) } }
  return (
    <div className="stack" style={{ gap: 16 }}>
      <h2 style={{ font: '600 18px/26px var(--font-sans)' }}>Rollover {data.from} → {data.to}</h2>
      <div className="stats">{data.stages.map((s: any) => <Stat key={s.n} label={`Stage ${s.n}`} value={<span style={{ fontSize: 15 }}>{s.title}</span>} sub={`${s.status.replace('_', ' ')} · ${s.detail}`} tone={s.status === 'PASSED' || s.status === 'READY' ? 'good' : s.status === 'ACTION_REQUIRED' ? 'bad' : undefined} />)}</div>
      {data.gateway === 'BLOCKED' && <Alert tone="error">Blocked: {data.missingDepartments.map((d: any) => d.name).join(', ')} {data.missingDepartments.length > 1 ? 'have' : 'has'} no offerings for {code}. Ask their coordinators to load them (Department → Course offerings).</Alert>}
      <div className="tablewrap"><table className="table"><thead><tr><th>Department</th><th>Offerings</th><th>Batches synced</th><th>Status</th></tr></thead><tbody>{data.departments.map((d: any) => <tr key={d.id}><td>{d.name}</td><td className="mono">{d.offeringsLoaded}</td><td className="mono">{d.batchesSynced}/{d.batches}</td><td style={{ color: d.ready ? 'var(--st-resolved)' : 'var(--danger)' }}>{d.ready ? 'Ready' : 'Pending ingestion'}</td></tr>)}</tbody></table></div>
      <div className="card"><div className="card__head">Impact preview</div><div className="card__body"><p>{data.impact.graduatingStudents} students in {data.impact.graduatingCohorts.map((c: any) => c.code).join(', ') || 'no'} cohorts become alumni (read-only for 6 months). {data.impact.facultyLines} teachers change CR lines (+{data.impact.teacherLinesGained} / −{data.impact.teacherLinesLost}). About {data.impact.socketRoomsRekeyed} rooms are re-keyed live.</p><Progress pct={data.parity.percent} /><span className="field__help">Curricular parity {data.parity.percent}% ({data.parity.loaded} of {data.parity.expected} expected)</span></div></div>
      <div className="row"><Button onClick={reload}>Re-check</Button><Button variant="primary" loading={busy} disabled={data.gateway === 'BLOCKED'} onClick={() => window.confirm(`Run the rollover to ${code}? This archives graduating batches.`) && run()}>Run rollover</Button></div>
    </div>
  )
}

export function Offices() {
  const { data, loading } = useFetch<{ id: string; code: string; name: string; head: { name: string } | null; staff: (PersonCard & { roles: string[] })[]; desk: { slug: string; name: string } | null }[]>('/admin/offices')
  if (loading) return <Loading />
  return (<Shell title="Offices" sub="Student Affairs, Library, Cafe, Career Development, Sports and the Examination Cell.">
    <div className="stack">{data?.map((o) => <div className="card" key={o.id}><div className="card__head"><span>{o.name}</span>{o.desk && <Link className="btn btn--quiet" to={`/desks/${o.desk.slug}`}>{o.desk.name}</Link>}</div><div className="card__body"><span className="muted">Head: {o.head?.name ?? 'Not assigned'}</span><div className="chips">{o.staff.map((s) => <span className="chip" key={s.id}>{s.name} · {s.roles.join(', ')}</span>)}</div></div></div>)}</div></Shell>)
}

export function Groups() {
  const { data, loading, reload } = useFetch<{ id: string; name: string; kind: string; scope?: string; members: number; manager?: string; announceOnly: boolean; status: string }[]>('/admin/groups'); const toast = useUi((s) => s.toast)
  if (loading) return <Loading />
  return (<Shell title="Groups directory" sub="Structure only. Admins never see message content.">
    <div className="tablewrap"><table className="table"><thead><tr><th>Group</th><th>Type</th><th>Scope</th><th>Members</th><th>Manager</th><th>Status</th><th /></tr></thead><tbody>{data?.map((g) => <tr key={g.id}><td>{g.name}</td><td>{g.kind}</td><td className="mono">{g.scope}</td><td className="mono">{g.members}</td><td>{g.manager}</td><td>{g.status}</td><td>{g.kind === 'CUSTOM' && g.status === 'ACTIVE' && <button className="btn btn--quiet" onClick={async () => { await api.post(`/admin/groups/${g.id}/archive`); toast('Archived'); reload() }}>Archive</button>}</td></tr>)}</tbody></table></div></Shell>)
}

export function Audit() {
  const [q, setQ] = useState(''); const [cat, setCat] = useState(''); const [page, setPage] = useState(1)
  const { data, loading } = useFetch<{ items: any[]; total: number; pages: number }>(`/admin/audit?action=${encodeURIComponent(q)}&category=${cat}&page=${page}&limit=25`)
  return (<Shell title="Audit log" sub="Append-only. Nobody can edit or delete entries." actions={<a className="btn btn--secondary" href={fileHref(`/api/admin/audit?format=csv&category=${cat}`)}>Export CSV</a>}>
    <div className="toolbar"><input className="input" placeholder="Filter by action" value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }} /><select className="input" value={cat} onChange={(e) => setCat(e.target.value)}><option value="">All categories</option>{['structure', 'account', 'security', 'content', 'system'].map((c) => <option key={c}>{c}</option>)}</select></div>
    {loading && !data ? <Loading /> : <><div className="tablewrap"><table className="table"><thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Target</th><th>Category</th></tr></thead><tbody>{data?.items.map((a) => <tr key={a.id}><td className="mono muted">{fmtStamp(a.at)}</td><td>{a.actor}<div className="mono muted" style={{ fontSize: 12 }}>{a.actorUid}</div></td><td className="mono">{a.action}</td><td>{a.target?.label}</td><td><span className="badge">{a.category}</span></td></tr>)}</tbody></table></div>
      <div className="row row--between" style={{ marginTop: 12 }}><span className="mono muted" style={{ fontSize: 12 }}>{data?.total} entries</span><div className="row"><Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><Button size="sm" disabled={page >= (data?.pages ?? 1)} onClick={() => setPage(page + 1)}>Next</Button></div></div></>}</Shell>)
}

export function Admins() {
  const { data, loading, reload } = useFetch<(PersonCard & { role: string; coordinatorsGroupManager: boolean })[]>('/admin/admins'); const toast = useUi((s) => s.toast)
  const [add, setAdd] = useState(false); const [f, setF] = useState({ uid: '', name: '', email: '', coordinatorsGroupManager: false }); const [err, setErr] = useState<string | null>(null)
  async function create() { try { await api.post('/admin/admins', f); toast('Admin created'); setAdd(false); reload() } catch (e: any) { setErr(e.meta?.reason ?? e.message) } }
  if (loading) return <Loading />
  return (<Shell title="Admins" sub="Only a Super Admin creates Admins. Super Admins are created from the server." actions={<Button variant="primary" onClick={() => setAdd(true)}>New Admin</Button>}>
    <div className="tablewrap"><table className="table"><thead><tr><th>Name</th><th>ID</th><th>Role</th><th>Coordinators group</th><th /></tr></thead><tbody>{data?.map((a) => <tr key={a.id}><td>{a.name}</td><td className="mono">{a.uid}</td><td>{a.role.replace('_', ' ')}</td><td>{a.coordinatorsGroupManager ? 'Manager' : <button className="btn btn--quiet" disabled={a.role !== 'ADMIN'} onClick={async () => { await api.put(`/admin/coordinators-manager/${a.id}`); toast('Designated'); reload() }}>Designate</button>}</td><td>{a.role === 'ADMIN' && <button className="btn btn--quiet" style={{ color: 'var(--danger)' }} onClick={async () => { try { await api.post(`/admin/admins/${a.id}/suspend`, { reason: 'Suspended by Super Admin' }); reload() } catch (e: any) { toast(e.meta?.reason ?? e.message, 'error') } }}>Suspend</button>}</td></tr>)}</tbody></table></div>
    {add && <Dialog title="New Admin" onClose={() => setAdd(false)} actions={<><Button onClick={() => setAdd(false)}>Cancel</Button><Button variant="primary" disabled={!f.uid || !f.name || !f.email} onClick={create}>Create</Button></>}><Field label="Employee ID" mono value={f.uid} onChange={(e) => setF({ ...f, uid: e.target.value })} /><Field label="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /><Field label="University email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /><label className="checkrow"><input type="checkbox" checked={f.coordinatorsGroupManager} onChange={(e) => setF({ ...f, coordinatorsGroupManager: e.target.checked })} />Manages the Coordinators — CUI group</label>{err && <Alert tone="error">{err}</Alert>}</Dialog>}</Shell>)
}

export function System() {
  const { data, loading, setData } = useFetch<any>('/admin/system'); const toast = useUi((s) => s.toast)
  if (loading || !data) return <Loading />
  async function save(patch: object) { try { setData(await api.put('/admin/system', patch)); toast('Saved') } catch (e: any) { toast(e.message, 'error') } }
  return (<Shell title="System settings" sub="Super Admin only.">
    <div className="stack" style={{ maxWidth: 560, gap: 16 }}>
      <div className="card"><div className="card__head">Maintenance mode</div><div className="card__body"><label className="checkrow"><input type="checkbox" checked={data.maintenance.enabled} onChange={(e) => save({ maintenance: { ...data.maintenance, enabled: e.target.checked } })} /><span>Show a maintenance page to everyone except Super Admins</span></label></div></div>
      <div className="card"><div className="card__head">Password policy</div><div className="card__body"><dl className="kv"><dt>Minimum length</dt><dd>{data.passwordPolicy.minLength}</dd><dt>Lock after</dt><dd>{data.passwordPolicy.lockoutAttempts} attempts for {data.passwordPolicy.lockoutMinutes} min</dd></dl></div></div>
      <div className="card"><div className="card__head">Uploads and retention</div><div className="card__body"><dl className="kv"><dt>Max file</dt><dd>{data.uploads.maxMb} MB ({data.uploads.types.join(', ')})</dd><dt>Audit retention</dt><dd>{data.retention.auditYears} years</dd><dt>Removed messages</dt><dd>{data.retention.removedMessageDays} days</dd><dt>Email (SMTP)</dt><dd>{data.smtp.host}:{data.smtp.port}</dd></dl></div></div></div></Shell>)
}
export { Tabs }
