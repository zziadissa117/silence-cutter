// The Analytics tab's numbers, and its "ready for more a day?" suggestions.
//
// The server reads each account's views from Postiz about once a day
// (supabase/functions/postiz/views.ts) and keeps one reading a day: views per
// video lately. Here those become a campaign's numbers - its accounts
// together - and how they moved: this week against the week before.
//
// A suggestion is only ever a suggestion: "Go from 3 to 4 a day?", with Yes
// and Not now. It comes when a running batch's videos are doing well - views
// per video up a fifth or more on the week before, or at or above the number
// he set for the campaign - and the other way when they fall away. Each step
// is small (one a day, two once past five), with no most a day, and after he
// answers it leaves the campaign alone for a few days to let the new rate
// show in the views.

/** One account's views as the server last read them. */
export interface AccountViews {
  views: number | null
  followers: number | null
  perVideo: number | null
  at: string
  next: string
  history: { date: string; perVideo: number }[]
  error?: string
}

export type ViewsByAccount = Record<string, AccountViews>

/** Views per video up this share on the week before suggests more a day... */
export const UP_SHARE = 0.2
/** ...and down this share suggests fewer. */
export const DOWN_SHARE = 0.3
/** After he answers a suggestion, the campaign is left alone this long. */
export const QUIET_DAYS = 3

const DAY = 86_400_000
const dayMs = (date: string) => Date.parse(`${date}T12:00:00Z`)

/** How views per video moved: the latest reading against the one closest to
 *  a week before it (5 to 10 days back). Null without one that old. */
export function weekChange(history: readonly { date: string; perVideo: number }[]): number | null {
  if (history.length < 2) return null
  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date))
  const last = sorted[sorted.length - 1]
  const lastAt = dayMs(last.date)
  let before: { date: string; perVideo: number } | null = null
  for (const h of sorted) {
    const back = (lastAt - dayMs(h.date)) / DAY
    if (back < 5 || back > 10) continue
    if (!before || Math.abs(back - 7) < Math.abs((lastAt - dayMs(before.date)) / DAY - 7)) before = h
  }
  if (!before || before.perVideo <= 0) return null
  return last.perVideo / before.perVideo - 1
}

export interface CampaignViews {
  /** Its accounts' latest views per video, averaged; null before any came. */
  perVideo: number | null
  /** How that moved on the week before, as a share (0.35 is up 35%). */
  change: number | null
  /** How many of its accounts have numbers yet, of how many. */
  read: number
  total: number
}

/** A campaign's accounts together: their views per video averaged, day by
 *  day over the accounts read that day, so the trend is the campaign's. */
export function campaignViews(accountIds: readonly string[], views: ViewsByAccount): CampaignViews {
  const entries = accountIds.map((id) => views[id]).filter((v): v is AccountViews => Boolean(v))
  const latest = entries.map((v) => v.perVideo).filter((n): n is number => n !== null)
  const byDay = new Map<string, number[]>()
  for (const v of entries) for (const h of v.history) byDay.set(h.date, [...(byDay.get(h.date) ?? []), h.perVideo])
  const series = [...byDay].map(([date, list]) => ({ date, perVideo: list.reduce((a, b) => a + b, 0) / list.length }))
  return {
    perVideo: latest.length > 0 ? Math.round(latest.reduce((a, b) => a + b, 0) / latest.length) : null,
    change: weekChange(series),
    read: latest.length,
    total: accountIds.length,
  }
}

export interface Suggestion {
  from: number
  to: number
  why: string
}

/** One step up or down from `perDay`: one a day, two once past five. */
export function stepFrom(perDay: number, up: boolean): number {
  const step = (up ? perDay >= 5 : perDay > 5) ? 2 : 1
  return Math.max(1, perDay + (up ? step : -step))
}

const views = (n: number) => `${Math.round(n).toLocaleString('en-US')} view${Math.round(n) === 1 ? '' : 's'}`
const pct = (share: number) => `${Math.round(Math.abs(share) * 100)}%`

/** What to suggest for a running batch at `perDay` a day, from how its
 *  videos are doing and the number he set (`target`, views per video), or
 *  nothing. Up: up a fifth on the week before, or at his number (unless
 *  falling hard). Down: down by almost a third, unless still at his number. */
export function suggestRate({
  perDay,
  running,
  stats,
  target,
  answeredAt,
  now = Date.now(),
}: {
  perDay: number
  running: boolean
  stats: CampaignViews
  target?: number | null
  answeredAt?: number | null
  now?: number
}): Suggestion | null {
  if (!running || perDay < 1 || stats.perVideo === null) return null
  if (answeredAt && now - answeredAt < QUIET_DAYS * DAY) return null
  const { perVideo, change } = stats
  const atTarget = Boolean(target && target > 0 && perVideo >= target)
  const falling = change !== null && change <= -DOWN_SHARE
  // At his number but falling hard: it holds, neither way.
  if ((atTarget && !falling) || (change !== null && change >= UP_SHARE)) {
    const why =
      change !== null && change >= UP_SHARE
        ? `Views per video up ${pct(change)} on last week (${views(perVideo)} a video).`
        : `${views(perVideo)} a video - at or above your ${views(target!)}.`
    return { from: perDay, to: stepFrom(perDay, true), why }
  }
  if (perDay > 1 && falling && !atTarget) {
    return { from: perDay, to: stepFrom(perDay, false), why: `Views per video down ${pct(change!)} on last week (${views(perVideo)} a video).` }
  }
  return null
}

// --- When he last answered, per campaign (this phone) -----------------------

const ANSWERED_KEY = 'analytics.answered'

function answers(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(ANSWERED_KEY) ?? '{}') as Record<string, number>
  } catch {
    return {}
  }
}

export function answeredAt(campaignId: string): number | null {
  return answers()[campaignId] ?? null
}

export function rememberAnswer(campaignId: string, at = Date.now()): void {
  try {
    localStorage.setItem(ANSWERED_KEY, JSON.stringify({ ...answers(), [campaignId]: at }))
  } catch {
    // It may ask again sooner - harmless.
  }
}

/** "1.2K", "35K" - a number short enough for a phone row. */
export function shortNumber(n: number | null): string {
  if (n === null) return '-'
  if (n < 1000) return String(Math.round(n))
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`
  if (n < 1_000_000) return `${Math.round(n / 1000)}K`
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
}
