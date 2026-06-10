import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Document } from '@langchain/core/documents'
import { RedisService } from '../../../redis/redis.service'

function buildEmbedInput(doc: Document): string {
  const { title, headingPath } = doc.metadata as {
    title?: string
    headingPath?: string[]
  }
  const path = Array.isArray(headingPath) ? headingPath.join(' > ') : ''
  return path
    ? `${title} > ${path}\n${doc.pageContent}`
    : `${title}\n${doc.pageContent}`
}

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name)
  private readonly apiKey: string | null
  private readonly baseUrl: string
  private readonly model: string
  private readonly batchSize: number
  private readonly dimensions: number
  private readonly useDimensions: boolean
  private readonly cacheTtl = 7 * 24 * 60 * 60

  constructor(
    private readonly config: ConfigService,
    private readonly redis: RedisService,
  ) {
    this.apiKey =
      this.config.get<string>('EMBEDDING_API_KEY') ||
      this.config.get<string>('OPENROUTER_API_KEY') ||
      null

    this.baseUrl = this.config.get<string>(
      'EMBEDDING_BASE_URL',
      'https://openrouter.ai/api/v1',
    )
    this.model = this.config.get<string>(
      'EMBEDDING_MODEL',
      'nvidia/llama-nemotron-embed-vl-1b-v2:free',
    )
    this.batchSize = Number(this.config.get('EMBEDDING_BATCH_SIZE') ?? 32) || 32
    this.dimensions = Number(this.config.get('EMBEDDING_DIMENSIONS') ?? 1536) || 1536
    this.useDimensions =
      this.config.get<string>('EMBEDDING_USE_DIMENSIONS', 'true') === 'true'

    if (this.apiKey) {
      this.logger.log(`Embedding model: ${this.model} (dims=${this.dimensions})`)
    } else {
      this.logger.warn('EMBEDDING_API_KEY / OPENROUTER_API_KEY not set')
    }
  }

  isConfigured(): boolean {
    return !!this.apiKey
  }

  async embedDocuments(
    docs: Document[],
  ): Promise<Array<{ doc: Document; vector: number[] }>> {
    if (!this.apiKey) {
      throw new Error('Embedding API 未配置')
    }

    const results: Array<{ doc: Document; vector: number[] }> = []
    const uncached: Document[] = []

    for (const doc of docs) {
      const chunkHash = doc.metadata.chunkHash as string
      const cached = await this.getCached(chunkHash)
      if (cached) {
        results.push({ doc, vector: cached })
      } else {
        uncached.push(doc)
      }
    }

    for (let i = 0; i < uncached.length; i += this.batchSize) {
      const batch = uncached.slice(i, i + this.batchSize)
      const inputs = batch.map(buildEmbedInput)
      const vectors = await this.embedWithRetry(inputs)

      if (vectors.length !== batch.length) {
        throw new Error(
          `Embedding 返回数量不匹配: expected ${batch.length}, got ${vectors.length}`,
        )
      }

      for (let j = 0; j < batch.length; j++) {
        const vector = vectors[j]
        if (!vector?.length) {
          throw new Error(`Embedding 第 ${j} 条结果为空`)
        }
        if (vector.length !== this.dimensions) {
          throw new Error(
            `Embedding 维度不匹配: expected ${this.dimensions}, got ${vector.length}`,
          )
        }
        const chunkHash = batch[j].metadata.chunkHash as string
        await this.setCached(chunkHash, vector)
        results.push({ doc: batch[j], vector })
      }
    }

    return results
  }

  private async embedWithRetry(
    inputs: string[],
    attempt = 0,
  ): Promise<number[][]> {
    try {
      return await this.callEmbeddingApi(inputs)
    } catch (err) {
      if (attempt >= 2) throw err
      const delay = Math.pow(2, attempt) * 1000
      const message = err instanceof Error ? err.message : String(err)
      this.logger.warn(`Embedding retry in ${delay}ms (attempt ${attempt + 1}): ${message}`)
      await new Promise((r) => setTimeout(r, delay))
      return this.embedWithRetry(inputs, attempt + 1)
    }
  }

  private async callEmbeddingApi(inputs: string[]): Promise<number[][]> {
    const body: Record<string, unknown> = {
      model: this.model,
      input: inputs.length === 1 ? inputs[0] : inputs,
    }
    if (this.useDimensions) {
      body.dimensions = this.dimensions
    }

    const res = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Embedding API ${res.status}: ${text}`)
    }

    const json = (await res.json()) as {
      data?: Array<{ embedding: number[]; index?: number }>
    }

    const data = json.data ?? []
    if (!data.length) {
      throw new Error('Embedding API 返回空数据')
    }

    const hasIndex = data.every((item) => typeof item.index === 'number')
    const ordered = hasIndex
      ? [...data].sort((a, b) => a.index! - b.index!)
      : data

    return ordered.map((item) => item.embedding)
  }

  private cacheKey(chunkHash: string): string {
    return `embed:cache:${chunkHash}`
  }

  private async getCached(chunkHash: string): Promise<number[] | null> {
    if (!this.redis.isAvailable()) return null
    const raw = await this.redis.getClient().get(this.cacheKey(chunkHash))
    return raw ? (JSON.parse(raw) as number[]) : null
  }

  private async setCached(chunkHash: string, vector: number[]): Promise<void> {
    if (!this.redis.isAvailable()) return
    await this.redis
      .getClient()
      .set(this.cacheKey(chunkHash), JSON.stringify(vector), 'EX', this.cacheTtl)
  }
}
