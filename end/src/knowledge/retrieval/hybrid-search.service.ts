import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Bm25Retriever } from './bm25.retriever'
import { GraphRetriever } from './graph.retriever'
import { VectorRetriever } from './vector.retriever'
import type { ChunkSearchHit, HybridSearchOptions, HybridSearchResult } from './types'

const CONTEXT_CHUNK_MAX_CHARS = 300

@Injectable()
export class HybridSearchService {
  private readonly logger = new Logger(HybridSearchService.name)
  private readonly defaultTopK: number
  private readonly rrfK: number

  constructor(
    private readonly config: ConfigService,
    private readonly vector: VectorRetriever,
    private readonly bm25: Bm25Retriever,
    private readonly graph: GraphRetriever,
  ) {
    this.defaultTopK = Number(this.config.get('SEARCH_TOP_K') ?? 10) || 10
    this.rrfK = Number(this.config.get('SEARCH_RRF_K') ?? 60) || 60
  }

  async search(
    query: string,
    options: HybridSearchOptions,
  ): Promise<HybridSearchResult> {
    const topK = options.topK ?? this.defaultTopK
    const perChannelK = Math.max(topK * 2, 20)

    const [vectorHits, bm25Hits, graphHits] = await Promise.all([
      this.vector.search(query, options.userId, perChannelK),
      this.bm25.search(query, options.userId, perChannelK),
      this.graph.search(query, options.userId, perChannelK),
    ])

    const fused = this.fuseRrf([vectorHits, bm25Hits, graphHits]).slice(0, topK)

    this.logger.debug(
      `Hybrid search "${query.slice(0, 40)}": vector=${vectorHits.length}, bm25=${bm25Hits.length}, graph=${graphHits.length}, fused=${fused.length}`,
    )

    return {
      query,
      hits: fused,
      channels: {
        vector: vectorHits.length,
        bm25: bm25Hits.length,
        graph: graphHits.length,
      },
    }
  }

  buildContextMessage(hits: ChunkSearchHit[]): string | null {
    if (!hits.length) return null

    const blocks = hits.map((hit, i) => {
      const path = hit.headingPath?.length
        ? ` > ${hit.headingPath.join(' > ')}`
        : ''
      const snippet = truncateText(hit.text, CONTEXT_CHUNK_MAX_CHARS)
      return `[${i + 1}] 《${hit.title}》${path}\n${snippet}`
    })

    return `【知识库检索结果】\n${blocks.join('\n\n')}\n\n请优先依据以上内容回答，不足处再说明。`
  }

  private fuseRrf(lists: ChunkSearchHit[][]): ChunkSearchHit[] {
    const weights = {
      vector: Number(this.config.get('SEARCH_VECTOR_WEIGHT') ?? 1) || 1,
      bm25: Number(this.config.get('SEARCH_BM25_WEIGHT') ?? 1) || 1,
      graph: Number(this.config.get('SEARCH_GRAPH_WEIGHT') ?? 1) || 1,
    }

    const merged = new Map<
      string,
      ChunkSearchHit & { fusedScore: number; channels: string[] }
    >()

    for (const list of lists) {
      list.forEach((hit, rank) => {
        const weight = weights[hit.channel]
        const contribution = weight / (this.rrfK + rank + 1)
        const existing = merged.get(hit.chunkId)
        if (existing) {
          existing.fusedScore += contribution
          existing.channels.push(hit.channel)
          if (hit.score > existing.score) {
            existing.score = hit.score
            existing.text = hit.text
          }
        } else {
          merged.set(hit.chunkId, {
            ...hit,
            fusedScore: contribution,
            channels: [hit.channel],
          })
        }
      })
    }

    return [...merged.values()]
      .sort((a, b) => b.fusedScore - a.fusedScore)
      .map(({ fusedScore, channels, ...hit }) => ({
        ...hit,
        score: fusedScore,
        metadata: { ...hit.metadata, channels },
      }))
  }
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}…`
}
