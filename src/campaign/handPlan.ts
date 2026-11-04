// New post with several videos: which day and time each goes, never more on
// a day than the campaign allows. His ask (2026-11-03): "let's say I drop in
// 14: it's going to divide them from today to the next days, depending on how
// many posts are allowed per day on that campaign" - and a note to Claude
// ("2 per day for the next 14 days", handNote.ts) can ask for fewer a day or
// a later start, never more than the campaign's most (the campaign comes
// first).
//
// A day's room is the campaign's most a day less what it already has that
// day, and the note's number at most. Today's times start a quarter of an hour
// from now; each day's are spread evenly over the campaign's window
// (window.ts evenTimes). With "All now", today's room goes now.

import { addDays } from './batch'
import { evenTimes } from '../../supabase/functions/postiz/window.ts'

export interface HandSlot {
  date: string
  /** "14:37"; null: now. */
  time: string | null
}

export interface HandPlanInput {
  count: number
  /** The campaign's most posts a day, if it has one. */
  campaignMost?: number
  /** How many a day his note asks for, if it does. */
  notePerDay?: number | null
  /** The day his note says to start, if later than today. */
  startDate?: string | null
  today: string
  /** Minutes into today, now. */
  nowMinute: number
  /** How many posts the campaign already has on a day. */
  used: (date: string) => number
  /** The campaign's posting window, in minutes of the day. */
  window: { from: number; to: number }
  /** The campaign's id: its own times on each day. */
  key: string
  /** "All now": today's room goes now. */
  nowFirst?: boolean
  /** How many a day he chose on the screen (2026-11-04: "you have 10 videos
   *  ... post 2 per day, post 1 per day?"); never past the campaign's most. */
  chosenPerDay?: number | null
  /** Saturdays and Sundays too; false skips them. Default: too. */
  weekends?: boolean
}

/** Saturday or Sunday ("2026-11-07"). */
export function isWeekend(date: string): boolean {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay()
  return day === 0 || day === 6
}

/** Today's times start this long from now. */
const LEAD_MINUTES = 15

/** Each video's day and time, in order - or null when nothing limits the
 *  day (no most a day, no number or later start in the note): posted as he
 *  chose. */
export function planHandDays(input: HandPlanInput): HandSlot[] | null {
  const { count, campaignMost, notePerDay, chosenPerDay, today, nowMinute, used, window, key, nowFirst = false, weekends = true } = input
  const later = Boolean(input.startDate && input.startDate > today)
  if (!campaignMost && !notePerDay && !chosenPerDay && !later && weekends) return null
  const start = later ? input.startDate! : today
  const out: HandSlot[] = []
  for (let d = 0; out.length < count && d < 400; d++) {
    const date = addDays(start, d)
    if (!weekends && isWeekend(date)) continue
    const most = campaignMost ? Math.max(0, campaignMost - used(date)) : Infinity
    const asked = chosenPerDay ? Math.max(0, chosenPerDay - used(date)) : Infinity
    const room = Math.min(most, asked, notePerDay ?? Infinity, count - out.length)
    if (room <= 0) continue
    if (date === today && nowFirst) {
      for (let k = 0; k < room; k++) out.push({ date, time: null })
      continue
    }
    const from = date === today ? Math.max(window.from, nowMinute + LEAD_MINUTES) : window.from
    if (from >= window.to - 1) continue
    for (const time of evenTimes(room, `${key}|hand`, date, from, window.to)) out.push({ date, time })
  }
  return out
}

/** "Today 1 · Tue 2 · Wed 2" - the plan, said. */
export function planSaid(slots: readonly HandSlot[], today: string): string {
  const days = new Map<string, number>()
  for (const s of slots) days.set(s.date, (days.get(s.date) ?? 0) + 1)
  const name = (date: string) =>
    date === today
      ? 'Today'
      : date === addDays(today, 1)
        ? 'Tomorrow'
        : new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
  return [...days].map(([date, n]) => `${name(date)} ${n}`).join(' · ')
}
