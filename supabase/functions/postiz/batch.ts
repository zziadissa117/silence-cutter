// A batch from the Batch tab: videos made days ahead from a campaign's bank
// of reactions, product showcases, headlines and music, each for one of its
// posting times on one day. They always wait for his approval, whatever the
// campaign's own setting, and he hears about them once - when the whole
// batch is up and ready - not once a video.
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
  return { id, date, time, size, ...(v.last === true ? { last: true } : {}), ...(look ? { look } : {}) }
}

/** Where a batch video goes: its own time first, then the day's other
 *  times in order after it, then before it - each with the same small
 *  offset every post gets, so they don't all land on the minute. */
export function batchChoices(batch: BatchInfo, times: Times, tz: string): { slot: string; at: Date }[] {
  const all = timesOn(times, batch.date)
  const after = all.filter((t) => t > batch.time)
  const before = all.filter((t) => t < batch.time).reverse()
  return [batch.time, ...after, ...before].map((time) => {
    const slot = `${batch.date} ${time}`
    return { slot, at: new Date(zoned(batch.date, time, tz).getTime() + jitterMinutes(slot) * 60_000) }
  })
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
