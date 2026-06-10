import type { HistoryGroup, SessionMeta } from '../types'

function startOfDay(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

function formatMonth(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

export function groupSessionsByDate(sessions: SessionMeta[]): HistoryGroup[] {
  const now = new Date()
  const todayStart = startOfDay(now).getTime()
  const sevenDaysAgo = todayStart - 7 * 24 * 60 * 60 * 1000
  const thirtyDaysAgo = todayStart - 30 * 24 * 60 * 60 * 1000

  const buckets: Record<string, HistoryGroup> = {
    today: { label: '今天', sessions: [] },
    week: { label: '7 天内', sessions: [] },
    month: { label: '30 天内', sessions: [] },
  }
  const monthBuckets = new Map<string, HistoryGroup>()

  const sorted = [...sessions].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  )

  for (const session of sorted) {
    const ts = new Date(session.updatedAt).getTime()
    const item = { id: session.id, title: session.title }

    if (ts >= todayStart) {
      buckets.today.sessions.push(item)
    } else if (ts >= sevenDaysAgo) {
      buckets.week.sessions.push(item)
    } else if (ts >= thirtyDaysAgo) {
      buckets.month.sessions.push(item)
    } else {
      const label = formatMonth(new Date(session.updatedAt))
      if (!monthBuckets.has(label)) {
        monthBuckets.set(label, { label, sessions: [] })
      }
      monthBuckets.get(label)!.sessions.push(item)
    }
  }

  const result: HistoryGroup[] = []
  for (const key of ['today', 'week', 'month'] as const) {
    if (buckets[key].sessions.length > 0) {
      result.push(buckets[key])
    }
  }

  const months = [...monthBuckets.values()].sort((a, b) =>
    b.label.localeCompare(a.label),
  )
  result.push(...months)

  return result
}
