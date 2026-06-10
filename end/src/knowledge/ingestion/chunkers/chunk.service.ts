import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Document } from '@langchain/core/documents'
import {
  MarkdownTextSplitter,
  RecursiveCharacterTextSplitter,
} from '@langchain/textsplitters'
import type { DocumentRow } from '../types'

@Injectable()
export class ChunkService {
  private readonly chunkSize: number
  private readonly chunkOverlap: number

  constructor(private readonly config: ConfigService) {
    this.chunkSize = Number(this.config.get('INGEST_CHUNK_SIZE') ?? 512) || 512
    this.chunkOverlap = Number(this.config.get('INGEST_CHUNK_OVERLAP') ?? 64) || 64
  }

  async chunk(
    plainText: string,
    doc: DocumentRow,
    options?: { isMarkdown?: boolean },
  ): Promise<Document[]> {
    const baseDoc = new Document({
      pageContent: plainText,
      metadata: {
        docId: doc.id,
        userId: doc.user_id,
        source: doc.source,
        title: doc.title,
      },
    })

    if (plainText.length < this.chunkSize * 1.5) {
      return [baseDoc]
    }

    if (options?.isMarkdown) {
      return this.chunkMarkdown(plainText, baseDoc.metadata)
    }

    return this.chunkParagraph(plainText, baseDoc.metadata)
  }

  private async chunkParagraph(
    text: string,
    baseMetadata: Record<string, unknown>,
  ): Promise<Document[]> {
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: this.chunkSize,
      chunkOverlap: this.chunkOverlap,
      separators: ['\n\n', '\n', '。', '！', '？', '. ', ' ', ''],
    })

    const docs = await splitter.createDocuments([text], [baseMetadata])
    return docs.map((doc, i) => {
      const pageMatch = doc.pageContent.match(/^--- page (\d+) ---/)
      const pageNumber = pageMatch ? parseInt(pageMatch[1], 10) : undefined
      return new Document({
        pageContent: doc.pageContent,
        metadata: {
          ...doc.metadata,
          chunkIndex: i,
          chunkType: pageNumber ? 'page' : 'paragraph',
          pageNumber,
          headingPath: [baseMetadata.title as string],
        },
      })
    })
  }

  private async chunkMarkdown(
    text: string,
    baseMetadata: Record<string, unknown>,
  ): Promise<Document[]> {
    const mdSplitter = new MarkdownTextSplitter({
      chunkSize: this.chunkSize,
      chunkOverlap: this.chunkOverlap,
    })

    const docs = await mdSplitter.createDocuments([text], [baseMetadata])
    return docs.map((doc, i) =>
      new Document({
        pageContent: doc.pageContent,
        metadata: {
          ...doc.metadata,
          chunkIndex: i,
          chunkType: 'section',
          headingPath: this.extractMarkdownHeadings(
            doc.pageContent,
            baseMetadata.title as string,
          ),
        },
      }),
    )
  }

  private extractMarkdownHeadings(text: string, fallbackTitle: string): string[] {
    const headings = text
      .split('\n')
      .map((line) => line.match(/^(#{1,3})\s+(.+)/))
      .filter((match): match is RegExpMatchArray => !!match)
      .map((match) => match[2].trim())

    return headings.length ? headings : [fallbackTitle]
  }
}
