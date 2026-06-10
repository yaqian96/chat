import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Client } from '@elastic/elasticsearch'

@Injectable()
export class ElasticsearchClient implements OnModuleInit {
  private readonly logger = new Logger(ElasticsearchClient.name)
  private client: Client | null = null
  private available = false
  readonly indexName: string

  constructor(private readonly config: ConfigService) {
    this.indexName = this.config.get<string>(
      'ELASTICSEARCH_INDEX',
      'knowledge_chunks',
    )
  }

  async onModuleInit() {
    const url = this.config.get<string>('ELASTICSEARCH_URL')
    if (!url) {
      this.logger.warn('ELASTICSEARCH_URL not set — BM25 search disabled')
      return
    }

    this.client = new Client({ node: url })
    try {
      await this.client.ping()
      await this.ensureIndex()
      this.available = true
      this.logger.log(`Elasticsearch connected: ${url}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.logger.warn(`Elasticsearch unavailable: ${message}`)
      this.client = null
    }
  }

  isAvailable(): boolean {
    return this.available && this.client !== null
  }

  getClient(): Client {
    if (!this.client) throw new Error('Elasticsearch is not available')
    return this.client
  }

  private async ensureIndex() {
    const exists = await this.client!.indices.exists({ index: this.indexName })
    if (exists) return

    await this.client!.indices.create({
      index: this.indexName,
      settings: {
        number_of_shards: 1,
        number_of_replicas: 0,
        analysis: {
          analyzer: {
            cjk: {
              type: 'custom',
              tokenizer: 'standard',
              filter: ['lowercase', 'cjk_width'],
            },
          },
        },
      },
      mappings: {
        properties: {
          chunk_id: { type: 'keyword' },
          doc_id: { type: 'keyword' },
          user_id: { type: 'keyword' },
          source: { type: 'keyword' },
          title: { type: 'text', analyzer: 'cjk' },
          text: { type: 'text', analyzer: 'cjk' },
          heading_path: { type: 'keyword' },
          chunk_type: { type: 'keyword' },
          indexed_at: { type: 'date' },
        },
      },
    })
  }
}
