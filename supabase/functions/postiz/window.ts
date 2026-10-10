// Random posting times inside a window, for a campaign with no times of its
// own.
//
// With no times, every video used to post the moment it was ready. A window
// - "between 10:00 and 22:00, 2 a day" - gives each day its own random times
// inside it instead, at least half an hour apart. The same campaign and date
// always give the same times, so a time is still a slot ("2026-10-09 14:37")
// that holds one video, exactly like one of his own times: everything that
// keeps two videos off one slot works unchanged.
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

/** Times are at least this far apart. */
export const WINDOW_GAP_MINUTES = 30
/** Every post also lands 0-9 minutes after its time (slots.ts jitterMinutes),
 *  so the last time is drawn this far before the window's end. */
const JITTER_ROOM = 10
export const MAX_PER_DAY = 12

/** What a campaign with neither its own times nor a window of its own posts
 *  by: every campaign posts at random unless he gave it fixed times. */
export const DEFAULT_WINDOW: PostingWindow = { from: '10:00', to: '22:00', perDay: 3 }

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

function minutesOf(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

/** A window that can be used, or null. */
export function cleanWindow(value: unknown): PostingWindow | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  const from = typeof v.from === 'string' ? v.from.trim() : ''
  const to = typeof v.to === 'string' ? v.to.trim() : ''
  const perDay = Number(v.perDay)
  if (!HHMM.test(from) || !HHMM.test(to)) return null
  if (minutesOf(to) - JITTER_ROOM <= minutesOf(from)) return null
  if (!Number.isInteger(perDay) || perDay < 1 || perDay > MAX_PER_DAY) return null
  return { from, to, perDay }
}

/** How many times the window really fits: fewer than asked when it is too
 *  short to keep them half an hour apart. */
export function fits(window: PostingWindow): number {
  const span = minutesOf(window.to) - JITTER_ROOM - minutesOf(window.from)
  return Math.max(1, Math.min(window.perDay, Math.floor(span / WINDOW_GAP_MINUTES) + 1))
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
 *  with the same window still post at different times. */
export function windowTimes(window: PostingWindow, key: string, date: string): string[] {
  const n = fits(window)
  const start = minutesOf(window.from)
  const span = minutesOf(window.to) - JITTER_ROOM - start
  // n points in the slack left after the gaps, then each pushed along by
  // the gaps before it: random, and never closer than the gap.
  const slack = span - (n - 1) * WINDOW_GAP_MINUTES
  const random = seeded(`${key}|${date}`)
  const offsets = Array.from({ length: n }, () => Math.floor(random() * (slack + 1))).sort((a, b) => a - b)
  return offsets.map((offset, i) => hhmm(start + offset + i * WINDOW_GAP_MINUTES))
}
