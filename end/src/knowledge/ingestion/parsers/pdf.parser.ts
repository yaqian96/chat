import { Injectable } from '@nestjs/common'
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf'
import type { DocumentParser, FileParseInput, ParseResult } from './types'

@Injectable()
export class PdfParser implements DocumentParser {
  readonly name = 'pdf'

  supports(input: FileParseInput): boolean {
    const ext = input.fileName.split('.').pop()?.toLowerCase()
    return ext === 'pdf' || input.mimeType === 'application/pdf'
  }

  async parse(input: FileParseInput): Promise<ParseResult> {
    const loader = new PDFLoader(input.filePath, { splitPages: true })
    const docs = await loader.load()

    if (!docs.length) {
      throw new Error('PDF 解析结果为空，可能是扫描版 PDF')
    }

    const plainText = docs
      .map((doc, i) => {
        const page = doc.metadata?.loc?.pageNumber ?? i + 1
        return `--- page ${page} ---\n${doc.pageContent}`
      })
      .join('\n\n')

    return {
      plainText,
      pageCount: docs.length,
    }
  }
}
