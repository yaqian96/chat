export type KnowledgeTab = 'youdao' | 'local'

export interface YoudaoNotesConfig {
  apiKey: string
  folderId: string
  syncEnabled: boolean
  syncIntervalMinutes: number
}

export interface YoudaoSyncMeta {
  lastSyncedAt: string | null
  noteCount: number
  status: 'idle' | 'syncing' | 'success' | 'error'
  lastError?: string
  indexedCount?: number
  pendingIngest?: number
}

export interface YoudaoSyncResult {
  synced: number
  skipped: number
  ingested: number
  lastSyncedAt: string
  notes: Array<{ id: string; title: string; syncedAt: string }>
}

export interface LocalKnowledgeFile {
  id: string
  name: string
  size: number
  type: string
  file?: File
  status: 'pending' | 'uploading' | 'done' | 'error'
  error?: string
  docId?: string
}

export const SUPPORTED_FILE_TYPES = ['.pdf', '.txt', '.md', '.docx', '.xlsx'] as const

export const SUPPORTED_FILE_ACCEPT = SUPPORTED_FILE_TYPES.join(',')
