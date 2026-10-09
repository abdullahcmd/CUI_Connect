import type { Attachment } from '../../lib/types'
export interface Post {
  id: string; kind: string; scope: { id: string; type: string; code?: string; name?: string }; scopeLine: string; category: string; refNo?: string; number?: number
  title: string; body: string; attachments: Attachment[]; effectiveFrom?: string; expiresAt?: string; pinned: boolean; mandatoryAck: boolean; status: string
  author?: { id: string; name: string; badges: string[] }; officeLabel?: string; ackCount: number; audienceCount: number; acknowledged: boolean; canManage: boolean
  versionCount: number; editedAt?: string; digest?: string; signed: boolean; locked: boolean; createdAt: string; helpDesk: { slug: string; label: string }
}
export interface Feed { pinned: Post[]; latest: Post[]; items: Post[] }
export interface AckReport {
  id: string; title: string; total: number; acked: number; remaining: number; rate: number; deadline?: string
  cohorts: { code: string; total: number; acked: number; rate: number; status: 'OK' | 'WATCH' | 'LAG' }[]
  people: { id: string; uid: string; name: string; batch: string; acknowledged: boolean; at?: string }[]
}
