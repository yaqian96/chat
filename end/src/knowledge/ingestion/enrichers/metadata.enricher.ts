import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Document } from '@langchain/core/documents'
import type { DocumentRow } from '../types'
import { estimateTokenCount, sha256 } from '../utils/hash'

@Injectable()
export class MetadataEnricher {
  private readonly pipelineVersion: string

  constructor(private readonly config: ConfigService) {
    this.pipelineVersion = this.config.get<string>(
      'INGEST_PIPELINE_VERSION',
      '1.0.0',
    )
  }

  enrich(chunks: Document[], doc: DocumentRow): Document[] {
    const contentHash = doc.content_hash
    const now = new Date().toISOString()

    return chunks.map((chunk, i) => {
      const chunkHash = sha256(chunk.pageContent)
      const headingPath = (chunk.metadata.headingPath as string[]) ?? [doc.title]

      return new Document({
        pageContent: chunk.pageContent,
        metadata: {
          ...chunk.metadata,
          docId: doc.id,
          userId: doc.user_id,
          source: doc.source,
          sourceId: doc.source_id,
          title: doc.title,
          fileName: doc.file_name,
          mimeType: doc.mime_type,
          contentHash,
          chunkHash,
          chunkIndex: i,
          charCount: chunk.pageContent.length,
          tokenCount: estimateTokenCount(chunk.pageContent),
          headingPath,
          folderId: doc.folder_id,
          ingestVersion: this.pipelineVersion,
          createdAt: now,
          updatedAt: now,
        },
      })
    })
  }
}
