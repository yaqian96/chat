import { Injectable } from '@nestjs/common'
import { Document } from '@langchain/core/documents'
import { DatabaseService } from '../../database/database.service'
import { EmbeddingService } from '../ingestion/embedders/embedding.service'
import type { ChunkSearchHit } from './types'

@Injectable()
export class VectorRetriever {
  constructor(
    private readonly db: DatabaseService,
    private readonly embedding: EmbeddingService,
  ) {}

  async search(
    query: string,
    userId: string,
    topK: number,
  ): Promise<ChunkSearchHit[]> {
    if (!this.db.isAvailable() || !this.embedding.isConfigured()) {
      return []
    }

    const vectors = await this.embedding.embedDocuments([
      new Document({ pageContent: query, metadata: {} }),
    ])
    const queryVector = vectors[0]?.vector
    if (!queryVector?.length) return []

    const vectorStr = `[${queryVector.join(',')}]`
    const { rows } = await this.db.getPool().query<{
      chunk_id: string
      doc_id: string
      text: string
      title: string
      source: string
      heading_path: string[] | null
      score: number
    }>(
      `SELECT
        c.id AS chunk_id,
        c.doc_id,
        c.text,
        d.title,
        d.source,
        c.heading_path,
        1 - (c.embedding <=> $2::vector) AS score
      FROM document_chunks c
      JOIN documents d ON d.id = c.doc_id
      WHERE d.user_id = $1
        AND c.embedding IS NOT NULL
        AND c.quality = 'ok'
      ORDER BY c.embedding <=> $2::vector
      LIMIT $3`,
      [userId, vectorStr, topK],
    )

    return rows.map((row) => ({
      chunkId: row.chunk_id,
      docId: row.doc_id,
      text: row.text,
      title: row.title,
      source: row.source,
      headingPath: row.heading_path ?? undefined,
      score: Number(row.score),
      channel: 'vector' as const,
    }))
  }
}
