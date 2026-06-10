import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { Pool } from 'pg'

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name)
  private pool: Pool | null = null
  private available = false

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    const url = this.config.get<string>('DATABASE_URL')
    if (!url) {
      this.logger.warn('DATABASE_URL not set — knowledge ingestion disabled')
      return
    }

    this.pool = new Pool({ connectionString: url })
    try {
      await this.pool.query('SELECT 1')
      await this.runMigrations()
      this.available = true
      this.logger.log('PostgreSQL connected')
    } catch (err) {
      this.available = false
      const message = err instanceof Error ? err.message : String(err)
      this.logger.warn(
        `PostgreSQL unavailable — knowledge ingestion disabled: ${message}`,
      )
      await this.pool.end()
      this.pool = null
    }
  }

  async onModuleDestroy() {
    if (this.pool) {
      await this.pool.end()
      this.pool = null
    }
  }

  isAvailable(): boolean {
    return this.available && this.pool !== null
  }

  getPool(): Pool {
    if (!this.pool) {
      throw new Error('Database is not available')
    }
    return this.pool
  }

  private async runMigrations() {
    const dir = join(__dirname, 'migrations')
    const files = readdirSync(dir)
      .filter((file) => file.endsWith('.sql'))
      .sort()

    for (const file of files) {
      const sql = readFileSync(join(dir, file), 'utf-8')
      await this.pool!.query(sql)
      this.logger.log(`Migration applied: ${file}`)
    }
  }
}
