export type SearchChannel = 'vector' | 'bm25' | 'graph'

export interface ChunkSearchHit {
  chunkId: string
  docId: string
  text: string
  title: string
  source: string
  score: number
  channel: SearchChannel
  headingPath?: string[]
  metadata?: Record<string, unknown>
}

export interface HybridSearchOptions {
  topK?: number
  userId: string
  source?: string
}

export interface HybridSearchResult {
  query: string
  hits: ChunkSearchHit[]
  channels: {
    vector: number
    bm25: number
    graph: number
  }
}

export interface ChunkIndexRecord {
  chunkId: string
  docId: string
  userId: string
  title: string
  source: string
  text: string
  headingPath: string[]
  chunkType: string
}
