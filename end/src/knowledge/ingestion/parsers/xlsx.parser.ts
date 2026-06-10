import { Injectable } from '@nestjs/common'
import { readFileSync } from 'fs'
import * as XLSX from 'xlsx'
import type { DocumentParser, FileParseInput, ParseResult } from './types'

@Injectable()
export class XlsxParser implements DocumentParser {
  readonly name = 'xlsx'

  supports(input: FileParseInput): boolean {
    const ext = input.fileName.split('.').pop()?.toLowerCase()
    return (
      ext === 'xlsx' ||
      ext === 'xls' ||
      input.mimeType ===
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      input.mimeType === 'application/vnd.ms-excel'
    )
  }

  async parse(input: FileParseInput): Promise<ParseResult> {
    const buffer = readFileSync(input.filePath)
    const workbook = XLSX.read(buffer, { type: 'buffer' })

    if (!workbook.SheetNames.length) {
      throw new Error('Excel 文件没有工作表')
    }

    const parts = workbook.SheetNames.map((name) => {
      const sheet = workbook.Sheets[name]
      const rows = XLSX.utils.sheet_to_csv(sheet, { blankrows: false })
      return `--- sheet ${name} ---\n${rows}`
    })

    const plainText = parts.join('\n\n').trim()
    if (!plainText) {
      throw new Error('Excel 文件内容为空')
    }

    return {
      plainText,
      pageCount: workbook.SheetNames.length,
    }
  }
}
