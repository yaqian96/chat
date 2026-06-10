export interface ParseResult {
  plainText: string
  pageCount?: number
  warnings?: string[]
  isMarkdown?: boolean
}

export interface FileParseInput {
  filePath: string
  fileName: string
  mimeType: string
}

export interface DocumentParser {
  readonly name: string
  supports(input: FileParseInput): boolean
  parse(input: FileParseInput): Promise<ParseResult>
}
