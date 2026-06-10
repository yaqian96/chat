import { Injectable } from '@nestjs/common'
import { Document } from '@langchain/core/documents'
import { TextLoader } from '@langchain/classic/document_loaders/fs/text'
import type { DocumentParser, FileParseInput, ParseResult } from './types'

@Injectable()
export class PlainTextParser implements DocumentParser {
  readonly name = 'plain-text'

  supports(input: FileParseInput): boolean {
    const ext = input.fileName.split('.').pop()?.toLowerCase()
    return ext === 'txt' || input.mimeType === 'text/plain'
  }

  async parse(input: FileParseInput): Promise<ParseResult> {
    const loader = new TextLoader(input.filePath)
    const docs = await loader.load()
    const plainText = docs.map((d: Document) => d.pageContent).join('\n')

    if (!plainText.trim()) {
      throw new Error('文本文件内容为空')
    }

    return { plainText }
  }
}
