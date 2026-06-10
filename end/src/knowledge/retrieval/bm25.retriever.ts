import { Injectable } from '@nestjs/common'
import type { estypes } from '@elastic/elasticsearch'
import { ElasticsearchClient } from './clients/elasticsearch.client'
import type { ChunkSearchHit } from './types'

@Injectable()
export class Bm25Retriever {
  constructor(private readonly es: ElasticsearchClient) {}

  async search(
    query: string,
    userId: string,
    topK: number,
  ): Promise<ChunkSearchHit[]> {
    if (!this.es.isAvailable()) return []

    const res = await this.es.getClient().search({
      index: this.es.indexName,
      size: topK,
      query: {
        bool: {
          must: [
            {
              multi_match: {
                query,
                fields: ['text^2', 'title^3', 'heading_path'],
                type: 'best_fields',
              },
            },
          ],
          filter: [{ term: { user_id: userId } }],
        },
      },
    })

    return res.hits.hits.map((hit: estypes.SearchHit) => {
      const src = (hit._source ?? {}) as Record<string, unknown>
      return {
        chunkId: String(src.chunk_id),
        docId: String(src.doc_id),
        text: String(src.text ?? ''),
        title: String(src.title ?? ''),
        source: String(src.source ?? ''),
        headingPath: Array.isArray(src.heading_path)
          ? (src.heading_path as string[])
          : undefined,
        score: Number(hit._score ?? 0),
        channel: 'bm25' as const,
      }
    })
  }
}
