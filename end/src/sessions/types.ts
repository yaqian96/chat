export type MessageRole = 'user' | 'assistant'

export interface SessionMessage {
  id: string
  role: MessageRole
  content: string
  createdAt: string
}

export interface SessionMeta {
  id: string
  userId: string
  title: string
  createdAt: string
  updatedAt: string
}

export interface SessionDetail extends SessionMeta {
  messages: SessionMessage[]
}

export interface HistorySessionItem {
  id: string
  title: string
}

export interface HistoryGroup {
  label: string
  sessions: HistorySessionItem[]
}
