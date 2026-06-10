import { Injectable } from '@nestjs/common'
import { Document } from '@langchain/core/documents'
import { TextLoader } from '@langchain/classic/document_loaders/fs/text'
import type { DocumentParser, FileParseInput, ParseResult } from './types'

@Injectable()
export class MarkdownParser implements DocumentParser {
  readonly name = 'markdown'

  supports(input: FileParseInput): boolean {
    const ext = input.fileName.split('.').pop()?.toLowerCase()
    return (
      ext === 'md' ||
      ext === 'markdown' ||
      input.mimeType === 'text/markdown'
    )
  }

  async parse(input: FileParseInput): Promise<ParseResult> {
    const loader = new TextLoader(input.filePath)
    const docs = await loader.load()
    const plainText = docs.map((d: Document) => d.pageContent).join('\n')

    if (!plainText.trim()) {
      throw new Error('Markdown 文件内容为空')
    }

    return { plainText, isMarkdown: true }
  }
}
