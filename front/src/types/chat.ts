export type MessageRole = 'user' | 'assistant'

export interface ChatMessage {
  id: string
  role: MessageRole
  content: string
  createdAt: Date
}

export interface ChatSession {
  id: string
  title: string
  messages: ChatMessage[]
  updatedAt: Date
}

export interface HistoryGroup {
  label: string
  sessions: { id: string; title: string }[]
}
