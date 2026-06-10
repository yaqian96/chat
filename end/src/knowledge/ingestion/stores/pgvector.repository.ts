import { Injectable } from '@nestjs/common'
import { DatabaseService } from '../../../database/database.service'

@Injectable()
export class PgVectorRepository {
  constructor(private readonly db: DatabaseService) {}

  async upsertEmbeddings(
    chunks: Array<{ chunkId: string; embedding: number[] }>,
  ): Promise<void> {
    const pool = this.db.getPool()
    const sql = `
      UPDATE document_chunks
      SET embedding = $2::vector,
          embedded_at = NOW()
      WHERE id = $1
    `

    for (const chunk of chunks) {
      const vectorStr = `[${chunk.embedding.join(',')}]`
      await pool.query(sql, [chunk.chunkId, vectorStr])
    }
  }

  async clearEmbeddingsByDocId(docId: string): Promise<void> {
    await this.db.getPool().query(
      `UPDATE document_chunks SET embedding = NULL, embedded_at = NULL WHERE doc_id = $1`,
      [docId],
    )
  }
}
