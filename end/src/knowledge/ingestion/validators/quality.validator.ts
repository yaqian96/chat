import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Document } from '@langchain/core/documents'

@Injectable()
export class QualityValidator {
  private readonly minChars: number

  constructor(private readonly config: ConfigService) {
    this.minChars = Number(this.config.get('INGEST_MIN_CHUNK_CHARS') ?? 20) || 20
  }

  validate(chunks: Document[]): Document[] {
    return chunks
      .map((chunk) => this.applyRules(chunk))
      .filter((chunk) => chunk.metadata.quality !== 'dropped')
  }

  private applyRules(chunk: Document): Document {
    const text = chunk.pageContent.trim()

    if (!text) {
      return this.markDropped(chunk, 'empty')
    }

    if (text.length < this.minChars) {
      return this.markDropped(chunk, 'too_short')
    }

    const uniqueChars = new Set(text).size
    if (uniqueChars === 1 && text.length > 10) {
      return this.markDropped(chunk, 'repeated_char')
    }

    const readable = (text.match(/[\u4e00-\u9fff\w\s.,;:!?'"()[\]{}\-]/g) ?? []).length
    if (text.length > 0 && readable / text.length < 0.7) {
      return this.markDropped(chunk, 'garbled')
    }

    return new Document({
      pageContent: chunk.pageContent,
      metadata: { ...chunk.metadata, quality: 'ok' },
    })
  }

  private markDropped(chunk: Document, reason: string): Document {
    return new Document({
      pageContent: chunk.pageContent,
      metadata: { ...chunk.metadata, quality: 'dropped', dropReason: reason },
    })
  }
}
