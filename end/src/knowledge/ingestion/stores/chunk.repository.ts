import { Injectable } from '@nestjs/common'
import type { Document } from '@langchain/core/documents'
import { DatabaseService } from '../../../database/database.service'
import { estimateTokenCount } from '../utils/hash'
import type { ChunkType } from '../types'

export interface SavedChunk {
  id: string
  docId: string
  chunkIndex: number
  text: string
  chunkHash: string
}

@Injectable()
export class ChunkRepository {
  constructor(private readonly db: DatabaseService) {}

  async deleteByDocId(docId: string): Promise<void> {
    await this.db.getPool().query(
      'DELETE FROM document_chunks WHERE doc_id = $1',
      [docId],
    )
  }

  async existsByHash(userId: string, chunkHash: string): Promise<boolean> {
    const { rows } = await this.db.getPool().query<{ exists: boolean }>(
      `SELECT EXISTS (
        SELECT 1 FROM document_chunks c
        JOIN documents d ON d.id = c.doc_id
        WHERE c.chunk_hash = $1 AND d.user_id = $2
      ) AS exists`,
      [chunkHash, userId],
    )
    return rows[0]?.exists ?? false
  }

  async saveBatch(
    docId: string,
    chunks: Document[],
  ): Promise<SavedChunk[]> {
    const pool = this.db.getPool()
    const saved: SavedChunk[] = []

    for (const chunk of chunks) {
      const chunkIndex = chunk.metadata.chunkIndex as number
      const chunkHash = chunk.metadata.chunkHash as string
      const chunkType = (chunk.metadata.chunkType as ChunkType) ?? 'paragraph'
      const headingPath = (chunk.metadata.headingPath as string[]) ?? []
      const pageNumber = chunk.metadata.pageNumber as number | undefined
      const quality = (chunk.metadata.quality as string) ?? 'ok'
      const charCount = chunk.pageContent.length
      const tokenCount =
        (chunk.metadata.tokenCount as number) ?? estimateTokenCount(chunk.pageContent)

      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO document_chunks (
          doc_id, chunk_index, text, token_count, chunk_type,
          heading_path, page_number, chunk_hash, char_count, quality
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING id`,
        [
          docId,
          chunkIndex,
          chunk.pageContent,
          tokenCount,
          chunkType,
          headingPath,
          pageNumber ?? null,
          chunkHash,
          charCount,
          quality,
        ],
      )

      saved.push({
        id: rows[0].id,
        docId,
        chunkIndex,
        text: chunk.pageContent,
        chunkHash,
      })
    }

    return saved
  }
}
