// Formats: one way of making a video, filmed again and again. A campaign's
// formats are its angles marked `isFormat` - the look (headline, captions,
// logo, effects, music) and the clips joined onto every take (before, after,
// in the middle). Takes dropped into one are cut, captioned and joined like
// any talking video, then kept on the phone instead of sent
// (CampaignApp.holdFormat), so he can watch them and send them to the brand.
// Once the brand says yes he taps Schedule for the week (or the next 5
// days), and they are spread over those days at the campaign's own times -
// going without asking again (the server's approvalFor, `scheduled`).

import { LEAD_MINUTES, addDays, todayHere, type BatchSlot } from './batch'
import { batchTimesOn, stackTimesOn, type CampaignPlace } from './posting'

/** The two ways to schedule a format's videos: over a week, or 5 days. */
export const SCHEDULE_DAYS = [7, 5] as const

/** How many go on each of `days` days: as even as it gets, starting on the
 *  first day - 4 over 7 is 1, 1, 0, 1, 0, 1, 0. */
export function perDayCounts(count: number, days: number): number[] {
  if (days < 1) return []
  return Array.from({ length: days }, (_, d) => Math.ceil(((d + 1) * count) / days) - Math.ceil((d * count) / days))
}

const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))

/** Where `count` videos go over the next `days` days, in order: as evenly
 *  as perDayCounts, at the campaign's batch times - clear of the times a day
 *  already holds (`taken`). Today counts only when it still has room for its
 *  share an hour or more ahead; otherwise the days start tomorrow. A day
 *  without room for its share passes the rest to the next, so every video
 *  gets a time even past the last day. */
export function spreadOver({
  count,
  days,
  place,
  campaignId,
  taken = () => [],
  now = new Date(),
}: {
  count: number
  days: number
  place: CampaignPlace
  campaignId: string
  taken?: (date: string) => readonly string[]
  now?: Date
}): BatchSlot[] {
  if (count < 1 || days < 1) return []
  const today = todayHere(now)
  const soonest = now.getHours() * 60 + now.getMinutes() + LEAD_MINUTES
  const timesFor = (date: string, n: number) => {
    const holds = taken(date)
    const times = holds.length > 0 ? stackTimesOn(place, campaignId, date, n, holds) : batchTimesOn(place, campaignId, date, n)
    return times.filter((t) => date !== today || minutes(t) >= soonest).slice(0, n)
  }
  const counts = perDayCounts(count, days)
  const start = counts[0] > 0 && timesFor(today, counts[0]).length < counts[0] ? addDays(today, 1) : today
  const slots: BatchSlot[] = []
  let carry = 0
  // Past the last day only for what didn't fit - never more than a month on.
  for (let d = 0; slots.length < count && d < days + 31; d++) {
    const date = addDays(start, d)
    const want = (counts[d] ?? 0) + carry
    if (want === 0) continue
    const times = timesFor(date, want)
    for (const time of times) slots.push({ date, time })
    carry = want - times.length
  }
  return slots.slice(0, count)
}

/** "Mon, Tue, Thu, Sat" - which days a schedule posts on. */
export function daysLine(slots: readonly BatchSlot[]): string {
  const days = [...new Set(slots.map((s) => s.date))].sort()
  return days.map((d) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' })).join(', ')
}
