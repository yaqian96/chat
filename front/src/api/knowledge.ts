import type {
  YoudaoNotesConfig,
  YoudaoSyncMeta,
  YoudaoSyncResult,
} from '@/types/knowledge'
import { authHeaders, clearAuth } from '@/stores/auth'

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
    let message = text
    try {
      const json = JSON.parse(text) as { message?: string | string[] }
      message = Array.isArray(json.message)
        ? json.message.join(', ')
        : (json.message ?? text)
    } catch {
      // keep raw text
    }
    throw new Error(message || `Request failed: ${res.status}`)
  }
  return res.json() as Promise<T>
}

export interface YoudaoConfigPublic {
  apiKeyConfigured: boolean
  apiKeyMasked: string
  folderId: string
  syncEnabled: boolean
  syncIntervalMinutes: number
}

export const knowledgeApi = {
  getYoudaoConfig(): Promise<YoudaoConfigPublic> {
    return request('/knowledge/youdao/config')
  },

  saveYoudaoConfig(config: YoudaoNotesConfig): Promise<YoudaoConfigPublic> {
    return request('/knowledge/youdao/config', {
      method: 'PUT',
      body: JSON.stringify(config),
    })
  },

  testYoudaoConnection(): Promise<{
    ok: boolean
    tools: string[]
    message: string
  }> {
    return request('/knowledge/youdao/test', { method: 'POST' })
  },

  syncYoudaoNotes(): Promise<YoudaoSyncResult> {
    return request('/knowledge/youdao/sync', { method: 'POST' })
  },

  getYoudaoStatus(): Promise<YoudaoSyncMeta> {
    return request('/knowledge/youdao/status')
  },

  uploadFiles(files: File[]): Promise<{
    files: Array<{
      fileId: string
      docId: string
      title: string
      status: 'processing' | 'indexed' | 'failed'
    }>
  }> {
    const form = new FormData()
    for (const file of files) {
      form.append('files', file)
    }
    return fetch('/api/knowledge/upload', {
      method: 'POST',
      headers: authHeaders(),
      body: form,
    }).then(async (res) => {
      if (res.status === 401) {
        clearAuth()
        throw new Error('UNAUTHORIZED')
      }
      if (!res.ok) {
        const text = await res.text()
        let message = text
        try {
          const json = JSON.parse(text) as { message?: string | string[] }
          message = Array.isArray(json.message)
            ? json.message.join(', ')
            : (json.message ?? text)
        } catch {
          // keep raw text
        }
        throw new Error(message || `Upload failed: ${res.status}`)
      }
      return res.json()
    })
  },

  getIngestStatus(): Promise<{
    total: number
    indexed: number
    pending: number
    failed: number
    jobs: Array<{
      docId: string
      title: string
      status: string
      docStatus: string
      error: string | null
    }>
  }> {
    return request('/knowledge/ingest/status')
  },
}
