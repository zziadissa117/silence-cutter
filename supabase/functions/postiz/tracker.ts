// The campaign tracker (his ask, 2026-11-14: "I can't remember, every single
// day, which brands posted, which did not post, and which ones I need to post
// on"): a week, Monday first, and for each campaign how many posts go out on
// each day - posted, still set to go, waiting for his OK, or that didn't go
// out. The phone draws it at the top of the Videos tab (WeekTracker.tsx) and
// adds what a running batch will still make.
//
// Plain TypeScript, no imports but the dates, for Deno and the tests.

import { addDays, localDate } from './slots.ts'

/** One campaign's posts on one day. */
export interface TrackerCell {
  posted: number
  /** Set to go out by themselves: approved, scheduled, still being written or sent up. */
  scheduled: number
  /** Waiting for his OK. */
  waiting: number
  /** Didn't go out. */
  failed: number
  /** Of all those, the batch's: the phone adds what the batch still makes. */
  batch: number
}

export interface TrackerCampaign {
  id: string
  name: string
  days: TrackerCell[]
  /** Its posts in the week before: a campaign that went quiet stays on for a week, its days empty -
   *  unless the last he did with it was reject its videos (he stopped it). */
  before: number
}

export interface TrackerWeek {
  /** The seven days, Monday first ("2026-11-09"). */
  days: string[]
  /** Today in his time zone. */
  today: string
  campaigns: TrackerCampaign[]
}

export interface TrackerRow {
  post_at: string | null
  status: string
  campaign_id: string | null
  campaign_name: string | null
  batch: { date?: string } | null
}

/** The statuses the tracker reads: rejected ones are not counted - they are
 *  not his posts any more - but say which campaigns he stopped. */
export const TRACKED_STATUSES = ['posted', 'approved', 'scheduled', 'writing', 'uploading', 'waiting', 'error', 'failed', 'rejected'] as const

const KIND: Record<string, keyof Omit<TrackerCell, 'batch'>> = {
  posted: 'posted',
  approved: 'scheduled',
  scheduled: 'scheduled',
  writing: 'scheduled',
  uploading: 'scheduled',
  waiting: 'waiting',
  error: 'failed',
  failed: 'failed',
}

/** Monday of the week `date` is in, `weeks` weeks on (back when negative). */
export function mondayOf(date: string, weeks = 0): string {
  const [y, m, d] = date.split('-').map(Number)
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return addDays(date, -((day + 6) % 7) + weeks * 7)
}

const empty = (): TrackerCell => ({ posted: 0, scheduled: 0, waiting: 0, failed: 0, batch: 0 })

/** The week from `monday`, each campaign's posts by day in `tz`. A post with
 *  no time any more (one that failed before it was sent) counts on its batch
 *  day. `ended`: campaigns he ended - shown only while they still have posts
 *  that week. */
export function trackerWeek(rows: readonly TrackerRow[], monday: string, now: number, tz: string, ended: ReadonlySet<string> = new Set()): TrackerWeek {
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i))
  const weekBefore = addDays(monday, -7)
  const byId = new Map<string, TrackerCampaign & { lastAt: string; kept: string; rejected: string }>()
  for (const row of rows) {
    const kind = KIND[row.status]
    if (!kind && row.status !== 'rejected') continue
    const day = row.post_at ? localDate(new Date(row.post_at), tz) : (row.batch?.date ?? null)
    if (!day || day < weekBefore || day > days[6]) continue
    const id = row.campaign_id || `name:${row.campaign_name ?? ''}`
    let c = byId.get(id)
    if (!c) {
      c = { id, name: row.campaign_name?.trim() || 'Campaign', days: days.map(empty), before: 0, lastAt: '', kept: '', rejected: '' }
      byId.set(id, c)
    }
    if (!kind) {
      if (day > c.rejected) c.rejected = day
      continue
    }
    if (day > c.kept) c.kept = day
    // Its newest name, if it was renamed.
    if (row.campaign_name && (row.post_at ?? '') >= c.lastAt) {
      c.name = row.campaign_name.trim() || c.name
      c.lastAt = row.post_at ?? c.lastAt
    }
    if (day < monday) {
      c.before++
      continue
    }
    const cell = c.days[days.indexOf(day)]
    cell[kind]++
    if (row.batch) cell.batch++
  }
  const campaigns = [...byId.values()]
    .filter((c) => {
      const inWeek = c.days.some((d) => d.posted + d.scheduled + d.waiting + d.failed > 0)
      // Quiet this week: on, unless he ended it or rejected its newest videos.
      return inWeek || (!ended.has(c.id) && c.before > 0 && c.rejected < c.kept)
    })
    .map((c) => ({ id: c.id, name: c.name, days: c.days, before: c.before }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  return { days, today: localDate(new Date(now), tz), campaigns }
}
