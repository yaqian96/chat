import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Worker, Queue } from 'bullmq'
import { DatabaseService } from '../../database/database.service'
import { RedisService } from '../../redis/redis.service'
import { IngestionService } from './ingestion.service'

export interface IngestJobData {
  docId: string
  userId: string
  jobId: string
  force?: boolean
}

@Injectable()
export class IngestionProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IngestionProcessor.name)
  private queue: Queue<IngestJobData> | null = null
  private worker: Worker<IngestJobData> | null = null

  constructor(
    private readonly config: ConfigService,
    private readonly redis: RedisService,
    private readonly db: DatabaseService,
    private readonly ingestion: IngestionService,
  ) {}

  async onModuleInit() {
    if (!this.db.isAvailable() || !this.redis.isAvailable()) {
      this.logger.warn('Ingestion queue disabled (DB or Redis unavailable)')
      return
    }

    const connection = {
      host: this.config.get<string>('REDIS_HOST', 'localhost'),
      port: this.config.get<number>('REDIS_PORT', 6379),
      db: this.config.get<number>('REDIS_DB', 0),
    }

    this.queue = new Queue<IngestJobData>('knowledge-ingest', { connection })

    const concurrency = Number(this.config.get('INGEST_CONCURRENCY') ?? 2) || 2
    this.worker = new Worker<IngestJobData>(
      'knowledge-ingest',
      async (job) => {
        await this.ingestion.ingestDocument(job.data.docId, {
          force: job.data.force,
          jobId: job.data.jobId,
        })
      },
      { connection, concurrency },
    )

    this.worker.on('failed', (job, err) => {
      this.logger.error(
        `Ingest job failed: ${job?.data.docId} — ${err.message}`,
      )
    })

    this.logger.log('Ingestion queue worker started')
  }

  async onModuleDestroy() {
    await this.worker?.close()
    await this.queue?.close()
  }

  async enqueue(data: IngestJobData): Promise<void> {
    if (this.queue) {
      await this.queue.add('ingest', data, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 100,
        removeOnFail: 50,
      })
      return
    }

    setImmediate(() => {
      this.ingestion
        .ingestDocument(data.docId, { force: data.force, jobId: data.jobId })
        .catch((err) => {
          this.logger.error(
            `Inline ingest failed: ${data.docId} — ${err instanceof Error ? err.message : err}`,
          )
        })
    })
  }
}
