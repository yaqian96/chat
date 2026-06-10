export type DocumentSource = 'youdao' | 'upload'
export type ChunkType = 'paragraph' | 'section' | 'code' | 'table' | 'list' | 'page'
export type DocumentStatus =
  | 'pending'
  | 'parsing'
  | 'chunked'
  | 'embedded'
  | 'indexed'
  | 'failed'

export interface DocumentRow {
  id: string
  user_id: string
  source: DocumentSource
  source_id: string
  title: string
  file_name: string | null
  mime_type: string | null
  raw_path: string | null
  plain_text: string | null
  content_hash: string
  folder_id: string | null
  language: string | null
  page_count: number | null
  status: DocumentStatus
  error_message: string | null
  synced_at: string | null
  created_at: string
  updated_at: string
}

export interface IngestJobRow {
  id: string
  doc_id: string
  user_id: string
  status: 'queued' | 'running' | 'success' | 'failed'
  attempt: number
  error_message: string | null
  started_at: string | null
  finished_at: string | null
  created_at: string
}

export interface IngestResult {
  docId: string
  chunkCount: number
  skipped?: boolean
}

export interface UploadFileResult {
  fileId: string
  docId: string
  title: string
  status: 'processing' | 'indexed' | 'failed'
}
