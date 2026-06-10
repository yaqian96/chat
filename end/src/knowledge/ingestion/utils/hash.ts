import { createHash } from 'crypto'

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 2)
}
