// When each post goes out: the campaign's own times of day, in his
// timezone, the first one no other video of that campaign has taken yet.
//
// A time is a slot - "2026-09-28 18:00" - and a slot holds one video. The
// post itself goes a few minutes after the hour (different each day) so a
// week of posts doesn't all land on the dot.
//
// Plain TypeScript, importing only window.ts: the edge function runs it on
// Deno, and the unit tests run it under Vitest.
//
// A campaign's times are either his own list, the same every day, or - with
// none of his own and a window set - each day's own random times inside it
// (window.ts). `Times` carries either; `timesOn` reads one day of it.

import { DEFAULT_WINDOW, cleanWindow, windowTimes } from './window.ts'

const MINUTE = 60_000

/** His own times, or a rule giving each date its times. */
export type Times = string[] | ((date: string) => string[])

/** One day's times, valid and in order. */
export function timesOn(times: Times, date: string): string[] {
  return normalTimes(typeof times === 'function' ? times(date) : times)
}

/** What a campaign's posting place says its times are: his own when he has
 *  any, else random ones from its window - or from the default window, so no
 *  campaign posts a video the moment it is ready. */
export function timesFor(place: { times?: string[]; window?: unknown } | undefined, campaignId: string): Times {
  const own = normalTimes(place?.times ?? [])
  if (own.length > 0) return own
  const window = cleanWindow(place?.window) ?? DEFAULT_WINDOW
  return (date: string) => windowTimes(window, campaignId, date)
}

/** "HH:MM" times, valid and in order, each once. */
export function normalTimes(times: string[]): string[] {
  const valid = times
    .map((t) => t.trim())
    .filter((t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t))
  return [...new Set(valid)].sort()
}

function partsIn(at: number, tz: string): Record<string, number> {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(at))
  const out: Record<string, number> = {}
  for (const p of parts) if (p.type !== 'literal') out[p.type] = Number(p.value)
  return out
}

/** How far `tz` is ahead of UTC at `at`, in milliseconds. */
function offsetAt(at: number, tz: string): number {
  const p = partsIn(at, tz)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUtc - Math.floor(at / 1000) * 1000
}

/** "YYYY-MM-DD" of `at` in `tz`. */
export function localDate(at: Date, tz: string): string {
  const p = partsIn(at.getTime(), tz)
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

/** "HH:MM" of `at` in `tz`. */
export function localTime(at: Date, tz: string): string {
  const p = partsIn(at.getTime(), tz)
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`
}

/** The moment it is `time` on `date` in `tz`. */
export function zoned(date: string, time: string, tz: string): Date {
  const [y, m, d] = date.split('-').map(Number)
  const [h, mi] = time.split(':').map(Number)
  const wall = Date.UTC(y, m - 1, d, h, mi)
  // Twice: the offset is the one at the moment itself, which only matters
  // on the nights the clocks change.
  let at = wall - offsetAt(wall, tz)
  at = wall - offsetAt(at, tz)
  return new Date(at)
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const next = new Date(Date.UTC(y, m - 1, d + days))
  return next.toISOString().slice(0, 10)
}

/** 0-9 minutes, the same for the same slot and different from day to day. */
export function jitterMinutes(slot: string): number {
  let hash = 2166136261
  for (let i = 0; i < slot.length; i++) {
    hash ^= slot.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) % 10
}

export interface SlotChoice {
  slot: string
  at: Date
}

export interface SlotQuery {
  times: Times
  /** Slots already holding a video of this campaign. */
  taken: Set<string>
  now: Date
  tz: string
  /** How soon the earliest usable time may be. */
  leadMinutes?: number
  /** How far ahead to look. */
  days?: number
  /** Only today's times - for a late brand approval, which posts at once
   *  rather than waiting for tomorrow. */
  todayOnly?: boolean
}

/** The first free slot, or null when there is none in range. */
export function nextSlot({ times, taken, now, tz, leadMinutes = 10, days = 14, todayOnly = false }: SlotQuery): SlotChoice | null {
  if (Array.isArray(times) && normalTimes(times).length === 0) return null
  const today = localDate(now, tz)
  const earliest = now.getTime() + leadMinutes * MINUTE
  for (let d = 0; d < (todayOnly ? 1 : days); d++) {
    const date = addDays(today, d)
    for (const time of timesOn(times, date)) {
      const slot = `${date} ${time}`
      if (taken.has(slot)) continue
      const at = new Date(zoned(date, time, tz).getTime() + jitterMinutes(slot) * MINUTE)
      if (at.getTime() < earliest) continue
      return { slot, at }
    }
  }
  return null
}

// --- Late days ----------------------------------------------------------------
//
// He doesn't always upload in the morning, and a day's videos that come in
// late still go out that day: once one of a campaign's times has gone by
// with no video, its videos for the rest of the day are spread evenly from
// half an hour after the first late one came in until midnight. On a day he
// is on time, videos beyond the campaign's own times are spread between its
// last time and midnight. Videos he made for the next days skip all this
// and take the normal times from tomorrow.

/** What decided a spread video's time: the day ran late, or it is one more
 *  than the campaign's own times. */
export type Spread = 'late' | 'extra'

export interface OtherPost {
  slot: string
  spread: Spread | null
}

export type TimeChoice =
  | { kind: 'fixed'; slot: string; at: Date }
  | { kind: 'spread'; spread: Spread; slot: string }

/** A campaign's times today, where they fall. */
function todaysTimes(times: Times, date: string, tz: string): { slot: string; at: number }[] {
  return timesOn(times, date).map((time) => {
    const slot = `${date} ${time}`
    return { slot, at: zoned(date, time, tz).getTime() + jitterMinutes(slot) * MINUTE }
  })
}

/** The moment today's last time falls, or null with no times. */
export function lastTimeToday(times: Times, date: string, tz: string): number | null {
  const today = todaysTimes(times, date, tz)
  return today.length > 0 ? today[today.length - 1].at : null
}

/** Midnight at the end of `date`. */
export function endOfDay(date: string, tz: string): number {
  return zoned(addDays(date, 1), '00:00', tz).getTime()
}

/** The time for a video coming in now: one of the campaign's own, or a
 *  place in today's spread (its time set by spreadDay), or null when the
 *  campaign has no times at all. */
export function pickTime({
  times,
  others,
  now,
  tz,
  later = false,
  leadMinutes = 10,
}: {
  times: Times
  /** The campaign's other videos that have a time. */
  others: OtherPost[]
  now: Date
  tz: string
  /** Made for the next days: normal times from tomorrow. */
  later?: boolean
  leadMinutes?: number
}): TimeChoice | null {
  if (timesOn(times, localDate(now, tz)).length === 0) return null
  const taken = new Set(others.map((o) => o.slot))
  if (later) {
    const tomorrow = zoned(addDays(localDate(now, tz), 1), '00:00', tz)
    const next = nextSlot({ times, taken, now: new Date(Math.max(now.getTime(), tomorrow.getTime())), tz, leadMinutes: 0 })
    return next ? { kind: 'fixed', ...next } : null
  }
  const date = localDate(now, tz)
  const earliest = now.getTime() + leadMinutes * MINUTE
  const today = todaysTimes(times, date, tz)
  const missed = today.some((t) => t.at < earliest && !taken.has(t.slot))
  const spreadToday = others.filter((o) => o.spread && o.slot.startsWith(`${date} +`))
  const lateAlready = spreadToday.some((o) => o.spread === 'late')
  if (!missed && !lateAlready) {
    const free = today.find((t) => !taken.has(t.slot) && t.at >= earliest)
    if (free) return { kind: 'fixed', slot: free.slot, at: new Date(free.at) }
  }
  const used = spreadToday.map((o) => Number(o.slot.slice(date.length + 2))).filter(Number.isFinite)
  const n = used.length > 0 ? Math.max(...used) + 1 : 1
  return { kind: 'spread', spread: missed || lateAlready ? 'late' : 'extra', slot: `${date} +${n}` }
}

export interface SpreadMember {
  id: string
  /** Its time now, if it has one. */
  at: number | null
  /** Already in Postiz, or on its way there: its time stays. */
  locked: boolean
}

/** 0 to 1, the same for the same id: where in the day's spread a video lands. */
function shareOf(id: string): number {
  let hash = 2166136261
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  hash ^= hash >>> 15
  hash = Math.imul(hash, 2246822507)
  hash ^= hash >>> 13
  return (hash >>> 0) / 4294967296
}

/** Times for one kind of a day's spread videos: each at a random moment
 *  between `start` and `end` (midnight), drawn from its own id - so a video
 *  keeps its time when another late one arrives, and a week of late nights
 *  never lands on the same minutes. Late ones start at `start` (a little after
 *  the first came in); extra ones start at the campaign's last time. Never
 *  sooner than `lead` from now and at least `minGap` from any other - ones
 *  already in Postiz keep their time and the rest keep clear of them, past
 *  midnight only if a very late day needs it. Only the videos whose time is
 *  not locked are in the answer. */
export function spreadDay(
  members: SpreadMember[],
  { start, end, now, leadMs, minGapMs }: { start: number; end: number; firstAtStart?: boolean; now: number; leadMs: number; minGapMs: number },
): Map<string, number> {
  const unlocked = members.filter((m) => !m.locked)
  const out = new Map<string, number>()
  if (unlocked.length === 0) return out
  const floor = now + leadMs
  // The span is fixed by the day, not by the clock, so the draws stay put
  // as the evening goes on.
  const span = Math.max(0, end - start)
  const wanted = unlocked
    .map((m) => ({ id: m.id, at: Math.max(floor, Math.round(start + shareOf(m.id) * span)) }))
    .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))
  const fixed = members.filter((m) => m.locked && m.at !== null).map((m) => m.at!).sort((a, b) => a - b)
  const placed: number[] = []
  for (const w of wanted) {
    let at = w.at
    // Clear of everything already placed and every locked time - moving on
    // until it is.
    for (let moved = true; moved; ) {
      moved = false
      for (const other of [...fixed, ...placed]) {
        if (Math.abs(at - other) < minGapMs) {
          at = other + minGapMs
          moved = true
        }
      }
    }
    placed.push(at)
    out.set(w.id, at)
  }
  return out
}
