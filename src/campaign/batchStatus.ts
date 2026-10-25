// What the Batch tab says at the top about a batch (BatchStatus.tsx): is it
// making videos right now, where, and is each of the next days ready. Before
// this the answer was six grey lines under every setting, and with the batch
// on the Cutter server he couldn't tell whether posts were being made at all.

import { addDays, todayHere, type BatchBank } from './batch'
import { AHEAD_DAYS, filledOn, perDayOn } from './batchRun'
import type { Job } from './jobs'
import type { ServerPost } from './posting'

/** One of the next days, for the strip. */
export interface StatusDay {
  date: string
  /** What the batch aims to put out that day. */
  target: number
  /** Videos for it in Posts (made, and not rejected or failed). */
  ready: number
  /** Of those, gone out already. */
  out: number
  /** Ready, or being made / waiting to be made. */
  planned: number
}

const GONE = new Set<ServerPost['status']>(['rejected', 'failed', 'error'])

function batchPosts(posts: readonly ServerPost[], campaignId: string): ServerPost[] {
  return posts.filter((p) => p.campaignId === campaignId && p.batch)
}

/** The next AHEAD_DAYS days, today first. Made on this phone (`jobs`), what
 *  is being made is its own videos still to come - never one that failed,
 *  which the bank's count of the day still holds; on the server, that count
 *  as the server has it. */
export function statusDays(
  bank: Pick<BatchBank, 'campaignId' | 'perDay' | 'growth' | 'growthFrom' | 'filled' | 'madeThrough' | 'lastPerDay'>,
  posts: readonly ServerPost[],
  { jobs, now = new Date() }: { jobs?: readonly Job[]; now?: Date } = {},
): StatusDay[] {
  const today = todayHere(now)
  const mine = batchPosts(posts, bank.campaignId).filter((p) => !GONE.has(p.status))
  const sent = new Set(batchPosts(posts, bank.campaignId).map((p) => p.key))
  const coming = (jobs ?? []).filter(
    (j) => j.campaignId === bank.campaignId && j.batch && !sent.has(j.id) && j.status !== 'failed' && j.status !== 'held',
  )
  return Array.from({ length: AHEAD_DAYS }, (_, i) => {
    const date = addDays(today, i)
    const day = mine.filter((p) => p.batch!.date === date)
    const ready = day.length
    return {
      date,
      target: perDayOn(bank, date),
      ready,
      out: day.filter((p) => p.status === 'posted').length,
      planned: jobs ? ready + coming.filter((j) => j.batch!.date === date).length : Math.max(ready, filledOn(bank, date)),
    }
  })
}

/** When the newest of the batch's videos reached Posts. */
export function lastReadyAt(posts: readonly ServerPost[], campaignId: string): string | null {
  let last: string | null = null
  for (const p of batchPosts(posts, campaignId)) {
    if (p.status === 'failed' || p.status === 'error') continue
    if (!last || Date.parse(p.createdAt) > Date.parse(last)) last = p.createdAt
  }
  return last
}

/** The server checks in every 30 s while it runs: this long without a word, it has stopped. */
export const QUIET_MS = 10 * 60_000

export type StatusTone = 'bad' | 'ok' | 'idle'

export interface BatchState {
  tone: StatusTone
  title: string
  line: string
}

/** The one headline the card leads with. */
export function batchState(input: {
  running: boolean
  perDay: number
  where: 'phone' | 'server' | 'engine'
  /** Something wrong, said in his words (the server out of reach or out of room, a top-up that failed). */
  problem: string | null
  /** A video is being made, or waiting its turn. */
  making: boolean
  /** Its videos that couldn't be made. */
  failed?: number
  /** When the server last checked in (server only). */
  heardAt: string | null
  days: readonly StatusDay[]
  now?: number
}): BatchState {
  const { running, where, days } = input
  const now = input.now ?? Date.now()
  if (input.problem) return { tone: 'bad', title: 'Something is wrong', line: input.problem }
  const quietFor = input.heardAt ? now - Date.parse(input.heardAt) : null
  if (where === 'server' && running && quietFor !== null && quietFor > QUIET_MS) {
    return {
      tone: 'bad',
      title: 'The server went quiet',
      line: `Nothing from it for ${minutes(quietFor)}. Railway starts it again by itself - if this stays, open it on Railway and check it is running.`,
    }
  }
  if (input.making) {
    return {
      tone: 'ok',
      title: 'Making videos',
      line:
        where === 'server'
          ? 'Day and night - you can close the app.'
          : where === 'engine'
            ? 'You can close the app.'
            : 'Keep the app open with the screen on.',
    }
  }
  const failed = input.failed ?? 0
  if (failed > 0) {
    return {
      tone: 'bad',
      title: `${failed} couldn't be made`,
      line:
        where === 'phone'
          ? 'Their days stay short until you tap Try again below, or Start over to make them again.'
          : 'Their days stay short until you tap Start over below - it makes them again.',
    }
  }
  if (running && input.perDay === 0) return { tone: 'idle', title: 'Paused', line: 'At 0 a day nothing more is made until you raise it.' }
  if (running) {
    const short = days.reduce((n, d) => n + Math.max(0, d.target - d.planned), 0)
    if (short === 0) {
      return {
        tone: 'ok',
        title: 'Up to date',
        line: `Every day through ${days.length > 0 ? weekday(days[days.length - 1].date) : 'the week'} is made. Each new day is made by itself${where === 'phone' ? ' when the app is open' : ''}.`,
      }
    }
    return {
      tone: 'idle',
      title: 'About to make more',
      line: `${short} still to make for the next ${days.length} days - it starts by itself${where === 'phone' ? ' while the app is open' : ''}.`,
    }
  }
  return { tone: 'idle', title: 'Stopped', line: 'Nothing new is made. Tap Start below to make the next days.' }
}

function minutes(ms: number): string {
  const m = Math.round(ms / 60_000)
  return m < 120 ? `${m} min` : `${Math.round(m / 60)} hours`
}

/** "Today", "Tomorrow", then "Thu". */
export function weekday(date: string, now = new Date()): string {
  const today = todayHere(now)
  if (date === today) return 'Today'
  if (date === addDays(today, 1)) return 'Tomorrow'
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short' })
}

/** "just now", "12 min ago", "at 3:40 PM". */
export function timeAgo(iso: string, now = Date.now()): string {
  const minutes = Math.round((now - Date.parse(iso)) / 60_000)
  if (!Number.isFinite(minutes)) return 'a while ago'
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  return `at ${new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
}
