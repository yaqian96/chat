import { Injectable } from '@nestjs/common'
import { DocxLoader } from '@langchain/community/document_loaders/fs/docx'
import type { DocumentParser, FileParseInput, ParseResult } from './types'

@Injectable()
export class DocxParser implements DocumentParser {
  readonly name = 'docx'

  supports(input: FileParseInput): boolean {
    const ext = input.fileName.split('.').pop()?.toLowerCase()
    return (
      ext === 'docx' ||
      input.mimeType ===
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )
  }

  async parse(input: FileParseInput): Promise<ParseResult> {
    const loader = new DocxLoader(input.filePath, { type: 'docx' })
    const docs = await loader.load()
    const plainText = docs.map((d) => d.pageContent).join('\n')

    if (!plainText.trim()) {
      throw new Error('DOCX 文件内容为空')
    }

    return { plainText }
  }
}
