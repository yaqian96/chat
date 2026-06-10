import { Injectable } from '@nestjs/common'

@Injectable()
export class TextCleaner {
  clean(text: string): { plainText: string; quality: 'ok' | 'low' } {
    let result = text

    result = result.replace(/<br\s*\/?>/gi, '\n')
    result = result.replace(/<[^>]+>/g, '')
    result = result.replace(/&nbsp;/g, ' ')
    result = result.replace(/&lt;/g, '<')
    result = result.replace(/&gt;/g, '>')
    result = result.replace(/&amp;/g, '&')
    result = result.replace(/&quot;/g, '"')
    result = result.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
    result = result.replace(/[\u200B-\u200D\uFEFF]/g, '')
    result = result.replace(/[ \t]+$/gm, '')
    result = result.replace(/\n{3,}/g, '\n\n')
    result = result.trim()

    const readable = (result.match(/[\u4e00-\u9fff\w\s.,;:!?'"()[\]{}\-]/g) ?? []).length
    const ratio = result.length > 0 ? readable / result.length : 0
    const quality = ratio < 0.7 ? 'low' : 'ok'

    return { plainText: result, quality }
  }
}
