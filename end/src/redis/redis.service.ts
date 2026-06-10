import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import Redis from 'ioredis'

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name)
  private readonly client: Redis
  private available = false

  constructor(private readonly config: ConfigService) {
    this.client = new Redis({
      host: this.config.get<string>('REDIS_HOST', 'localhost'),
      port: this.config.get<number>('REDIS_PORT', 6379),
      db: this.config.get<number>('REDIS_DB', 0),
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 3000,
      retryStrategy: () => null,
    })
    this.client.on('error', () => {
      this.available = false
    })
  }

  async onModuleInit() {
    this.available = await this.ping()
    if (this.available) {
      this.logger.log('Redis connected')
    } else {
      this.logger.warn(
        'Redis unavailable — sessions will use in-memory store. Start Redis: docker compose up -d redis',
      )
    }
  }

  async onModuleDestroy() {
    if (this.client.status !== 'end') {
      await this.client.quit()
    }
  }

  isAvailable(): boolean {
    return this.available
  }

  async ping(): Promise<boolean> {
    try {
      if (this.client.status === 'wait') {
        await this.client.connect()
      }
      const result = await this.client.ping()
      this.available = result === 'PONG'
      return this.available
    } catch {
      this.available = false
      return false
    }
  }

  getClient(): Redis {
    return this.client
  }
}
