// A batch from the Batch tab: videos made days ahead from a campaign's bank
// of reactions, product showcases, headlines and music, each for one of its
// posting times on one day. They wait for his approval, whatever the
// campaign's own setting - until he has approved 3 of a batch, then the rest
// of it goes by itself (batchTrusted) - and he hears about them once, when
// the whole batch is up and ready, not once a video.
//
// Plain TypeScript with no imports beyond slots.ts, for Deno and the tests.

import { jitterMinutes, normalTimes, timesOn, zoned, type Times } from './slots.ts'

export interface BatchInfo {
  /** The making it came from: every video he made in one go. */
  id: string
  /** The day it posts, and at which of the campaign's times. */
  date: string
  time: string
  /** How many videos that making made. */
  size: number
  /** The last different videos his clips could make: the batch stops after
   *  them until he films new ones. */
  last?: boolean
  /** The hook's look it was made with, for the phone to count how each
   *  hook does. */
  look?: 'box' | 'outline' | 'snap' | 'formula'
  /** He turned it down in To approve: the batch makes another for its day. */
  disliked?: boolean
  /** The song under it, by name, for how each song does (hookInsights.ts). */
  song?: string
  /** A Trial loop's video (the phone's trialLoop.ts): an Instagram Trial
   *  Reel - shown to non-followers only, never shared to his followers,
   *  never handed to Buffer. Kept only for a login allowed Trial reels
   *  (trial.ts trialAllowed). */
  trial?: boolean
  /** A Trial loop's video: the viral reel it is a copy of. His yes counts
   *  per viral reel, not per making (trustKey). */
  source?: string
}

const LOOKS = new Set(['box', 'outline', 'snap', 'formula'])

/** The batch a video says it belongs to, or null when what came is not one. */
export function batchInfo(value: unknown): BatchInfo | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  const id = typeof v.id === 'string' && /^[\w-]{1,80}$/.test(v.id) ? v.id : null
  const date = typeof v.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.date) ? v.date : null
  const time = typeof v.time === 'string' && normalTimes([v.time]).length === 1 ? v.time.trim() : null
  const size = Number(v.size)
  if (!id || !date || !time || !Number.isInteger(size) || size < 1 || size > 500) return null
  const look = typeof v.look === 'string' && LOOKS.has(v.look) ? (v.look as BatchInfo['look']) : undefined
  const song = typeof v.song === 'string' ? v.song.trim().slice(0, 120) : ''
  return {
    id,
    date,
    time,
    size,
    ...(v.last === true ? { last: true } : {}),
    ...(look ? { look } : {}),
    ...(song ? { song } : {}),
    ...(v.trial === true ? { trial: true } : {}),
    ...(v.trial === true && typeof v.source === 'string' && /^[\w-]{1,80}$/.test(v.source) ? { source: v.source } : {}),
  }
}

/** What his yeses are counted over (BATCH_TRUST): a Trial loop's copies of
 *  one viral reel, whichever day's making they came from - approve 3 of a
 *  reel and every copy of it after goes by itself (his ask, 2026-11-06:
 *  videos "I can check for approval"); any other batch, its own making. */
export function trustKey(batch: Pick<BatchInfo, 'id' | 'trial' | 'source'>): { field: 'source' | 'id'; value: string } {
  return batch.trial && batch.source ? { field: 'source', value: batch.source } : { field: 'id', value: batch.id }
}

/** Where a batch video goes: its own time first, then the day's other
 *  times in order after it, then before it. A round time (a minute ending in
 *  0 or 5 - his own times) gets the same small offset every post gets, so
 *  they don't all land on the minute; a time the phone spread evenly over the
 *  day (window.ts evenTimes - never round) is kept to the minute, or 125 a
 *  day 11 minutes apart could come out 2 minutes apart. */
export function batchChoices(batch: BatchInfo, times: Times, tz: string): { slot: string; at: Date }[] {
  const all = timesOn(times, batch.date)
  const after = all.filter((t) => t > batch.time)
  const before = all.filter((t) => t < batch.time).reverse()
  return [batch.time, ...after, ...before].map((time) => {
    const slot = `${batch.date} ${time}`
    return { slot, at: new Date(zoned(batch.date, time, tz).getTime() + batchJitter(slot) * 60_000) }
  })
}

/** The minutes a batch video's time moves: 0-9 on a round time, none on an even one. */
export function batchJitter(slot: string): number {
  return Number(slot.slice(-2)) % 5 === 0 ? jitterMinutes(slot) : 0
}

/** "Wed Sep 30" to "Tue Oct 6" - what the notification says. */
export function batchSpan(dates: string[]): string {
  const day = (date: string) =>
    new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
  const sorted = [...new Set(dates)].sort()
  if (sorted.length === 0) return ''
  return sorted.length === 1 ? day(sorted[0]) : `${day(sorted[0])} to ${day(sorted[sorted.length - 1])}`
}

/** A batch's one notification once its videos are up: how many to approve,
 *  over which days - and, when they are the last different videos his clips
 *  can make, that the batch stops after them and wants new clips. */
export function batchReady(campaign: string, dates: string[], last: boolean): { title: string; body: string } {
  const count = dates.length
  const videos = `${count} video${count === 1 ? '' : 's'}`
  if (last) {
    return {
      title: `${campaign}: the last ${videos} - film new clips`,
      body: `Every different video your clips can make is done. These post ${batchSpan(dates)}, then the batch stops - approve them in Posts, and add new reactions and product showcases in Batch to keep it going.`,
    }
  }
  const perDay = Math.max(...Object.values(dates.reduce<Record<string, number>>((n, d) => ({ ...n, [d]: (n[d] ?? 0) + 1 }), {})))
  return { title: `${campaign}: ${videos} ready to approve`, body: `${perDay} a day, ${batchSpan(dates)}. Approve them in Posts.` }
}

/** Who says a video arriving can go. By hand, or made again with "approve":
 *  nobody - it goes. A batch video: always him, on the Posts screen, whatever
 *  the campaign says - unless it is a Formats video he scheduled himself
 *  (`scheduled`), once the brand had seen it: it goes at its day and time.
 *  Anything else: the campaign's own rule. */
export function approvalFor(
  campaign: 'me' | 'direct' | 'brand',
  { hand, approveNow, batch, scheduled }: { hand: boolean; approveNow: boolean; batch: boolean; scheduled: boolean },
): 'me' | 'direct' | 'brand' {
  if (hand || approveNow || (batch && scheduled)) return 'direct'
  if (batch) return 'me'
  return campaign
}

/** How many of a batch's videos he approves before the rest of it goes by
 *  itself: "approve the first 3 and the rest go" (his pick, 2026-11-01). He
 *  watches 3 of each batch on the Posts screen; once 3 have his yes, the
 *  others - and any still being made for it - are approved for him. */
export const BATCH_TRUST = 3

/** What counts as his yes: approved, and everything an approved video goes
 *  on to be. A held one ("post later"), a turned-down one or one still
 *  waiting doesn't. */
const SAID_YES = new Set(['approved', 'scheduled', 'posted', 'error'])

/** Whether a batch has had enough of his yeses for the rest to go by itself. */
export function batchTrusted(statuses: readonly string[]): boolean {
  return statuses.filter((s) => SAID_YES.has(s)).length >= BATCH_TRUST
}

/** Times to try for a batch video when the campaign's own times that day
 *  are all taken: a quarter of an hour on from its time, then before it,
 *  further each time, within the day - and never within 10 minutes of a
 *  video of the campaign already going (`taken`, ms). Four of his friend's
 *  Playad videos went out at the same minute twice on 2026-10-31: the old
 *  fallback was "its own time anyway". */
export function freeBatchTimes(batch: BatchInfo, tz: string, taken: readonly number[]): { slot: string; at: Date }[] {
  const [h, m] = batch.time.split(':').map(Number)
  const own = h * 60 + m
  const out: { slot: string; at: Date }[] = []
  for (let k = 1; k <= 96; k++) {
    for (const minutes of [own + 15 * k, own - 15 * k]) {
      if (minutes < 0 || minutes >= 24 * 60) continue
      const time = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
      const at = zoned(batch.date, time, tz)
      if (taken.some((t) => Math.abs(t - at.getTime()) < 10 * 60_000)) continue
      out.push({ slot: `${batch.date} ${time}`, at })
    }
  }
  return out
}
