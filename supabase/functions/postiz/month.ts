// The Analytics tab's last 30 days (his ask, 2026-11-14: "change the
// analytics section for the views for the last month, last 30 days, and keep
// stacking up"): for each of the last 30 days in his timezone, the views of
// the videos that went out that day (cutter_posts.views, read a day, three
// days and a week after each - postViews.ts), how many went out and how many
// didn't. The phone adds them up day after day.

import { addDays, localDate } from './slots.ts'

export const MONTH_DAYS = 30

export interface MonthDay {
  date: string
  views: number
  posted: number
  failed: number
}

export interface MonthRow {
  post_at: string | null
  status: string
  views: Record<string, number> | null
}

/** Statuses that count as a video that went out, or that didn't. */
const WENT_OUT = new Set(['posted'])
const DID_NOT = new Set(['failed', 'error'])

/** The last `days` days, oldest first, today last. */
export function monthDays(rows: readonly MonthRow[], now: number, tz: string, days = MONTH_DAYS): MonthDay[] {
  const today = localDate(new Date(now), tz)
  const out: MonthDay[] = Array.from({ length: days }, (_, i) => ({ date: addDays(today, i - days + 1), views: 0, posted: 0, failed: 0 }))
  const at = new Map(out.map((d) => [d.date, d]))
  for (const row of rows) {
    if (!row.post_at) continue
    const when = Date.parse(row.post_at)
    if (!Number.isFinite(when) || when > now) continue
    const day = at.get(localDate(new Date(when), tz))
    if (!day) continue
    if (WENT_OUT.has(row.status)) {
      day.posted++
      day.views += Object.values(row.views ?? {}).reduce((n, v) => n + (typeof v === 'number' && Number.isFinite(v) ? v : 0), 0)
    } else if (DID_NOT.has(row.status)) day.failed++
  }
  return out
}
