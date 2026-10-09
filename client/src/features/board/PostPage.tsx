import { useParams, Link } from 'react-router-dom'
import { ErrorState, Loading, Page, PageHead } from '../../components/ui'
import { useFetch } from '../../lib/useFetch'
import { PostCard } from './Board'
import type { Post } from './types'

export function PostPage() {
  const { id } = useParams()
  const { data, error, loading, setData } = useFetch<Post>(`/board/${id}`)
  if (loading && !data) return <Loading />
  if (error || !data) return <ErrorState error={error} />
  return <Page narrow><PageHead crumb="Announcements" title="Notice" actions={<Link className="btn btn--secondary" to="/board">All announcements</Link>} /><div className="board"><PostCard p={data} full onChange={setData as any} /></div></Page>
}

export function Versions() {
  const { id } = useParams()
  const { data, error, loading } = useFetch<{ title: string; body: string; current?: boolean; by?: string; at: string }[]>(`/board/${id}/versions`)
  if (loading) return <Loading />
  if (error) return <ErrorState error={error} />
  return (
    <Page narrow><PageHead crumb="Announcements" title="Version history" sub="Earlier versions are kept so notices can't change silently." actions={<Link className="btn btn--secondary" to={`/board/${id}`}>Back to notice</Link>} />
      <div className="stack">{data?.map((v, i) => (
        <div className="card" key={i}><div className="card__head"><span>{v.current ? 'Current version' : `Version ${data.length - i}`}</span><span className="mono muted" style={{ fontSize: 12 }}>{new Date(v.at).toLocaleString('en-GB')}{v.by ? ` · ${v.by}` : ''}</span></div><div className="card__body"><b style={{ fontFamily: 'var(--font-serif)', fontSize: 18 }}>{v.title}</b><p style={{ whiteSpace: 'pre-wrap' }}>{v.body}</p></div></div>
      ))}</div>
    </Page>
  )
}
