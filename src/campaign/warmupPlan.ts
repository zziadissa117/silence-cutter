// When each filmed warm-up goes out (his rules, 2026-11-11): on the campaigns
// he turned warm-ups on for, from their categories, so many every 7 days
// (2 to start), evenly apart, at the account's best hour, on top of the
// day's batch videos. A filmed warm-up goes out once, ever; an idea never
// goes on the same campaign twice; the ideas whose warm-ups get the most
// views go first. Planned a week ahead at most: each is sent to the server
// as it is planned, to wait there for his yes (with a notification).

import type { Campaign } from './look'
import type { ServerPost } from './posting'
import type { MadeWarmup } from './warmups'

const DAY = 24 * 3600_000
/** Planned no further than this ahead. */
export const AHEAD_MS = 7 * DAY
/** None closer to now than this: time for him to approve it. */
export const SOONEST_MS = 3 * 3600_000
/** What a warm-up idea is taken to get before any of its own have views. */
export const EXPECTED_VIEWS = 1000

/** The idea a warm-up post was made from, by its key (`warmup:<idea>:<made>`). */
export function ideaOfKey(key: string): string | null {
  const m = /^warmup:([\w-]+):/.exec(key)
  return m ? m[1] : null
}

/** How each idea does: the average views of its warm-ups that have them. */
export function ideaViews(posts: readonly Pick<ServerPost, 'key' | 'views'>[]): Map<string, number> {
  const sums = new Map<string, { total: number; n: number }>()
  for (const post of posts) {
    const idea = ideaOfKey(post.key)
    if (!idea || !post.views) continue
    const views = Object.values(post.views).reduce((a, b) => a + b, 0)
    const s = sums.get(idea) ?? { total: 0, n: 0 }
    sums.set(idea, { total: s.total + views, n: s.n + 1 })
  }
  return new Map([...sums].map(([idea, s]) => [idea, s.total / s.n]))
}

export interface PlannedWarmup {
  made: MadeWarmup
  campaignId: string
  at: Date
}

const GONE = new Set(['rejected', 'failed', 'cancelled'])

/** The warm-ups to send now: for each campaign, the next ones it is due
 *  within a week, each with the best of his filmed warm-ups for it. */
export function planWarmups({
  campaigns,
  made,
  posts,
  bestHour,
  now = new Date(),
}: {
  campaigns: readonly Pick<Campaign, 'id' | 'warmups'>[]
  made: readonly MadeWarmup[]
  posts: readonly Pick<ServerPost, 'key' | 'campaignId' | 'postAt' | 'status' | 'views'>[]
  /** The hour (0-23) a day's warm-up goes at on this campaign: its accounts' best. */
  bestHour: (campaignId: string, date: Date) => number
  now?: Date
}): PlannedWarmup[] {
  const views = ideaViews(posts)
  const score = (m: MadeWarmup) => views.get(m.ideaId) ?? EXPECTED_VIEWS
  const free = made.filter((m) => !m.posted).sort((a, b) => score(b) - score(a) || a.madeAt - b.madeAt)
  const taken = new Set<string>()
  const out: PlannedWarmup[] = []
  for (const campaign of campaigns) {
    const want = campaign.warmups
    if (!want || want.perWeek <= 0) continue
    const mine = posts.filter((p) => p.campaignId === campaign.id && ideaOfKey(p.key) && !GONE.has(p.status))
    const usedIdeas = new Set(mine.map((p) => ideaOfKey(p.key)!))
    const gap = (7 * DAY) / Math.min(14, want.perWeek)
    let last = Math.max(-Infinity, ...mine.map((p) => (p.postAt ? Date.parse(p.postAt) : -Infinity)))
    for (;;) {
      const from = Math.max(now.getTime() + SOONEST_MS, Number.isFinite(last) ? last + gap : now.getTime() + SOONEST_MS)
      const at = atBestHour(from, bestHour(campaign.id, new Date(from)), `${campaign.id}${from}`)
      if (at.getTime() > now.getTime() + AHEAD_MS) break
      const pick = free.find((m) => !taken.has(m.id) && !usedIdeas.has(m.ideaId) && (want.categories.length === 0 || want.categories.includes(m.category)))
      if (!pick) break
      taken.add(pick.id)
      usedIdeas.add(pick.ideaId)
      out.push({ made: pick, campaignId: campaign.id, at })
      last = at.getTime()
    }
  }
  return out
}

/** `from`'s day at `hour` - or the next day's, when that has gone by - a few
 *  minutes past the hour, the same for the same campaign and day. */
export function atBestHour(from: number, hour: number, seed: string): Date {
  let h = 0
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0
  const at = new Date(from)
  at.setHours(hour, 3 + (h % 25), 0, 0)
  if (at.getTime() < from) at.setDate(at.getDate() + 1)
  return at
}

/** The best hour of a day's weights (posting.hoursHere), or 19:00 without any. */
export function bestOf(weights: readonly number[] | undefined): number {
  if (!weights || weights.length !== 24) return 19
  let best = 19
  for (let h = 0; h < 24; h++) if (weights[h] > weights[best]) best = h
  return best
}

/** An extra warm-up for an account that went cold (his yes first): the best
 *  of his filmed ones the campaign hasn't had the idea of, at the next best
 *  hour he still has time to approve it by - whatever the week's spacing. */
export function planExtra({
  campaign,
  made,
  posts,
  bestHour,
  now = new Date(),
}: {
  campaign: Pick<Campaign, 'id' | 'warmups'>
  made: readonly MadeWarmup[]
  posts: readonly Pick<ServerPost, 'key' | 'campaignId' | 'status' | 'views'>[]
  bestHour: (date: Date) => number
  now?: Date
}): PlannedWarmup | null {
  const views = ideaViews(posts)
  const score = (m: MadeWarmup) => views.get(m.ideaId) ?? EXPECTED_VIEWS
  const used = new Set(posts.filter((p) => p.campaignId === campaign.id && !GONE.has(p.status)).flatMap((p) => ideaOfKey(p.key) ?? []))
  const wanted = campaign.warmups?.categories ?? []
  const free = made.filter((m) => !m.posted && !used.has(m.ideaId))
  const best = (list: MadeWarmup[]) => [...list].sort((a, b) => score(b) - score(a) || a.madeAt - b.madeAt)[0]
  // From its own categories, else any: a cold account needs one now.
  const pick = best(free.filter((m) => wanted.length === 0 || wanted.includes(m.category))) ?? best(free) ?? null
  if (!pick) return null
  const from = now.getTime() + SOONEST_MS
  return { made: pick, campaignId: campaign.id, at: atBestHour(from, bestHour(new Date(from)), `${campaign.id}${pick.id}`) }
}

/** An account with nothing posted for this long gets a warm-up. */
export const QUIET_MS = 24 * 3600_000
/** ...unless something is going out on it soon anyway. */
const COMING_MS = 12 * 3600_000

/** The accounts that have gone a day with nothing posted and nothing coming
 *  (his ask, 2026-11-11: "whenever there's a day I maybe sometimes forget to
 *  post on certain campaigns ... a warm-up video ... so it keeps my account
 *  warm"): each with the campaign it posts for, the first that holds it. An
 *  account that has never had a post from the Cutter counts only once it
 *  has been in a campaign a day - so `since` (when it was first seen). */
export function quietAccounts({
  campaigns,
  posts,
  now = new Date(),
  since,
}: {
  /** Each campaign and its accounts. */
  campaigns: readonly { id: string; accounts: readonly string[] }[]
  posts: readonly Pick<ServerPost, 'campaignId' | 'postAt' | 'status' | 'accounts'>[]
  now?: Date
  /** When the Cutter first saw an account in a campaign. */
  since: (accountId: string) => number
}): { campaignId: string; accountId: string }[] {
  const t = now.getTime()
  const busy = new Set<string>()
  for (const p of posts) {
    if (GONE.has(p.status) || !p.postAt) continue
    const at = Date.parse(p.postAt)
    if (!(at > t - QUIET_MS && at < t + COMING_MS)) continue
    for (const a of p.accounts) busy.add(a.id)
  }
  const out: { campaignId: string; accountId: string }[] = []
  const taken = new Set<string>()
  for (const c of campaigns) {
    for (const accountId of c.accounts) {
      if (taken.has(accountId) || busy.has(accountId)) continue
      if (t - since(accountId) < QUIET_MS) continue
      taken.add(accountId)
      out.push({ campaignId: c.id, accountId })
    }
  }
  return out
}
