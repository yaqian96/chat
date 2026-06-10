export interface YoudaoNotesConfig {
  apiKey: string
  folderId: string
}

export interface YoudaoConfigPublic {
  apiKeyConfigured: boolean
  apiKeyMasked: string
  folderId: string
}

export interface YoudaoSyncMeta {
  lastSyncedAt: string | null
  noteCount: number
  status: 'idle' | 'syncing' | 'success' | 'error'
  lastError?: string
  indexedCount?: number
  pendingIngest?: number
}

export interface YoudaoNoteSummary {
  id: string
  title: string
  syncedAt: string
}

export interface YoudaoSyncResult {
  synced: number
  skipped: number
  ingested: number
  lastSyncedAt: string
  notes: YoudaoNoteSummary[]
}
