// Formats: one way of making a video, filmed again and again. A campaign's
// formats are its angles marked `isFormat` - the look (headline, captions,
// logo, effects, music) and the clips joined onto every video (before,
// after, in the middle) - with a script: its lines in order ("ELON MUST BE
// STOPPED", "NO WAY HE DID THIS", "Oh and by the way vertus", "Link in
// bio"). He films each line again and again, a different way each time, and
// drops the takes into it; Make mixes them into videos, one take of every
// line each (mixesOf), joined, cut, captioned and kept on the phone instead
// of sent (CampaignApp.makeFormat, holdFormat), so he can watch them and send
// them to the brand. Once the brand says yes he taps Over the month (or the
// week, or the next 5 days), and they are spread over those days at the
// campaign's own times - going without asking again (the server's
// approvalFor, `scheduled`).

import { LEAD_MINUTES, addDays, todayHere, type BankFile, type BatchSlot } from './batch'
import { batchTimesOn, stackTimesOn, type CampaignPlace } from './posting'

/** The ways to schedule a format's videos: over a month, a week, or 5 days. */
export const SCHEDULE_DAYS = [30, 7, 5] as const

/** One take of a line, kept like the Batch tab's clips (store.saveBankFile). */
export interface FormatTake extends BankFile {
  /** When it was filmed, from the file - takes filmed together go together. */
  filmedAt?: number
}

/** A line of a format's script: what he says, filmed again and again. */
export interface FormatLine {
  id: string
  /** What he says in it, as he wrote it. */
  words: string
  takes: FormatTake[]
}

/** A format's script, kept on the phone (store.loadFormatScript). The first
 *  line's takes are the openings not made into a video yet: each opens one
 *  video only, then goes. */
export interface FormatScript {
  angleId: string
  lines: FormatLine[]
  /** How many videos each take of the other lines is in so far, by id. */
  uses: Record<string, number>
  /** Fingerprints of the openings already made into videos: one never comes
   *  back, so no two videos open the same way. */
  opened: string[]
}

export function emptyScript(angleId: string): FormatScript {
  return { angleId, lines: [], uses: {}, opened: [] }
}

const byFilming = (a: FormatTake, b: FormatTake) => (a.filmedAt ?? 0) - (b.filmedAt ?? 0)

/** The videos the script makes now: one for every opening not made yet,
 *  each with a take of every other line, in line order. Of a line, the take
 *  in the fewest videos so far, and of those the one filmed nearest the
 *  opening - or, when the files don't say when, in the same place in the
 *  line - so takes filmed together stay together: 30 takes of every line
 *  make 30 videos with every take in one, and 3 takes of "Link in bio" go
 *  round. Nothing until every line has a take. */
export function mixesOf(script: FormatScript): FormatTake[][] {
  const [opening, ...rest] = script.lines
  if (!opening || opening.takes.length === 0 || rest.some((line) => line.takes.length === 0)) return []
  const uses = { ...script.uses }
  const lines = rest.map((line) => [...line.takes].sort(byFilming))
  return [...opening.takes].sort(byFilming).map((first, n) => [
    first,
    ...lines.map((takes) => {
      const apart = (take: FormatTake, k: number) =>
        first.filmedAt !== undefined && take.filmedAt !== undefined ? Math.abs(take.filmedAt - first.filmedAt) : Math.abs(k - n)
      let best = 0
      for (let k = 1; k < takes.length; k++) {
        const fewer = (uses[takes[k].id] ?? 0) - (uses[takes[best].id] ?? 0)
        if (fewer < 0 || (fewer === 0 && apart(takes[k], k) < apart(takes[best], best))) best = k
      }
      uses[takes[best].id] = (uses[takes[best].id] ?? 0) + 1
      return takes[best]
    }),
  ])
}

/** The script once `mixes` are on their way: their openings out of the
 *  first line and never to come back, the other takes counted. */
export function afterMixing(script: FormatScript, mixes: readonly FormatTake[][]): FormatScript {
  const openings = new Set(mixes.map((mix) => mix[0].id))
  const uses = { ...script.uses }
  for (const mix of mixes) for (const take of mix.slice(1)) uses[take.id] = (uses[take.id] ?? 0) + 1
  const gone = script.lines[0]?.takes.filter((t) => openings.has(t.id)) ?? []
  return {
    ...script,
    lines: script.lines.map((line, i) => (i === 0 ? { ...line, takes: line.takes.filter((t) => !openings.has(t.id)) } : line)),
    uses,
    opened: [...script.opened, ...gone.map((t) => t.fp ?? `${t.name}|${t.size}`)],
  }
}

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

/** "Mon, Tue, Thu, Sat" - which days a schedule posts on; past a week of
 *  days, "Thu 22 Oct to Fri 20 Nov". */
export function daysLine(slots: readonly BatchSlot[]): string {
  const days = [...new Set(slots.map((s) => s.date))].sort()
  const day = (d: string, how: Intl.DateTimeFormatOptions) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, how)
  if (days.length > 7) {
    const long = { weekday: 'short', day: 'numeric', month: 'short' } as const
    return `${day(days[0], long)} to ${day(days[days.length - 1], long)}`
  }
  return days.map((d) => day(d, { weekday: 'short' })).join(', ')
}
