import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { Alert, Avatar, Button, ErrorState, Field, Loading, Page, PageHead, Stat, Status, Tabs } from '../../components/ui'
import { Dialog } from '../chat/dialogs'
import { api, fileHref } from '../../lib/api'
import { useFetch } from '../../lib/useFetch'
import { useAuth } from '../../store/auth'
import { useUi } from '../../store/ui'
import type { PersonCard } from '../../lib/types'

interface Batch { id: string; code: string; section?: string; program: string; intake: string; year: number; advisor: { id: string; name: string; designation?: string } | null; crs: { id: string; name: string; uid: string; initials: string }[]; classSize: number; relayStatus: string; channelPermission: string; classGroupId?: string; expectedGraduation?: string }
interface Dash { dept: { id: string; code: string; name: string }; term: string; kpis: { enrolledCohort: { batches: number; students: number }; instructionalGrid: { instructors: number; crLinesSynced: number; offerings: number }; deskSla: { resolutionRate: number; openTickets: number; deskSlug?: string } }; crGaps: { id: string; code: string }[]; latestPosts: { id: string; title: string; createdAt: string }[] }

export function DeptIndex() {
  const { data, loading } = useFetch<{ id: string; code: string; name: string }[]>('/dept/mine')
  if (loading) return <Loading />
  if (!data?.length) return <ErrorState error={{ message: 'You do not manage a department.', code: 'FORBIDDEN' }} />
  return <Navigate to={`/dept/${data[0].id}`} replace />
}

export default function Dept() {
  const { deptId = '', tab: tabParam } = useParams()
  const me = useAuth((s) => s.me)!
  const tab = (tabParam ?? 'batches') as 'batches' | 'oversight' | 'offerings' | 'teachers' | 'students'
  const nav = useNavigate()
  const { data: dash, error, loading } = useFetch<Dash>(`/dept/${deptId}/dashboard`)
  const [creating, setCreating] = useState(false)
  if (loading && !dash) return <Loading />
  if (error || !dash) return <ErrorState error={error} />
  const k = dash.kpis
  return (
    <Page>
      <PageHead crumb={`Department · ${dash.dept.code} · ${dash.term}`} title={dash.dept.name} sub="Batches, class representatives, course offerings and faculty."
        actions={<>{me.capabilities.deptManage && <Button variant="primary" onClick={() => setCreating(true)}>New batch</Button>}<a className="btn btn--secondary" href={fileHref(`/api/dept/${deptId}/audit-export`)}>Export CSV</a></>} />
      <div className="stats">
        <Stat label="Enrolled cohort" value={`${k.enrolledCohort.batches} batches`} sub={`${k.enrolledCohort.students} active students`} />
        <Stat label="Instructional grid" value={`${k.instructionalGrid.instructors} instructors`} sub={`${k.instructionalGrid.crLinesSynced} CR lines synced · ${k.instructionalGrid.offerings} offerings`} />
        <Stat label="Desk response" value={`${k.deskSla.resolutionRate}%`} sub={`${k.deskSla.openTickets} open tickets`} tone="good" />
        <Stat label="CR gaps" value={dash.crGaps.length} sub={dash.crGaps.map((g) => g.code).join(', ') || 'Every batch has a CR'} tone={dash.crGaps.length ? 'warn' : 'good'} />
      </div>
      <Tabs value={tab} onChange={(t) => nav(`/dept/${deptId}/${t}`)} items={[{ id: 'batches', label: 'Batches' }, { id: 'oversight', label: 'Classes and CR lines' }, { id: 'offerings', label: 'Course offerings' }, { id: 'teachers', label: 'Faculty' }, { id: 'students', label: 'Student lookup' }]} />
      {tab === 'batches' && <Batches deptId={deptId} canManage={me.capabilities.deptManage} />}
      {tab === 'oversight' && <Oversight deptId={deptId} />}
      {tab === 'offerings' && <Offerings deptId={deptId} canManage={me.capabilities.deptManage} />}
      {tab === 'teachers' && <Teachers deptId={deptId} canHod={me.capabilities.deptHod} />}
      {tab === 'students' && <Students deptId={deptId} />}
      {creating && <NewBatch deptId={deptId} onClose={() => setCreating(false)} />}
    </Page>
  )
}

function Batches({ deptId, canManage }: { deptId: string; canManage: boolean }) {
  const [status, setStatus] = useState<'active' | 'archived'>('active'); const [q, setQ] = useState('')
  const { data, loading, reload } = useFetch<{ items: Batch[]; total: number }>(`/dept/${deptId}/batches?status=${status}&q=${encodeURIComponent(q)}&limit=50`)
  const toast = useUi((s) => s.toast)
  async function perm(b: Batch) { try { await api.patch(`/dept/batches/${b.id}`, { announceOnly: b.channelPermission !== 'Announce-Only' }); reload() } catch (e: any) { toast(e.message, 'error') } }
  return (
    <>
      <div className="toolbar"><Tabs value={status} onChange={setStatus} items={[{ id: 'active', label: 'Active' }, { id: 'archived', label: 'Archived' }]} /><input className="input" style={{ marginLeft: 'auto' }} placeholder="Filter by batch code" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      {loading && !data ? <Loading /> : <div className="tablewrap"><table className="table"><thead><tr><th>Batch</th><th>Program</th><th>Advisor</th><th>CR</th><th>Class size</th><th>Relay</th><th>Channel</th><th /></tr></thead><tbody>
        {data?.items.map((b) => <tr key={b.id}><td><Link className="mono" style={{ color: 'var(--primary)' }} to={`/dept/batch/${b.id}`}>{b.code}</Link></td><td>{b.program}</td><td>{b.advisor?.name ?? <span className="muted">—</span>}</td><td>{b.crs.length ? b.crs.map((c) => c.name).join(', ') : <span className="muted">None</span>}</td><td className="mono">{b.classSize}</td><td><span className={`status ${b.relayStatus === 'SYNCHRONIZED' ? 'status--resolved' : 'status--open'}`}>{b.relayStatus === 'SYNCHRONIZED' ? 'Synced' : 'No CR yet'}</span></td><td>{canManage ? <button className="btn btn--quiet" onClick={() => perm(b)}>{b.channelPermission}</button> : b.channelPermission}</td><td><Link className="btn btn--quiet" to={`/dept/batch/${b.id}`}>Dossier</Link></td></tr>)}
        {data?.items.length === 0 && <tr><td colSpan={8} className="muted">No batches.</td></tr>}</tbody></table></div>}
    </>
  )
}

function NewBatch({ deptId, onClose }: { deptId: string; onClose: () => void }) {
  const [programCode, setProgramCode] = useState(''); const [intake, setIntake] = useState<'FA' | 'SP'>('FA'); const [year, setYear] = useState(new Date().getFullYear())
  const [preview, setPreview] = useState<{ code: string | null; exists: boolean } | null>(null)
  const [codes, setCodes] = useState<string[]>([])
  const nav = useNavigate(); const toast = useUi((s) => s.toast); const [err, setErr] = useState<string | null>(null)
  useEffect(() => { // programs of this department come from the org list in the admin API for admins, else derived from roles
    api.get<{ programs: { code: string }[] }>(`/dept/${deptId}/programs`).then((r) => { setCodes(r.programs.map((p) => p.code)); setProgramCode(r.programs[0]?.code ?? '') }).catch(() => {})
  }, [deptId])
  useEffect(() => { if (programCode) api.post<{ code: string | null; exists: boolean }>('/dept/batches/preview', { programCode, intake, year }).then(setPreview).catch(() => {}) }, [programCode, intake, year])
  async function go() { try { const r = await api.post<{ id: string }>('/dept/batches', { programCode, intake, year }); toast(`${preview?.code} created with its class group and CR line`); useAuth.getState().refreshMe(); onClose(); nav(`/dept/batch/${r.id}`) } catch (e: any) { setErr(e.message) } }
  return (
    <Dialog title="New batch" onClose={onClose} actions={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!preview?.code || preview.exists} onClick={go}>Create batch</Button></>}>
      <div className="field"><label className="field__label">Program</label><select className="input" value={programCode} onChange={(e) => setProgramCode(e.target.value)}>{codes.map((c) => <option key={c}>{c}</option>)}</select></div>
      <div className="formgrid"><div className="field"><label className="field__label">Intake</label><div className="seg">{(['FA', 'SP'] as const).map((i) => <button key={i} aria-pressed={intake === i} onClick={() => setIntake(i)}>{i === 'FA' ? 'Fall' : 'Spring'}</button>)}</div></div><Field label="Year" type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} /></div>
      <div className="alert" style={{ flexDirection: 'column' }}><span className="aside__label">Batch code</span><b className="mono" style={{ fontSize: 24 }}>{preview?.code ?? '—'}</b>{preview?.exists ? <span style={{ color: 'var(--danger)' }}>This batch already exists.</span> : <span>Creating it also creates the class group and the CR line.</span>}</div>
      {err && <Alert tone="error">{err}</Alert>}
    </Dialog>
  )
}

export function BatchDossier() {
  const { id } = useParams()
  const { data, loading, error, reload } = useFetch<{ batch: { id: string; code: string; program: string; dept: string; status: string; section?: string; expectedGraduation?: string }; students: (PersonCard & { isCR: boolean; semester?: number })[]; crs: PersonCard[]; classGroup: { id: string; name: string; announceOnly: boolean } | null; crLine: { id: string; name: string } | null; offerings: { id: string; courseCode: string; title: string; teacher: PersonCard | null }[] }>(`/dept/batches/${id}`)
  const [tab, setTab] = useState<'crs' | 'students' | 'offerings'>('crs'); const [assign, setAssign] = useState(false)
  if (loading && !data) return <Loading />
  if (error || !data) return <ErrorState error={error} />
  const b = data.batch
  return (
    <Page>
      <PageHead crumb={`Department · ${b.dept}`} title={`Batch ${b.code}`} sub={`${b.program} · ${data.students.length} students · ${b.status.toLowerCase()}${b.expectedGraduation ? ` · graduates ${b.expectedGraduation}` : ''}`}
        actions={<>{data.classGroup && <Link className="btn btn--secondary" to={`/g/${data.classGroup.id}`}>Class group</Link>}{data.crLine && <Link className="btn btn--secondary" to={`/g/${data.crLine.id}`}>CR line</Link>}<Button variant="primary" onClick={() => setAssign(true)}>Assign or replace CR</Button></>} />
      <div className="stats"><Stat label="Class representatives" value={data.crs.length} sub={data.crs.map((c) => c.name).join(', ') || 'None assigned. Coordinators can post in the class group meanwhile.'} tone={data.crs.length ? 'good' : 'warn'} /><Stat label="Offerings this term" value={data.offerings.length} /><Stat label="Class group" value={data.classGroup?.announceOnly ? 'Announce-only' : 'Open'} /></div>
      <Tabs value={tab} onChange={setTab} items={[{ id: 'crs', label: 'Class representatives', count: data.crs.length }, { id: 'students', label: 'Students', count: data.students.length }, { id: 'offerings', label: 'Offerings', count: data.offerings.length }]} />
      {tab === 'crs' && <div className="stack">{data.crs.map((c) => <div className="card" key={c.id}><div className="card__body"><div className="row"><Avatar name={c.name} initials={c.initials} dept={c.dept} /><div style={{ flex: 1 }}><b>{c.name}</b><div className="mono muted" style={{ fontSize: 12 }}>{c.uid}</div></div><span className="badge">CR</span></div><p className="field__help">Moderator of the class group · member of CRs — {b.dept} and the CR line · can relay to the class.</p></div></div>)}{data.crs.length === 0 && <Alert>No CR yet. Pick one or two students to appoint.</Alert>}</div>}
      {tab === 'students' && <div className="tablewrap"><table className="table"><thead><tr><th>ID</th><th>Name</th><th>Semester</th><th /></tr></thead><tbody>{data.students.map((s) => <tr key={s.id}><td className="mono">{s.uid}</td><td>{s.name}</td><td className="mono">{s.semester}</td><td>{s.isCR && <span className="badge">CR</span>}</td></tr>)}</tbody></table></div>}
      {tab === 'offerings' && <div className="tablewrap"><table className="table"><thead><tr><th>Course</th><th>Title</th><th>Instructor</th></tr></thead><tbody>{data.offerings.map((o) => <tr key={o.id}><td className="mono">{o.courseCode}</td><td>{o.title}</td><td>{o.teacher?.name}</td></tr>)}</tbody></table></div>}
      {assign && <AssignCr batchId={b.id} students={data.students} current={data.crs} onClose={() => setAssign(false)} onDone={() => { setAssign(false); reload() }} />}
    </Page>
  )
}

function AssignCr({ batchId, students, current, onClose, onDone }: { batchId: string; students: PersonCard[]; current: PersonCard[]; onClose: () => void; onDone: () => void }) {
  const [picked, setPicked] = useState<string[]>(current.map((c) => c.id)); const [q, setQ] = useState(''); const [err, setErr] = useState<string | null>(null)
  const toast = useUi((s) => s.toast)
  async function go() { try { await api.put(`/dept/batches/${batchId}/crs`, { studentIds: picked }); toast('CR assignment saved. Access moved live.'); onDone() } catch (e: any) { setErr(e.meta?.reason ?? e.message) } }
  return (
    <Dialog title="Assign class representatives" onClose={onClose} actions={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!picked.length || picked.length > 2} onClick={go}>Confirm</Button></>}>
      <p className="field__help">Pick one or two students. Anyone removed loses CR access immediately and stays a student.</p>
      <Field label="Find a student" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="picker">{students.filter((s) => `${s.name} ${s.uid}`.toLowerCase().includes(q.toLowerCase())).slice(0, 30).map((s) => <label key={s.id} className="pick"><input type="checkbox" checked={picked.includes(s.id)} onChange={(e) => setPicked((p) => e.target.checked ? [...p, s.id] : p.filter((x) => x !== s.id))} /><Avatar name={s.name} initials={s.initials} dept={s.dept} /><span className="pick__main"><b>{s.name}</b><br /><span className="mono muted">{s.uid}</span></span></label>)}</div>
      {err && <Alert tone="error">{err}</Alert>}
    </Dialog>
  )
}

function Oversight({ deptId }: { deptId: string }) {
  const { data, loading } = useFetch<{ id: string; name: string; kind: string; batch: string; members: number; announceOnly: boolean }[]>(`/dept/${deptId}/oversight`)
  if (loading) return <Loading />
  return <div className="tablewrap"><table className="table"><thead><tr><th>Group</th><th>Type</th><th>Members</th><th>Mode</th><th /></tr></thead><tbody>{data?.map((g) => <tr key={g.id}><td className="mono">{g.name}</td><td>{g.kind === 'CLASS' ? 'Class group' : 'CR line'}</td><td className="mono">{g.members}</td><td>{g.announceOnly ? 'Announce-only' : 'Open'}</td><td><Link className="btn btn--quiet" to={`/g/${g.id}`}>Open</Link></td></tr>)}</tbody></table></div>
}

interface Off { id: string; courseCode: string; title: string; batch: string; batchId: string; room?: string; teacher: PersonCard | null }
function Offerings({ deptId, canManage }: { deptId: string; canManage: boolean }) {
  const { data, loading, reload } = useFetch<{ term: { code: string }; rows: Off[]; batches: { id: string; code: string; offerings: number }[]; teachers: (PersonCard & { load: number })[] }>(`/dept/${deptId}/offerings`)
  const [edit, setEdit] = useState<Partial<Off> | null>(null); const toast = useUi((s) => s.toast)
  const [f, setF] = useState({ courseCode: '', title: '', batchId: '', teacherId: '', room: '' }); const [err, setErr] = useState<string | null>(null)
  if (loading && !data) return <Loading />
  if (!data) return null
  const open = (o?: Off) => { setEdit(o ?? {}); setF({ courseCode: o?.courseCode ?? '', title: o?.title ?? '', batchId: o?.batchId ?? data.batches[0]?.id ?? '', teacherId: o?.teacher?.id ?? data.teachers[0]?.id ?? '', room: o?.room ?? '' }); setErr(null) }
  async function save() { try { await api.post(`/terms/${data!.term.code}/offerings`, { ...f, id: edit?.id }); toast('Saved. The teacher\'s CR line was updated live.'); setEdit(null); reload() } catch (e: any) { setErr(e.meta?.reason ?? e.message) } }
  async function del(o: Off) { if (!window.confirm(`Remove ${o.courseCode} from ${o.batch}?`)) return; await api.del(`/offerings/${o.id}`); reload() }
  async function csv(file?: File) { if (!file) return; const fd = new FormData(); fd.append('file', file); try { const r = await api.post<{ imported: number; errors: unknown[] }>(`/terms/${data!.term.code}/offerings/import`, fd as any); toast(`${r.imported} imported, ${r.errors.length} errors`); reload() } catch (e: any) { toast(e.message, 'error') } }
  return (
    <>
      <div className="toolbar"><span className="badge">{data.term.code}</span>{canManage && <><Button variant="primary" size="sm" onClick={() => open()}>Add offering</Button><label className="btn btn--secondary btn--sm">Import CSV<input type="file" accept=".csv" hidden onChange={(e) => csv(e.target.files?.[0])} /></label></>}<span className="muted" style={{ fontSize: 13 }}>CSV columns: courseCode, title, batch, teacher (employee ID)</span></div>
      <div className="tablewrap"><table className="table"><thead><tr><th>Code</th><th>Title</th><th>Batch</th><th>Instructor</th><th>Room</th><th /></tr></thead><tbody>{data.rows.map((o) => <tr key={o.id}><td className="mono">{o.courseCode}</td><td>{o.title}</td><td className="mono">{o.batch}</td><td>{o.teacher?.name}</td><td className="muted">{o.room}</td><td>{canManage && <><button className="btn btn--quiet" onClick={() => open(o)}>Edit</button> <button className="btn btn--quiet" style={{ color: 'var(--danger)' }} onClick={() => del(o)}>Remove</button></>}</td></tr>)}</tbody></table></div>
      <h3 className="aside__label" style={{ margin: '24px 0 8px' }}>Faculty load</h3>
      <div className="chips">{data.teachers.map((t) => <span className="chip" key={t.id}>{t.name} · {t.load}</span>)}</div>
      {edit && <Dialog title={edit.id ? 'Edit offering' : 'Add offering'} onClose={() => setEdit(null)} actions={<><Button onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" disabled={!f.courseCode} onClick={save}>Save</Button></>}>
        <div className="formgrid"><Field label="Course code" mono value={f.courseCode} onChange={(e) => setF({ ...f, courseCode: e.target.value.toUpperCase() })} /><Field label="Room" value={f.room} onChange={(e) => setF({ ...f, room: e.target.value })} /></div>
        <Field label="Title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        <div className="field"><label className="field__label">Batch</label><select className="input" value={f.batchId} onChange={(e) => setF({ ...f, batchId: e.target.value })}>{data.batches.map((b) => <option key={b.id} value={b.id}>{b.code}</option>)}</select></div>
        <div className="field"><label className="field__label">Instructor</label><select className="input" value={f.teacherId} onChange={(e) => setF({ ...f, teacherId: e.target.value })}>{data.teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select><span className="field__help">Only teachers of this department. Others must be added first.</span></div>
        {err && <Alert tone="error">{err}</Alert>}</Dialog>}
    </>
  )
}

function Teachers({ deptId, canHod }: { deptId: string; canHod: boolean }) {
  const { data, loading, reload } = useFetch<(PersonCard & { email?: string; courses: { courseCode: string; batch: string }[] })[]>(`/dept/${deptId}/teachers`)
  const [add, setAdd] = useState(false); const [f, setF] = useState({ uid: '', name: '', email: '', designation: '' }); const [err, setErr] = useState<string | null>(null); const toast = useUi((s) => s.toast)
  async function go() { try { const r = await api.post<{ temporaryPassword?: string }>(`/dept/${deptId}/teachers`, f); toast(`Teacher created. Temporary password sent by email.`); void r; setAdd(false); reload() } catch (e: any) { setErr(e.meta?.reason ?? e.message) } }
  if (loading) return <Loading />
  return (
    <>
      {canHod && <div className="toolbar"><Button variant="primary" size="sm" onClick={() => setAdd(true)}>Add teacher</Button></div>}
      <div className="tablewrap"><table className="table"><thead><tr><th>Name</th><th>ID</th><th>Roles</th><th>This term</th></tr></thead><tbody>{data?.map((t) => <tr key={t.id}><td>{t.name}<div className="muted" style={{ fontSize: 12 }}>{t.designation}</div></td><td className="mono">{t.uid}</td><td>{t.badges.map((b) => <span className="badge" key={b} style={{ marginRight: 4 }}>{b}</span>)}</td><td className="mono muted" style={{ fontSize: 12 }}>{t.courses.map((c) => `${c.courseCode}·${c.batch}`).join('  ')}</td></tr>)}</tbody></table></div>
      {add && <Dialog title="Add teacher" onClose={() => setAdd(false)} actions={<><Button onClick={() => setAdd(false)}>Cancel</Button><Button variant="primary" disabled={!f.uid || !f.name || !f.email} onClick={go}>Create</Button></>}>
        <Field label="Employee ID" mono placeholder="EMP-CS-050" value={f.uid} onChange={(e) => setF({ ...f, uid: e.target.value })} /><Field label="Full name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /><Field label="University email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /><Field label="Designation" value={f.designation} onChange={(e) => setF({ ...f, designation: e.target.value })} />{err && <Alert tone="error">{err}</Alert>}</Dialog>}
    </>
  )
}

function Students({ deptId }: { deptId: string }) {
  const [q, setQ] = useState('')
  const { data } = useFetch<(PersonCard & { semester?: number; tickets: { code: string; subject: string; status: string }[] })[]>(`/dept/${deptId}/students?q=${encodeURIComponent(q)}`, [q])
  return (<><div className="toolbar"><input className="input" style={{ minWidth: 280 }} placeholder="Name or registration number" value={q} onChange={(e) => setQ(e.target.value)} /></div>
    <p className="field__help" style={{ marginBottom: 12 }}>Lookup shows batch, CR and ticket history. Staff reach students through the CR line or a ticket, never by direct message.</p>
    <div className="tablewrap"><table className="table"><thead><tr><th>ID</th><th>Name</th><th>Batch</th><th>Tickets</th></tr></thead><tbody>{data?.map((s) => <tr key={s.id}><td className="mono">{s.uid}</td><td>{s.name}</td><td className="mono">{s.batch}</td><td>{s.tickets.map((t) => <span key={t.code} className="mono" style={{ marginRight: 8 }}>#{t.code} <Status s={t.status} /></span>)}</td></tr>)}</tbody></table></div></>)
}
