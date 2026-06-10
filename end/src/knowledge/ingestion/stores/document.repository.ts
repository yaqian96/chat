import { Injectable } from '@nestjs/common'
import { DatabaseService } from '../../../database/database.service'
import type { DocumentRow, DocumentSource, DocumentStatus } from '../types'

@Injectable()
export class DocumentRepository {
  constructor(private readonly db: DatabaseService) {}

  async findById(id: string): Promise<DocumentRow | null> {
    const { rows } = await this.db.getPool().query<DocumentRow>(
      'SELECT * FROM documents WHERE id = $1',
      [id],
    )
    return rows[0] ?? null
  }

  async findBySource(
    userId: string,
    source: DocumentSource,
    sourceId: string,
  ): Promise<DocumentRow | null> {
    const { rows } = await this.db.getPool().query<DocumentRow>(
      'SELECT * FROM documents WHERE user_id = $1 AND source = $2 AND source_id = $3',
      [userId, source, sourceId],
    )
    return rows[0] ?? null
  }

  async insert(doc: {
    userId: string
    source: DocumentSource
    sourceId: string
    title: string
    fileName?: string
    mimeType?: string
    rawPath?: string
    contentHash: string
    folderId?: string
  }): Promise<DocumentRow> {
    const { rows } = await this.db.getPool().query<DocumentRow>(
      `INSERT INTO documents (
        user_id, source, source_id, title, file_name, mime_type,
        raw_path, content_hash, folder_id, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending')
      RETURNING *`,
      [
        doc.userId,
        doc.source,
        doc.sourceId,
        doc.title,
        doc.fileName ?? null,
        doc.mimeType ?? null,
        doc.rawPath ?? null,
        doc.contentHash,
        doc.folderId ?? null,
      ],
    )
    return rows[0]
  }

  async updateParsed(
    id: string,
    data: {
      plainText: string
      contentHash: string
      language?: string
      pageCount?: number
    },
  ): Promise<void> {
    await this.db.getPool().query(
      `UPDATE documents SET
        plain_text = $2,
        content_hash = $3,
        language = $4,
        page_count = $5,
        status = 'parsing',
        updated_at = NOW()
      WHERE id = $1`,
      [
        id,
        data.plainText,
        data.contentHash,
        data.language ?? null,
        data.pageCount ?? null,
      ],
    )
  }

  async updateStatus(
    id: string,
    status: DocumentStatus,
    errorMessage?: string,
  ): Promise<void> {
    await this.db.getPool().query(
      `UPDATE documents SET
        status = $2,
        error_message = $3,
        updated_at = NOW()
      WHERE id = $1`,
      [id, status, errorMessage ?? null],
    )
  }

  async upsertYoudao(doc: {
    userId: string
    sourceId: string
    title: string
    plainText: string
    contentHash: string
    folderId?: string
  }): Promise<{ row: DocumentRow; shouldIngest: boolean }> {
    const existing = await this.findBySource(
      doc.userId,
      'youdao',
      doc.sourceId,
    )

    if (
      existing &&
      existing.content_hash === doc.contentHash &&
      existing.status === 'indexed'
    ) {
      const { rows } = await this.db.getPool().query<DocumentRow>(
        `UPDATE documents SET
          title = $2,
          folder_id = $3,
          synced_at = NOW(),
          updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
        [existing.id, doc.title, doc.folderId ?? null],
      )
      return { row: rows[0], shouldIngest: false }
    }

    if (existing) {
      const { rows } = await this.db.getPool().query<DocumentRow>(
        `UPDATE documents SET
          title = $2,
          plain_text = $3,
          content_hash = $4,
          folder_id = $5,
          status = 'pending',
          error_message = NULL,
          synced_at = NOW(),
          updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
        [
          existing.id,
          doc.title,
          doc.plainText,
          doc.contentHash,
          doc.folderId ?? null,
        ],
      )
      return { row: rows[0], shouldIngest: true }
    }

    const { rows } = await this.db.getPool().query<DocumentRow>(
      `INSERT INTO documents (
        user_id, source, source_id, title, mime_type,
        plain_text, content_hash, folder_id, status, synced_at
      ) VALUES ($1, 'youdao', $2, $3, 'text/plain', $4, $5, $6, 'pending', NOW())
      RETURNING *`,
      [
        doc.userId,
        doc.sourceId,
        doc.title,
        doc.plainText,
        doc.contentHash,
        doc.folderId ?? null,
      ],
    )
    return { row: rows[0], shouldIngest: true }
  }

  async countBySource(
    userId: string,
    source: DocumentSource,
  ): Promise<number> {
    const { rows } = await this.db.getPool().query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM documents
       WHERE user_id = $1 AND source = $2`,
      [userId, source],
    )
    return Number(rows[0]?.count ?? 0)
  }

  async countByStatus(
    userId: string,
    source: DocumentSource,
    status: DocumentStatus,
  ): Promise<number> {
    const { rows } = await this.db.getPool().query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM documents
       WHERE user_id = $1 AND source = $2 AND status = $3`,
      [userId, source, status],
    )
    return Number(rows[0]?.count ?? 0)
  }

  async listByUser(
    userId: string,
    source?: DocumentSource,
  ): Promise<DocumentRow[]> {
    if (source) {
      const { rows } = await this.db.getPool().query<DocumentRow>(
        'SELECT * FROM documents WHERE user_id = $1 AND source = $2 ORDER BY created_at DESC',
        [userId, source],
      )
      return rows
    }
    const { rows } = await this.db.getPool().query<DocumentRow>(
      'SELECT * FROM documents WHERE user_id = $1 ORDER BY created_at DESC',
      [userId],
    )
    return rows
  }
}
