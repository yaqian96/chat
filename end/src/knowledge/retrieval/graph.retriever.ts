import { Injectable } from '@nestjs/common'
import neo4j from 'neo4j-driver'
import { Neo4jClient } from './clients/neo4j.client'
import type { ChunkSearchHit } from './types'

@Injectable()
export class GraphRetriever {
  constructor(private readonly neo4j: Neo4jClient) {}

  async search(
    query: string,
    userId: string,
    topK: number,
  ): Promise<ChunkSearchHit[]> {
    if (!this.neo4j.isAvailable()) return []

    const limit = neo4j.int(Math.max(1, Math.floor(topK)))
    const driver = this.neo4j.getDriver()
    const chunkSession = driver.session()
    const entitySession = driver.session()
    try {
      const [chunkRes, entityRes] = await Promise.all([
        chunkSession.run(
          `
          CALL db.index.fulltext.queryNodes('chunk_text', $query)
          YIELD node AS c, score
          WHERE c.userId = $userId
          RETURN c, score
          ORDER BY score DESC
          LIMIT $topK
          `,
          { query, userId, topK: limit },
        ),
        entitySession.run(
          `
          CALL db.index.fulltext.queryNodes('entity_name_ft', $query)
          YIELD node AS e, score
          MATCH (c:Chunk)-[:MENTIONS]->(e)
          WHERE c.userId = $userId
          RETURN c, score * 0.9 AS score
          ORDER BY score DESC
          LIMIT $topK
          `,
          { query, userId, topK: limit },
        ),
      ])

      const merged = new Map<string, ChunkSearchHit>()
      for (const record of [...chunkRes.records, ...entityRes.records]) {
        const c = record.get('c').properties as Record<string, unknown>
        const chunkId = String(c.id)
        const score = Number(record.get('score'))
        const existing = merged.get(chunkId)
        if (!existing || score > existing.score) {
          merged.set(chunkId, {
            chunkId,
            docId: String(c.docId),
            text: String(c.text ?? ''),
            title: String(c.title ?? ''),
            source: String(c.source ?? ''),
            headingPath: Array.isArray(c.headingPath)
              ? (c.headingPath as string[])
              : undefined,
            score,
            channel: 'graph',
          })
        }
      }

      return [...merged.values()]
        .sort((a, b) => b.score - a.score)
        .slice(0, topK)
    } finally {
      await Promise.all([chunkSession.close(), entitySession.close()])
    }
  }
}
