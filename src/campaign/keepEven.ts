// A batch's days kept evenly spread over the whole day, with nothing for him
// to do (2026-10-26: "it all has to be evenly separated and operated over a
// 24-hour period", "I'm not doing that manually"). New days are made even
// (posting.ts batchTimesOn); what is already scheduled is moved by the
// posting function (respread-batches): once for everything after this
// update, then for any campaign whose coming days have come out uneven - a
// raised number a day stacked onto days already made, say.

import { addDays, todayHere } from './batch'
import { listPosts, respreadBatches, type ServerPost } from './posting'

const DONE_KEY = 'cutter.evenDays'
/** Bumped to move everything again once. */
const DONE_VERSION = '2026-10-26'
const LAST_KEY = 'cutter.evenDays.last'
/** A campaign moved this recently isn't moved again yet. */
const AGAIN_MS = 60 * 60_000

const minutes = (at: Date) => at.getHours() * 60 + at.getMinutes()

/** The campaigns whose coming days (tomorrow on, a week) are uneven: some
 *  videos much closer together than the day's even step, or a hole much
 *  wider - a respread puts every gap within a fifth of the step. */
export function unevenCampaigns(posts: readonly ServerPost[], now = new Date()): string[] {
  const today = todayHere(now)
  const last = addDays(today, 8)
  const days = new Map<string, number[]>()
  for (const post of posts) {
    if (!post.batch || !post.postAt || post.status === 'rejected' || post.status === 'failed' || post.status === 'error') continue
    if (post.batch.date <= today || post.batch.date > last) continue
    const key = `${post.campaignId}|${post.batch.date}`
    days.set(key, [...(days.get(key) ?? []), minutes(new Date(post.postAt))])
  }
  const uneven = new Set<string>()
  for (const [key, times] of days) {
    if (times.length < 3) continue
    times.sort((a, b) => a - b)
    const step = 1440 / times.length
    const gaps = times.slice(1).map((t, i) => t - times[i])
    gaps.push(1440 - times[times.length - 1] + times[0])
    if (Math.max(...gaps) > step * 1.75 || Math.min(...gaps) < step * 0.3) uneven.add(key.split('|')[0])
  }
  return [...uneven]
}

function readLast(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(LAST_KEY) ?? '{}') as Record<string, number>
  } catch {
    return {}
  }
}

let running: Promise<number> | null = null

/** Moves what needs moving; how many videos moved. Never throws: it is tried
 *  again the next time the app opens. */
export function keepEven(now = new Date()): Promise<number> {
  running ??= (async () => {
    try {
      if (localStorage.getItem(DONE_KEY) !== DONE_VERSION) {
        const { moved, left } = await respreadBatches()
        if (left === 0) localStorage.setItem(DONE_KEY, DONE_VERSION)
        return moved
      }
      const last = readLast()
      let moved = 0
      for (const campaignId of unevenCampaigns(await listPosts(true), now)) {
        if (now.getTime() - (last[campaignId] ?? 0) < AGAIN_MS) continue
        last[campaignId] = now.getTime()
        localStorage.setItem(LAST_KEY, JSON.stringify(last))
        moved += (await respreadBatches(campaignId)).moved
      }
      return moved
    } catch {
      return 0
    } finally {
      running = null
    }
  })()
  return running
}
