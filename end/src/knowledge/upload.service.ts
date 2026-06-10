import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { mkdirSync, writeFileSync } from 'fs'
import { join, extname, basename } from 'path'
import { v4 as uuidv4 } from 'uuid'
import { DatabaseService } from '../database/database.service'
import { IngestionProcessor } from './ingestion/ingestion.processor'
import { IngestJobRepository } from './ingestion/stores/ingest-job.repository'
import { DocumentRepository } from './ingestion/stores/document.repository'
import type { UploadFileResult } from './ingestion/types'
import { sha256 } from './ingestion/utils/hash'

const SUPPORTED_EXTENSIONS = new Set([
  '.pdf',
  '.txt',
  '.md',
  '.markdown',
  '.docx',
  '.xlsx',
  '.xls',
])

@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name)
  private readonly uploadDir: string
  private readonly maxSizeMb: number

  constructor(
    private readonly config: ConfigService,
    private readonly db: DatabaseService,
    private readonly docRepo: DocumentRepository,
    private readonly jobRepo: IngestJobRepository,
    private readonly ingestProcessor: IngestionProcessor,
  ) {
    this.uploadDir = this.config.get<string>('UPLOAD_DIR', './storage/uploads')
    this.maxSizeMb = this.config.get<number>('UPLOAD_MAX_SIZE_MB', 20)
    mkdirSync(this.uploadDir, { recursive: true })
  }

  async uploadFiles(
    files: Express.Multer.File[],
    userId: string,
  ): Promise<{ files: UploadFileResult[] }> {
    if (!this.db.isAvailable()) {
      throw new BadRequestException(
        '数据库未连接，请先启动 PostgreSQL: docker compose up -d postgres',
      )
    }

    if (!files?.length) {
      throw new BadRequestException('请选择至少一个文件')
    }

    const maxBytes = this.maxSizeMb * 1024 * 1024
    const results: UploadFileResult[] = []

    for (const file of files) {
      const ext = extname(file.originalname).toLowerCase()
      if (!SUPPORTED_EXTENSIONS.has(ext)) {
        throw new BadRequestException(
          `不支持的文件格式: ${file.originalname}，当前支持 PDF、TXT、MD、DOCX、XLSX`,
        )
      }

      if (file.size > maxBytes) {
        throw new BadRequestException(
          `文件 ${file.originalname} 超过 ${this.maxSizeMb}MB 限制`,
        )
      }

      const fileId = uuidv4()
      const title = basename(file.originalname, ext)
      const contentHash = sha256(file.buffer.toString('binary'))

      const existing = await this.docRepo.findBySource(userId, 'upload', fileId)
      if (existing) {
        results.push({
          fileId,
          docId: existing.id,
          title: existing.title,
          status: 'processing',
        })
        continue
      }

      const storedName = `${fileId}${ext}`
      const rawPath = join(this.uploadDir, storedName)
      writeFileSync(rawPath, file.buffer)

      const doc = await this.docRepo.insert({
        userId,
        source: 'upload',
        sourceId: fileId,
        title,
        fileName: file.originalname,
        mimeType: file.mimetype || this.mimeFromExt(ext),
        rawPath,
        contentHash,
      })

      const job = await this.jobRepo.create(doc.id, userId)
      await this.ingestProcessor.enqueue({
        docId: doc.id,
        userId,
        jobId: job.id,
      })

      this.logger.log(`Uploaded ${file.originalname} → doc ${doc.id}`)

      results.push({
        fileId,
        docId: doc.id,
        title,
        status: 'processing',
      })
    }

    return { files: results }
  }

  async retryFailed(userId: string) {
    if (!this.db.isAvailable()) {
      throw new BadRequestException('数据库未连接')
    }

    const docs = await this.docRepo.listByUser(userId)
    const toRetry = docs.filter((d) =>
      ['failed', 'chunked'].includes(d.status),
    )

    for (const doc of toRetry) {
      await this.docRepo.updateStatus(doc.id, 'pending')
      const job = await this.jobRepo.create(doc.id, userId)
      await this.ingestProcessor.enqueue({
        docId: doc.id,
        userId,
        jobId: job.id,
        force: true,
      })
    }

    return { retried: toRetry.length }
  }

  async getIngestStatus(userId: string) {
    const docs = await this.docRepo.listByUser(userId, 'upload')
    const jobs = await this.jobRepo.listByUser(userId)

    const indexed = docs.filter((d) => d.status === 'indexed').length
    const pending = docs.filter(
      (d) => !['indexed', 'failed'].includes(d.status),
    ).length
    const failed = docs.filter((d) => d.status === 'failed').length

    return {
      total: docs.length,
      indexed,
      pending,
      failed,
      jobs: jobs.map((j) => ({
        docId: j.doc_id,
        title: j.title,
        status: j.status,
        docStatus: j.doc_status,
        error: j.error_message,
      })),
    }
  }

  private mimeFromExt(ext: string): string {
    switch (ext) {
      case '.pdf':
        return 'application/pdf'
      case '.md':
      case '.markdown':
        return 'text/markdown'
      case '.docx':
        return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      case '.xlsx':
        return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      case '.xls':
        return 'application/vnd.ms-excel'
      default:
        return 'text/plain'
    }
  }
}
