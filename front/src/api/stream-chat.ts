import { authHeaders, clearAuth } from '@/stores/auth'

export interface StreamChatEvent {
  type: 'token' | 'done' | 'meta' | 'error' | 'interrupted'
  content?: string
  meta?: Record<string, unknown>
}

export interface StreamChatResult {
  ok: boolean
  error?: string
  interrupted?: boolean
}

export interface StreamChatOptions {
  onEvent: (event: StreamChatEvent) => void
  signal?: AbortSignal
}

export async function streamChat(
  sessionId: string,
  message: string,
  options: StreamChatOptions | ((event: StreamChatEvent) => void),
): Promise<StreamChatResult> {
  // 支持两种调用方式：旧版 (onEvent) 和新版 (options 对象)
  const onEvent = typeof options === 'function' ? options : options.onEvent
  const signal = typeof options === 'object' ? options.signal : undefined

  const res = await fetch(`/api/sessions/${sessionId}/chat/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: JSON.stringify({ message }),
    signal, // 传递 abort 信号
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
  let interrupted = false

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
        if (event.type === 'interrupted') {
          interrupted = true
          // 携带已生成的内容
          if (event.content) {
            onEvent({ type: 'token', content: event.content })
          }
        }
      } catch {
        // skip malformed chunk
      }
    }
  }

  return { ok, error, interrupted }
}
