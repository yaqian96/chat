import { authHeaders, clearAuth } from '@/stores/auth'

export interface StreamChatEvent {
  type: 'token' | 'done' | 'meta' | 'error'
  content?: string
  meta?: Record<string, unknown>
}

export interface StreamChatResult {
  ok: boolean
  error?: string
}

export async function streamChat(
  sessionId: string,
  message: string,
  onEvent: (event: StreamChatEvent) => void,
): Promise<StreamChatResult> {
  const res = await fetch(`/api/sessions/${sessionId}/chat/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: JSON.stringify({ message }),
  })

  if (res.status === 401) {
    clearAuth()
    throw new Error('UNAUTHORIZED')
  }

  if (!res.ok || !res.body) {
    const text = await res.text()
    throw new Error(text || `Stream failed: ${res.status}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let ok = false
  let error: string | undefined

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const payload = line.slice(6).trim()
      if (!payload) continue
      try {
        const event = JSON.parse(payload) as StreamChatEvent
        onEvent(event)
        if (event.type === 'done') ok = true
        if (event.type === 'error') error = event.content ?? '对话生成失败'
      } catch {
        // skip malformed chunk
      }
    }
  }

  return { ok, error }
}
