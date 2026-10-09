import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Button, ErrorState, Loading, Page, PageHead, Progress, Stat, Tabs } from '../../components/ui'
import { api } from '../../lib/api'
import { fileHref } from '../../lib/api'
import { useFetch } from '../../lib/useFetch'
import { useUi } from '../../store/ui'
import type { AckReport } from './types'

export default function AckReportPage() {
  const { id } = useParams()
  const { data, error, loading, reload } = useFetch<AckReport>(`/board/${id}/acks`)
  const toast = useUi((s) => s.toast)
  const [tab, setTab] = useState<'pending' | 'done'>('pending')
  if (loading && !data) return <Loading />
  if (error || !data) return <ErrorState error={error} />
  const people = data.people.filter((p) => (tab === 'pending' ? !p.acknowledged : p.acknowledged))
  const act = async (path: string, msg: (r: any) => string) => { try { toast(msg(await api.post(path))); reload() } catch (e: any) { toast(e.message, 'error') } }
  return (
    <Page>
      <PageHead crumb="Announcements" title="Acknowledgements" sub={data.title}
        actions={<>
          <Button onClick={() => act(`/board/${id}/remind`, (r) => `Reminder sent to ${r.reminded} people`)}>Remind everyone pending</Button>
          <Button onClick={() => act(`/board/${id}/nudge`, (r) => r.nudged.length ? `Nudged ${r.nudged.join(', ')} through their CR lines` : 'Every cohort is above the target')}>Nudge via CR line</Button>
          <a className="btn btn--secondary" href={fileHref(`/api/board/${id}/acks.csv`)}>Export CSV</a>
          <Link className="btn btn--secondary" to={`/board/${id}`}>Back</Link>
        </>} />
      <div className="stats">
        <Stat label="Acknowledged" value={`${data.rate}%`} sub={`${data.acked} of ${data.total}`} tone={data.rate >= 90 ? 'good' : data.rate < 60 ? 'warn' : undefined} />
        <Stat label="Pending" value={data.remaining} sub="people have not acknowledged" />
      </div>
      <h2 className="card__head" style={{ padding: 0, border: 0, marginBottom: 8 }}>By cohort</h2>
      <div className="tablewrap" style={{ marginBottom: 24 }}><table className="table"><thead><tr><th>Cohort</th><th>Receipts</th><th>Rate</th><th style={{ width: 200 }} /></tr></thead>
        <tbody>{data.cohorts.map((c) => <tr key={c.code}><td className="mono">{c.code}</td><td className="mono">{c.acked} / {c.total}</td><td className="mono">{c.rate}%</td><td><Progress pct={c.rate} tone={c.status === 'OK' ? 'good' : c.status === 'LAG' ? 'bad' : undefined} /></td></tr>)}</tbody></table></div>
      <Tabs value={tab} onChange={setTab} items={[{ id: 'pending', label: 'Not yet', count: data.remaining }, { id: 'done', label: 'Acknowledged', count: data.acked }]} />
      <div className="tablewrap"><table className="table"><thead><tr><th>ID</th><th>Name</th><th>Batch</th><th>When</th></tr></thead>
        <tbody>{people.slice(0, 200).map((p) => <tr key={p.id}><td className="mono">{p.uid}</td><td>{p.name}</td><td className="mono">{p.batch || '—'}</td><td className="mono muted">{p.at ? new Date(p.at).toLocaleString('en-GB') : '—'}</td></tr>)}</tbody></table></div>
    </Page>
  )
}
