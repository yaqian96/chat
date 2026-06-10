import { Injectable, Logger } from '@nestjs/common'
import { Document } from '@langchain/core/documents'
import { TextCleaner } from './cleaners/text-cleaner'
import { ChunkService } from './chunkers/chunk.service'
import { EmbeddingService } from './embedders/embedding.service'
import { MetadataEnricher } from './enrichers/metadata.enricher'
import { ParserRegistry } from './parsers/parser.registry'
import { YoudaoTextParser } from './parsers/youdao-text.parser'
import { ChunkRepository } from './stores/chunk.repository'
import { DocumentRepository } from './stores/document.repository'
import { IngestJobRepository } from './stores/ingest-job.repository'
import { PgVectorRepository } from './stores/pgvector.repository'
import type { IngestResult } from './types'
import { sha256 } from './utils/hash'
import { IndexSyncService } from '../retrieval/index-sync.service'
import { QualityValidator } from './validators/quality.validator'

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name)

  constructor(
    private readonly docRepo: DocumentRepository,
    private readonly chunkRepo: ChunkRepository,
    private readonly pgVector: PgVectorRepository,
    private readonly jobRepo: IngestJobRepository,
    private readonly parser: ParserRegistry,
    private readonly youdaoParser: YoudaoTextParser,
    private readonly cleaner: TextCleaner,
    private readonly chunkService: ChunkService,
    private readonly enricher: MetadataEnricher,
    private readonly validator: QualityValidator,
    private readonly embedding: EmbeddingService,
    private readonly indexSync: IndexSyncService,
  ) {}

  async ingestDocument(
    docId: string,
    options?: { force?: boolean; jobId?: string },
  ): Promise<IngestResult> {
    const doc = await this.docRepo.findById(docId)
    if (!doc) {
      throw new Error(`Document not found: ${docId}`)
    }

    if (options?.jobId) {
      await this.jobRepo.markRunning(options.jobId)
    }

    try {
      await this.docRepo.updateStatus(docId, 'parsing')

      const parsed =
        doc.source === 'youdao'
          ? this.parseYoudaoDocument(doc)
          : await this.parser.parse({
              filePath: doc.raw_path!,
              fileName: doc.file_name ?? doc.title,
              mimeType: doc.mime_type ?? 'application/octet-stream',
            })

      const cleaned = this.cleaner.clean(parsed.plainText)
      if (!cleaned.plainText.trim()) {
        throw new Error('文档解析后内容为空')
      }

      const contentHash = sha256(cleaned.plainText)
      if (!options?.force && doc.content_hash === contentHash && doc.status === 'indexed') {
        if (options?.jobId) await this.jobRepo.markSuccess(options.jobId)
        return { docId, chunkCount: 0, skipped: true }
      }

      await this.docRepo.updateParsed(docId, {
        plainText: cleaned.plainText,
        contentHash,
        pageCount: parsed.pageCount,
      })

      const updatedDoc = (await this.docRepo.findById(docId))!

      const rawChunks = await this.chunkService.chunk(
        cleaned.plainText,
        updatedDoc,
        { isMarkdown: parsed.isMarkdown },
      )

      const enriched = this.enricher.enrich(rawChunks, {
        ...updatedDoc,
        content_hash: contentHash,
      })

      const validated = this.validator.validate(enriched)

      await this.chunkRepo.deleteByDocId(docId)
      const savedChunks = await this.chunkRepo.saveBatch(docId, validated)

      if (!savedChunks.length) {
        throw new Error('没有有效的文本分块')
      }

      await this.docRepo.updateStatus(docId, 'chunked')

      const docMap = new Map(
        validated.map((d) => [d.metadata.chunkIndex as number, d]),
      )

      const toEmbed = savedChunks.map((saved) => ({
        chunkId: saved.id,
        doc: docMap.get(saved.chunkIndex)!,
      }))

      const vectors = await this.embedding.embedDocuments(
        toEmbed.map((item) => item.doc),
      )

      await this.pgVector.upsertEmbeddings(
        vectors.map((item, i) => ({
          chunkId: toEmbed[i].chunkId,
          embedding: item.vector,
        })),
      )

      await this.docRepo.updateStatus(docId, 'indexed')
      await this.indexSync.syncDocument(docId)
      if (options?.jobId) await this.jobRepo.markSuccess(options.jobId)

      this.logger.log(`Ingested doc ${docId}: ${savedChunks.length} chunks`)

      return { docId, chunkCount: savedChunks.length }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'ingest failed'
      this.logger.error(`Ingest failed for ${docId}: ${message}`)
      await this.docRepo.updateStatus(docId, 'failed', message)
      if (options?.jobId) await this.jobRepo.markFailed(options.jobId, message)
      throw err
    }
  }

  private parseYoudaoDocument(doc: {
    plain_text: string | null
    title: string
  }) {
    if (!doc.plain_text?.trim()) {
      throw new Error('有道笔记内容为空')
    }
    return this.youdaoParser.parse(doc.plain_text, doc.title)
  }
}
