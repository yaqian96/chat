import type { ChatMessage, ChatSession, HistoryGroup } from '@/types/chat'
import { authHeaders, clearAuth } from '@/stores/auth'

export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch('/api/health', { signal: AbortSignal.timeout(5000) })
    return res.ok
  } catch {
    return false
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...options?.headers,
    },
    ...options,
  })

  if (res.status === 401) {
    clearAuth()
    throw new Error('UNAUTHORIZED')
  }

  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `Request failed: ${res.status}`)
  }
  if (res.status === 204 || res.headers.get('content-length') === '0') {
    return undefined as T
  }
  const text = await res.text()
  if (!text) return undefined as T
  return JSON.parse(text) as T
}

interface SessionDetailDto {
  id: string
  userId: string
  title: string
  createdAt: string
  updatedAt: string
  messages: {
    id: string
    role: 'user' | 'assistant'
    content: string
    createdAt: string
  }[]
}

function toChatSession(dto: SessionDetailDto): ChatSession {
  return {
    id: dto.id,
    title: dto.title,
    updatedAt: new Date(dto.updatedAt),
    messages: dto.messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: new Date(m.createdAt),
    })),
  }
}

export const api = {
  getHistory(): Promise<HistoryGroup[]> {
    return request('/sessions/history')
  },

  getSession(id: string): Promise<ChatSession> {
    return request<SessionDetailDto>(`/sessions/${id}`).then(toChatSession)
  },

  createSession(title = '新对话'): Promise<ChatSession> {
    return request<SessionDetailDto>('/sessions', {
      method: 'POST',
      body: JSON.stringify({ title }),
    }).then(toChatSession)
  },

  deleteSession(sessionId: string): Promise<void> {
    return request(`/sessions/${sessionId}`, { method: 'DELETE' })
  },

  addMessage(
    sessionId: string,
    role: ChatMessage['role'],
    content: string,
  ): Promise<ChatMessage> {
    return request<{
      id: string
      role: ChatMessage['role']
      content: string
      createdAt: string
    }>(`/sessions/${sessionId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ role, content }),
    }).then((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: new Date(m.createdAt),
    }))
  },
}
