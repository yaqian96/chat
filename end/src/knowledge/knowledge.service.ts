import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { DatabaseService } from '../database/database.service'
import { RedisService } from '../redis/redis.service'
import { IngestionProcessor } from './ingestion/ingestion.processor'
import { DocumentRepository } from './ingestion/stores/document.repository'
import { IngestJobRepository } from './ingestion/stores/ingest-job.repository'
import { sha256 } from './ingestion/utils/hash'
import { YoudaoMcpClient } from './youdao-mcp.client'
import type {
  YoudaoConfigPublic,
  YoudaoNotesConfig,
  YoudaoSyncMeta,
  YoudaoSyncResult,
} from './types'

@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name)
  private readonly youdaoClient = new YoudaoMcpClient()
  private readonly memoryConfig = new Map<string, YoudaoNotesConfig>()
  private readonly memoryMeta = new Map<string, YoudaoSyncMeta>()

  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    private readonly db: DatabaseService,
    private readonly docRepo: DocumentRepository,
    private readonly jobRepo: IngestJobRepository,
    private readonly ingestProcessor: IngestionProcessor,
  ) {}

  private defaultUserId(userId?: string): string {
    return userId ?? this.config.get<string>('MEM0_USER_ID') ?? 'demo_user_001'
  }

  private configKey(userId: string): string {
    return `knowledge:youdao:config:${userId}`
  }

  private metaKey(userId: string): string {
    return `knowledge:youdao:meta:${userId}`
  }

  private legacyNotesKey(userId: string): string {
    return `knowledge:youdao:notes:${userId}`
  }

  async getYoudaoConfig(userId?: string): Promise<YoudaoConfigPublic> {
    const uid = this.defaultUserId(userId)
    const stored = await this.loadConfig(uid)
    if (!stored) {
      return {
        apiKeyConfigured: false,
        apiKeyMasked: '',
        folderId: '',
        syncEnabled: true,
        syncIntervalMinutes: 60,
      }
    }

    return this.toPublicConfig(stored)
  }

  async saveYoudaoConfig(
    dto: Partial<YoudaoNotesConfig> & { apiKey?: string },
    userId?: string,
  ): Promise<YoudaoConfigPublic> {
    const uid = this.defaultUserId(userId)
    const current = (await this.loadConfig(uid)) ?? {
      apiKey: '',
      folderId: '',
      syncEnabled: true,
      syncIntervalMinutes: 60,
    }

    const next: YoudaoNotesConfig = {
      apiKey: dto.apiKey?.trim() || current.apiKey,
      folderId: dto.folderId?.trim() ?? current.folderId,
      syncEnabled: dto.syncEnabled ?? current.syncEnabled,
      syncIntervalMinutes:
        dto.syncIntervalMinutes ?? current.syncIntervalMinutes,
    }

    if (!next.apiKey) {
      throw new BadRequestException('API Key 不能为空')
    }

    await this.persistConfig(uid, next)
    return this.toPublicConfig(next)
  }

  async testYoudaoConnection(userId?: string): Promise<{
    ok: boolean
    tools: string[]
    message: string
  }> {
    const uid = this.defaultUserId(userId)
    const stored = await this.loadConfig(uid)
    if (!stored?.apiKey) {
      throw new BadRequestException('请先保存 API Key')
    }

    const result = await this.youdaoClient.testConnection(stored.apiKey)
    const toolHint =
      result.listTool && result.readTool
        ? `（笔记工具: ${result.listTool} / ${result.readTool}）`
        : ''
    return {
      ok: result.ok,
      tools: result.tools,
      message: result.ok
        ? `连接成功，可用工具 ${result.tools.length} 个${toolHint}`
        : '连接失败：未找到笔记 list/read 工具，请确认 API Key 权限',
    }
  }

  async syncYoudaoNotes(userId?: string): Promise<YoudaoSyncResult> {
    if (!this.db.isAvailable()) {
      throw new BadRequestException('PostgreSQL 不可用，无法同步有道笔记')
    }

    const uid = this.defaultUserId(userId)
    const stored = await this.loadConfig(uid)
    if (!stored?.apiKey) {
      throw new BadRequestException('请先配置并保存 API Key')
    }

    await this.persistMeta(uid, {
      ...(await this.loadMeta(uid)),
      status: 'syncing',
      lastError: undefined,
    })

    try {
      await this.clearLegacyNotesCache(uid)

      const fetched = await this.youdaoClient.fetchNotes(
        stored.apiKey,
        stored.folderId || undefined,
      )

      const now = new Date().toISOString()
      let synced = 0
      let skipped = 0
      let ingested = 0

      for (const note of fetched) {
        const contentHash = sha256(note.content)
        const prev = await this.docRepo.findBySource(uid, 'youdao', note.id)

        if (prev && prev.content_hash === contentHash) {
          skipped++
        } else {
          synced++
        }

        const { row, shouldIngest } = await this.docRepo.upsertYoudao({
          userId: uid,
          sourceId: note.id,
          title: note.title,
          plainText: note.content,
          contentHash,
          folderId: note.folderId,
        })

        if (shouldIngest) {
          const job = await this.jobRepo.create(row.id, uid)
          await this.ingestProcessor.enqueue({
            docId: row.id,
            userId: uid,
            jobId: job.id,
          })
          ingested++
        }
      }

      const ingestStats = await this.getYoudaoIngestStats(uid)
      const noteCount = await this.docRepo.countBySource(uid, 'youdao')

      await this.persistMeta(uid, {
        lastSyncedAt: now,
        noteCount,
        status: 'success',
        ...ingestStats,
      })

      this.logger.log(
        `Youdao sync done: fetched=${fetched.length}, synced=${synced}, skipped=${skipped}, ingested=${ingested}`,
      )

      return {
        synced,
        skipped,
        ingested,
        lastSyncedAt: now,
        notes: await this.listYoudaoNoteSummaries(uid),
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '同步失败'
      this.logger.error(`Youdao sync failed: ${message}`)
      await this.persistMeta(uid, {
        ...(await this.loadMeta(uid)),
        status: 'error',
        lastError: message,
      })
      throw new BadRequestException(message)
    }
  }

  async getYoudaoStatus(userId?: string): Promise<YoudaoSyncMeta> {
    const uid = this.defaultUserId(userId)
    const meta = await this.loadMeta(uid)
    const ingestStats = await this.getYoudaoIngestStats(uid)
    const noteCount = this.db.isAvailable()
      ? await this.docRepo.countBySource(uid, 'youdao')
      : meta.noteCount

    return { ...meta, noteCount, ...ingestStats }
  }

  private async listYoudaoNoteSummaries(userId: string) {
    const docs = await this.docRepo.listByUser(userId, 'youdao')
    return docs.map((doc) => ({
      id: doc.source_id,
      title: doc.title,
      syncedAt: doc.synced_at ?? doc.updated_at,
    }))
  }

  private async getYoudaoIngestStats(userId: string): Promise<{
    indexedCount: number
    pendingIngest: number
  }> {
    if (!this.db.isAvailable()) {
      return { indexedCount: 0, pendingIngest: 0 }
    }

    const [indexedCount, pendingCount, parsingCount, chunkedCount] =
      await Promise.all([
        this.docRepo.countByStatus(userId, 'youdao', 'indexed'),
        this.docRepo.countByStatus(userId, 'youdao', 'pending'),
        this.docRepo.countByStatus(userId, 'youdao', 'parsing'),
        this.docRepo.countByStatus(userId, 'youdao', 'chunked'),
      ])

    return {
      indexedCount,
      pendingIngest: pendingCount + parsingCount + chunkedCount,
    }
  }

  private toPublicConfig(config: YoudaoNotesConfig): YoudaoConfigPublic {
    return {
      apiKeyConfigured: !!config.apiKey,
      apiKeyMasked: this.maskKey(config.apiKey),
      folderId: config.folderId,
      syncEnabled: config.syncEnabled,
      syncIntervalMinutes: config.syncIntervalMinutes,
    }
  }

  private maskKey(key: string): string {
    if (!key) return ''
    if (key.length <= 8) return '****'
    return `${key.slice(0, 4)}****${key.slice(-4)}`
  }

  private async loadConfig(userId: string): Promise<YoudaoNotesConfig | null> {
    if (!this.redis.isAvailable()) {
      return this.memoryConfig.get(userId) ?? null
    }
    const raw = await this.redis.getClient().get(this.configKey(userId))
    return raw ? (JSON.parse(raw) as YoudaoNotesConfig) : null
  }

  private async persistConfig(
    userId: string,
    config: YoudaoNotesConfig,
  ): Promise<void> {
    if (!this.redis.isAvailable()) {
      this.memoryConfig.set(userId, config)
      return
    }
    await this.redis
      .getClient()
      .set(this.configKey(userId), JSON.stringify(config))
  }

  private async loadMeta(userId: string): Promise<YoudaoSyncMeta> {
    if (!this.redis.isAvailable()) {
      return (
        this.memoryMeta.get(userId) ?? {
          lastSyncedAt: null,
          noteCount: 0,
          status: 'idle',
        }
      )
    }
    const raw = await this.redis.getClient().get(this.metaKey(userId))
    return raw
      ? (JSON.parse(raw) as YoudaoSyncMeta)
      : { lastSyncedAt: null, noteCount: 0, status: 'idle' }
  }

  private async persistMeta(
    userId: string,
    meta: YoudaoSyncMeta,
  ): Promise<void> {
    if (!this.redis.isAvailable()) {
      this.memoryMeta.set(userId, meta)
      return
    }
    await this.redis.getClient().set(this.metaKey(userId), JSON.stringify(meta))
  }

  private async clearLegacyNotesCache(userId: string): Promise<void> {
    if (!this.redis.isAvailable()) return
    await this.redis.getClient().del(this.legacyNotesKey(userId))
  }
}
