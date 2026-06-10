import { Injectable } from '@nestjs/common'
import type { ParseResult } from './types'

@Injectable()
export class YoudaoTextParser {
  parse(content: string, title?: string): ParseResult {
    let text = this.unwrapContent(content.trim())

    if (!text && title) {
      text = title.replace(/\.note$/i, '').trim()
    }

    const isMarkdown = this.detectMarkdown(text)

    return { plainText: text, isMarkdown }
  }

  private unwrapContent(raw: string): string {
    if (!raw) return ''

    if (raw.startsWith('{') || raw.startsWith('[')) {
      try {
        const parsed = JSON.parse(raw) as unknown
        if (parsed && typeof parsed === 'object' && 'content' in parsed) {
          const inner = (parsed as { content?: unknown }).content
          return typeof inner === 'string' ? inner : raw
        }
      } catch {
        return raw
      }
    }

    return raw
  }

  private detectMarkdown(text: string): boolean {
    return /^#{1,6}\s/m.test(text) || /^\s*[-*+]\s/m.test(text) || /```/.test(text)
  }
}
