import { Injectable } from '@nestjs/common'
import { DatabaseService } from '../../../database/database.service'
import type { IngestJobRow } from '../types'

@Injectable()
export class IngestJobRepository {
  constructor(private readonly db: DatabaseService) {}

  async create(docId: string, userId: string): Promise<IngestJobRow> {
    const { rows } = await this.db.getPool().query<IngestJobRow>(
      `INSERT INTO ingest_jobs (doc_id, user_id, status)
       VALUES ($1, $2, 'queued')
       RETURNING *`,
      [docId, userId],
    )
    return rows[0]
  }

  async markRunning(id: string): Promise<void> {
    await this.db.getPool().query(
      `UPDATE ingest_jobs SET
        status = 'running',
        attempt = attempt + 1,
        started_at = NOW()
      WHERE id = $1`,
      [id],
    )
  }

  async markSuccess(id: string): Promise<void> {
    await this.db.getPool().query(
      `UPDATE ingest_jobs SET
        status = 'success',
        finished_at = NOW(),
        error_message = NULL
      WHERE id = $1`,
      [id],
    )
  }

  async markFailed(id: string, errorMessage: string): Promise<void> {
    await this.db.getPool().query(
      `UPDATE ingest_jobs SET
        status = 'failed',
        finished_at = NOW(),
        error_message = $2
      WHERE id = $1`,
      [id, errorMessage],
    )
  }

  async listByUser(userId: string, limit = 50): Promise<
    Array<IngestJobRow & { title: string; doc_status: string }>
  > {
    const { rows } = await this.db.getPool().query<
      IngestJobRow & { title: string; doc_status: string }
    >(
      `SELECT j.*, d.title, d.status AS doc_status
       FROM ingest_jobs j
       JOIN documents d ON d.id = j.doc_id
       WHERE j.user_id = $1
       ORDER BY j.created_at DESC
       LIMIT $2`,
      [userId, limit],
    )
    return rows
  }
}
