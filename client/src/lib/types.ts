export interface PersonCard {
  id: string; uid: string; name: string; initials: string; kind: 'STUDENT' | 'STAFF'; status: string
  badges: string[]; designation?: string; dept?: string; batch?: string; cabin?: string; roles?: string[]
}
export interface SidebarItem {
  id: string; kind: string; template?: string; name: string; glyph?: string; restricted?: boolean; announceOnly?: boolean
  code?: string; unread: number; via?: string; role?: string; lastMessageAt?: string; peer?: PersonCard
}
export interface Sidebar {
  term: { code: string; name: string } | null
  announcements: { unread: number }
  roleGroups: SidebarItem[]; classes: SidebarItem[]; crLines: SidebarItem[]; customGroups: SidebarItem[]
  channels: { id: string; slug: string; name: string; unread: number; tag?: string }[]
  desks: { id: string; slug: string; name: string; kind: string; mode: 'agent' | 'requester'; open: number }[]
  directMessages: SidebarItem[]
}
export interface Capabilities {
  superAdmin: boolean; admin: boolean; dept: boolean; deptManage: boolean; deptHod: boolean; publishBoard: boolean; publishChannels: boolean
  moderateChannels: boolean; deskAgent: boolean; examCell: boolean; reports: boolean; relay: boolean; forwardBoard: boolean
}
export interface Me {
  user: PersonCard & { email: string; department: { id: string; code: string; name: string } | null; batch: { id: string; code: string } | null; mustChangePassword: boolean; settings: Record<string, unknown> }
  roles: { role: string; label: string; orgUnit?: string }[]
  landing: string; capabilities: Capabilities; sidebar: Sidebar; notifications: { unread: number }
}
export interface Attachment { id?: string; name: string; size?: number; mime?: string; url: string; label?: string }
export interface Message {
  id: string; groupId?: string; sender: { id: string; name: string; uid?: string; badges?: string[]; dept?: string; course?: string; initials: string }
  body: string; deleted: boolean; deleteReason?: string; kind: 'TEXT' | 'SYSTEM' | 'DIRECTIVE'; attachments: Attachment[]
  replyTo?: string; threadOf?: string; threadCount: number; mentions: string[]
  relayOf?: { messageId: string; groupId: string; sourceName?: string; course?: string }
  relayedTo: { groupId: string; groupName: string; byName: string; at: string }[]
  forwardOf?: { announcementId: string; title: string }
  reactions: { emoji: string; count: number; mine: boolean }[]
  pinned: boolean; postedAs?: string; editedAt?: string; clientId?: string; createdAt: string
  pending?: boolean; failed?: string; ticketId?: string; internal?: boolean
}
export interface Composer { canPost: boolean; code?: string; message?: string; postedAs?: string; prefix?: string; deskLink?: { slug: string; label: string } }
export interface GroupSummary {
  group: { id: string; name: string; kind: string; template?: string; glyph?: string; description?: string; mandate?: string; announceOnly: boolean; slowModeSeconds: number; restricted: boolean; archived: boolean; rules: string[]; memberCount: number; code: string; orgUnit?: string }
  managers: PersonCard[]; moderators: PersonCard[]; whoCanPost: string; composer: Composer
  me: { via?: string; groupRole?: string; isManager: boolean; isModerator: boolean }
  pinned: { id: string; body: string; sender?: string; attachments: Attachment[] }[]
  files: (Attachment & { messageId: string; by?: string; at: string })[]
  batch?: { id: string; code: string; section?: string }; crs?: PersonCard[]; studentCount?: number
  faculty?: { courseCode: string; title: string; teacher: (PersonCard & { email?: string }) | null; room?: string }[]
  relayTarget?: { id: string; name: string }; crLine?: { id: string; name: string }
}
export interface Notice { id: string; type: string; title: string; body?: string; link?: string; read: boolean; at: string }
