import { BadRequestException, Injectable } from '@nestjs/common'
import { DocxParser } from './docx.parser'
import { MarkdownParser } from './markdown.parser'
import { PdfParser } from './pdf.parser'
import { PlainTextParser } from './plain-text.parser'
import { XlsxParser } from './xlsx.parser'
import type { DocumentParser, FileParseInput, ParseResult } from './types'

@Injectable()
export class ParserRegistry {
  private readonly parsers: DocumentParser[]

  constructor(
    pdfParser: PdfParser,
    docxParser: DocxParser,
    xlsxParser: XlsxParser,
    plainTextParser: PlainTextParser,
    markdownParser: MarkdownParser,
  ) {
    this.parsers = [pdfParser, docxParser, xlsxParser, markdownParser, plainTextParser]
  }

  resolve(input: FileParseInput): DocumentParser {
    const parser = this.parsers.find((p) => p.supports(input))
    if (!parser) {
      throw new BadRequestException(`不支持的文件格式: ${input.fileName}`)
    }
    return parser
  }

  async parse(input: FileParseInput): Promise<ParseResult> {
    const parser = this.resolve(input)
    return parser.parse(input)
  }
}
