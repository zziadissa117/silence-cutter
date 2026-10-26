// A batch's videos not out yet, moved so each day's are evenly apart over
// the whole day (window.ts evenTimes) - his words (2026-10-26): "If you could
// change the already scheduled posts that I have right now ... I'm not doing
// that manually", "it all has to be evenly separated and operated over a
// 24-hour period". The same videos: one waiting for him stays waiting, one
// scheduled in Postiz is taken out and put back at its new time with the
// video Postiz already has (index.ts respreadBatches).
//
// Plain TypeScript with no imports beyond the posting function's own pure
// files, for Deno and the tests.

import { batchJitter } from './batch.ts'
import { localDate, localTime, zoned } from './slots.ts'
import { evenTimes } from './window.ts'

/** A post this close to going out stays where it is. */
export const RESPREAD_LEAD_MS = 20 * 60_000

/** The ones that can move: not out, not being put into Postiz this moment. */
const MOVABLE = new Set(['uploading', 'writing', 'waiting', 'approved', 'scheduled'])

export interface RespreadRow {
  id: string
  campaign_id: string
  status: string
  post_at: string | null
  created_at: string
  creating_at: string | null
  slot: string | null
  batch: { date: string; time: string } | null
}

export interface RespreadMove {
  id: string
  date: string
  time: string
  slot: string
  /** When it goes: the time, kept to the minute (batchJitter: an even time is never round). */
  postAt: string
}

/** Where each of the batch's videos still to go should be: by campaign and
 *  day, from today on, the ones that can move spread evenly over the day -
 *  today, over what is left of it after RESPREAD_LEAD_MS. In the order they
 *  were made, so the plan is the same however often it is worked out, and a
 *  video already at its place isn't moved. `pending`: days left for later,
 *  one of whose videos is being put into Postiz right now. */
export function planRespread(rows: readonly RespreadRow[], { now, tz }: { now: number; tz: string }): { moves: RespreadMove[]; pending: number } {
  const today = localDate(new Date(now), tz)
  const soon = now + RESPREAD_LEAD_MS
  const days = new Map<string, RespreadRow[]>()
  for (const row of rows) {
    if (!row.batch || row.batch.date < today) continue
    const key = `${row.campaign_id}|${row.batch.date}`
    days.set(key, [...(days.get(key) ?? []), row])
  }
  const moves: RespreadMove[] = []
  let pending = 0
  for (const [key, day] of days) {
    const [campaignId, date] = key.split('|')
    const stays = (r: RespreadRow) => !MOVABLE.has(r.status) || (r.post_at !== null && Date.parse(r.post_at) < soon)
    const moving = day.filter((r) => !stays(r)).sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
    if (moving.length === 0) continue
    // One being put into Postiz this moment: its day waits for the next go.
    if (moving.some((r) => r.creating_at)) {
      pending += moving.length
      continue
    }
    // Today: from a little after now - none left when that is already tomorrow.
    const from = date !== today ? 0 : localDate(new Date(soon), tz) !== today ? 24 * 60 : minutesOf(localTime(new Date(soon), tz)) + 1
    // Today's videos due soon or gone, and any other that stays, keep their minutes.
    const kept = new Set(day.filter(stays).map((r) => r.batch!.time))
    const times = evenTimes(moving.length, `${campaignId}|respread`, date, from).map((t) => clearOf(t, kept))
    moving.forEach((row, i) => {
      const time = times[i]
      // Late at night, with more left today than minutes: the rest stay put.
      if (!time) return
      const slot = `${date} ${time}`
      const postAt = new Date(zoned(date, time, tz).getTime() + batchJitter(slot) * 60_000).toISOString()
      if (row.slot === slot && row.post_at && Math.abs(Date.parse(row.post_at) - Date.parse(postAt)) < 60_000) return
      moves.push({ id: row.id, date, time, slot, postAt })
    })
  }
  moves.sort((a, b) => a.postAt.localeCompare(b.postAt))
  return { moves, pending }
}

function minutesOf(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))
}

/** A minute on from a time a video that stays already has (the slot holds one). */
function clearOf(time: string, kept: ReadonlySet<string>): string {
  let m = minutesOf(time)
  for (let n = 0; n < 5 && kept.has(hhmm(m)); n++) m = Math.min(24 * 60 - 1, m + 1)
  return hhmm(m)
}

function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}
