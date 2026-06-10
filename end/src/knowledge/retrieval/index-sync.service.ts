import { Injectable, Logger } from '@nestjs/common'
import { DatabaseService } from '../../database/database.service'
import { ElasticsearchClient } from './clients/elasticsearch.client'
import { Neo4jClient } from './clients/neo4j.client'
import type { ChunkIndexRecord } from './types'

@Injectable()
export class IndexSyncService {
  private readonly logger = new Logger(IndexSyncService.name)

  constructor(
    private readonly db: DatabaseService,
    private readonly es: ElasticsearchClient,
    private readonly neo4j: Neo4jClient,
  ) {}

  async syncDocument(docId: string): Promise<void> {
    if (!this.db.isAvailable()) return

    const records = await this.loadChunks(docId)
    if (!records.length) return

    await Promise.all([
      this.indexElasticsearch(records),
      this.indexNeo4j(records),
    ])

    this.logger.log(`Indexed doc ${docId}: ${records.length} chunks`)
  }

  async reindexUser(userId: string): Promise<{ docs: number; chunks: number }> {
    const { rows } = await this.db.getPool().query<{ id: string }>(
      `SELECT id FROM documents WHERE user_id = $1 AND status = 'indexed'`,
      [userId],
    )

    let chunks = 0
    for (const row of rows) {
      const records = await this.loadChunks(row.id)
      chunks += records.length
      await Promise.all([
        this.indexElasticsearch(records),
        this.indexNeo4j(records),
      ])
    }

    return { docs: rows.length, chunks }
  }

  async removeDocument(docId: string, userId: string): Promise<void> {
    if (this.es.isAvailable()) {
      await this.es.getClient().deleteByQuery({
        index: this.es.indexName,
        query: { bool: { must: [{ term: { doc_id: docId } }] } },
        refresh: true,
      })
    }

    if (this.neo4j.isAvailable()) {
      const session = this.neo4j.getDriver().session()
      try {
        await session.run(
          `
          MATCH (d:Document {id: $docId})-[:HAS_CHUNK]->(c:Chunk)
          DETACH DELETE c
          WITH d
          OPTIONAL MATCH (d)
          DETACH DELETE d
          `,
          { docId },
        )
      } finally {
        await session.close()
      }
    }

    this.logger.log(`Removed indexes for doc ${docId} (user ${userId})`)
  }

  private async loadChunks(docId: string): Promise<ChunkIndexRecord[]> {
    const { rows } = await this.db.getPool().query<{
      chunk_id: string
      doc_id: string
      user_id: string
      title: string
      source: string
      text: string
      heading_path: string[] | null
      chunk_type: string
    }>(
      `SELECT
        c.id AS chunk_id,
        c.doc_id,
        d.user_id,
        d.title,
        d.source,
        c.text,
        c.heading_path,
        c.chunk_type
      FROM document_chunks c
      JOIN documents d ON d.id = c.doc_id
      WHERE c.doc_id = $1 AND c.quality = 'ok'`,
      [docId],
    )

    return rows.map((row) => ({
      chunkId: row.chunk_id,
      docId: row.doc_id,
      userId: row.user_id,
      title: row.title,
      source: row.source,
      text: row.text,
      headingPath: row.heading_path ?? [],
      chunkType: row.chunk_type,
    }))
  }

  private async indexElasticsearch(records: ChunkIndexRecord[]) {
    if (!this.es.isAvailable() || !records.length) return

    const body = records.flatMap((record) => [
      { index: { _index: this.es.indexName, _id: record.chunkId } },
      {
        chunk_id: record.chunkId,
        doc_id: record.docId,
        user_id: record.userId,
        source: record.source,
        title: record.title,
        text: record.text,
        heading_path: record.headingPath,
        chunk_type: record.chunkType,
        indexed_at: new Date().toISOString(),
      },
    ])

    await this.es.getClient().bulk({ refresh: true, operations: body })
  }

  private async indexNeo4j(records: ChunkIndexRecord[]) {
    if (!this.neo4j.isAvailable() || !records.length) return

    const session = this.neo4j.getDriver().session()
    try {
      const doc = records[0]
      await session.run(
        `
        MERGE (d:Document {id: $docId})
        SET d.title = $title, d.userId = $userId, d.source = $source
        `,
        {
          docId: doc.docId,
          title: doc.title,
          userId: doc.userId,
          source: doc.source,
        },
      )

      for (const record of records) {
        await session.run(
          `
          MERGE (c:Chunk {id: $chunkId})
          SET c.docId = $docId,
              c.userId = $userId,
              c.title = $title,
              c.source = $source,
              c.text = $text,
              c.headingPath = $headingPath,
              c.chunkType = $chunkType
          WITH c
          MATCH (d:Document {id: $docId})
          MERGE (d)-[:HAS_CHUNK]->(c)
          `,
          {
            chunkId: record.chunkId,
            docId: record.docId,
            userId: record.userId,
            title: record.title,
            source: record.source,
            text: record.text,
            headingPath: record.headingPath,
            chunkType: record.chunkType,
          },
        )

        const entities = this.extractEntities(record)
        for (const name of entities) {
          await session.run(
            `
            MERGE (e:Entity {name: $name})
            WITH e
            MATCH (c:Chunk {id: $chunkId})
            MERGE (c)-[:MENTIONS]->(e)
            `,
            { name, chunkId: record.chunkId },
          )
        }
      }
    } finally {
      await session.close()
    }
  }

  private extractEntities(record: ChunkIndexRecord): string[] {
    const fromHeadings = record.headingPath.filter((h) => h.length >= 2)
    const fromTitle = record.title.replace(/\.note$/i, '').trim()
    const tokens = record.text.match(/[\u4e00-\u9fff]{2,}|[A-Za-z][A-Za-z0-9_-]{2,}/g) ?? []
    const unique = new Set<string>([...fromHeadings, fromTitle, ...tokens.slice(0, 12)])
    return [...unique].filter(Boolean).slice(0, 20)
  }
}
