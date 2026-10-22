// Random posting times inside a window, for a campaign with no times of its
// own.
//
// With no times, every video used to post the moment it was ready. A window
// - "between 10:00 and 22:00, 2 a day" - gives each day its own random times
// inside it instead, half an hour apart or more while they fit (closer when
// he wants more a day than that). The same campaign and date always give the
// same times, so a time is still a slot ("2026-10-09 14:37") that holds one
// video, exactly like one of his own times: everything that keeps two videos
// off one slot works unchanged.
//
// A window is his: it is used as he set it, all of it. One that ends at or
// before its start runs past midnight - 1 AM to 1 AM is the whole day.
//
// No imports: the posting function runs it on Deno, the phone's Batch tab and
// New post read it to show the same times, and the tests run it under Vitest.

export interface PostingWindow {
  /** "HH:MM", start of the window. */
  from: string
  /** "HH:MM", end of the window - later than `from`. */
  to: string
  /** How many times each day gets. */
  perDay: number
}

/** Times are this far apart while that many fit in the window. */
export const WINDOW_GAP_MINUTES = 30
/** The closest two times get when he wants more a day than fit half an hour
 *  apart - 125 a day on one account (his aim) is 11 minutes in a whole day.
 *  A time is a minute, so this is no limit at all. */
export const LEAST_GAP_MINUTES = 1
/** Every post also lands 0-9 minutes after its time (slots.ts jitterMinutes),
 *  so the last time is drawn this far before the window's end. */
const JITTER_ROOM = 10
export const MAX_PER_DAY = 12
const DAY_MINUTES = 24 * 60

/** What a campaign with neither its own times nor a window of its own posts
 *  by: the middle of the day, when posts do best. */
export const DEFAULT_WINDOW: PostingWindow = { from: '11:00', to: '18:00', perDay: 3 }

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

function minutesOf(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

/** How long a window is, in minutes. One that ends at or before its start
 *  runs past midnight: 10 PM to 2 AM is 4 hours, 1 AM to 1 AM the whole day. */
export function lengthOf(window: Pick<PostingWindow, 'from' | 'to'>): number {
  const length = (minutesOf(window.to) - minutesOf(window.from) + DAY_MINUTES) % DAY_MINUTES
  return length === 0 ? DAY_MINUTES : length
}

/** Whether a window runs past midnight (lengthOf). */
export function pastMidnight(window: Pick<PostingWindow, 'from' | 'to'>): boolean {
  return minutesOf(window.to) <= minutesOf(window.from)
}

/** A window that can be used, or null. */
export function cleanWindow(value: unknown): PostingWindow | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  const from = typeof v.from === 'string' ? v.from.trim() : ''
  const to = typeof v.to === 'string' ? v.to.trim() : ''
  const perDay = Number(v.perDay)
  if (!HHMM.test(from) || !HHMM.test(to)) return null
  if (lengthOf({ from, to }) <= JITTER_ROOM) return null
  if (!Number.isInteger(perDay) || perDay < 1 || perDay > MAX_PER_DAY) return null
  return { from, to, perDay }
}

/** The minutes a window's times are drawn over: up to JITTER_ROOM before
 *  its end. */
export function spanOf(window: PostingWindow): number {
  return lengthOf(window) - JITTER_ROOM
}

/** How many times the window really fits `gap` apart: fewer than asked when
 *  it is too short for that many. */
export function fits(window: PostingWindow, gap = WINDOW_GAP_MINUTES): number {
  const span = spanOf(window)
  return Math.max(1, Math.min(window.perDay, Math.floor(span / gap) + 1))
}

/** The gap that fits `count` times in the window: half an hour when there
 *  is room, closer when he wants more than that allows (25 a day in 10 AM -
 *  10 PM is 29 minutes, 125 in the whole day 11), never under `least` - past
 *  that the window simply holds fewer. */
export function gapFor(window: PostingWindow, count: number, least = LEAST_GAP_MINUTES): number {
  if (count <= 1) return WINDOW_GAP_MINUTES
  const span = spanOf(window)
  return Math.max(least, Math.min(WINDOW_GAP_MINUTES, Math.floor(span / (count - 1))))
}

/** A small seeded generator: the same seed, the same numbers. */
function seeded(seed: string): () => number {
  let hash = 2166136261
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  let state = hash >>> 0
  return () => {
    // mulberry32
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** The day's times, in order. `key` is the campaign's id, so two campaigns
 *  with the same window still post at different times. Half an hour apart
 *  while as many as it asks for fit, closer when they don't (gapFor). In a
 *  window past midnight, the times after midnight are that date's early
 *  ones. */
export function windowTimes(window: PostingWindow, key: string, date: string, gap = gapFor(window, window.perDay)): string[] {
  const n = fits(window, gap)
  const start = minutesOf(window.from)
  const span = spanOf(window)
  // n points in the slack left after the gaps, then each pushed along by
  // the gaps before it: random, and never closer than the gap.
  const slack = span - (n - 1) * gap
  const random = seeded(`${key}|${date}`)
  const offsets = Array.from({ length: n }, () => Math.floor(random() * (slack + 1))).sort((a, b) => a - b)
  return offsets.map((offset, i) => hhmm((start + offset + i * gap) % DAY_MINUTES)).sort()
}
