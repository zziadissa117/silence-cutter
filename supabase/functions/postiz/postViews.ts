// Each posted video's views, per account, for the planner's views tracker:
// a video counts toward its campaign once any one account it went to reaches
// the campaign's minimum (the planner's campaigns.min_views).
//
// Postiz reads them from the platforms one post at a time
// (GET /analytics/post/:postId), against the same hourly allowance posting
// needs, so a video is read only a few times - a day, three days and a week
// after it went out, when its views have mostly come in - and one video per
// tick. Kept on the post (cutter_posts.views, by account name, and
// views_at); writing them moves updated_at, so the planner's next pass
// (cutter-posted) picks them up.

import type { PostizMetric } from './views.ts'

/** Hours after it went out that a video's views are read. */
export const POST_VIEW_AGES_H = [24, 72, 168] as const
/** Past this, a video is not read any more. */
export const POST_VIEW_MAX_DAYS = 8

const HOUR = 3_600_000

/** Whether a posted video is due a reading: it has passed an age it hasn't
 *  been read since. */
export function postViewsDue(postAt: string, viewsAt: string | null, now: number): boolean {
  const at = Date.parse(postAt)
  if (!Number.isFinite(at)) return false
  const last = viewsAt ? Date.parse(viewsAt) : -Infinity
  return POST_VIEW_AGES_H.some((hours) => {
    const due = at + hours * HOUR
    return now >= due && !(last >= due)
  })
}

const num = (value: unknown): number | null => {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  return Number.isFinite(n) && n >= 0 ? n : null
}

/** What views Postiz gives for one post. Its answer is a list of metrics like
 *  an account's (views first, else plays, else impressions) - each a series
 *  of days, either running totals (the last one) or day by day (added up) -
 *  or an object with a views number. Null when it says nothing usable. */
export function postViewCount(answer: unknown): number | null {
  if (Array.isArray(answer)) {
    const list = answer as PostizMetric[]
    const labelled = (...names: string[]) =>
      list.find((m) => typeof m.label === 'string' && names.includes(m.label.trim().toLowerCase()))
    const m = labelled('views', 'video views', 'video_views', 'plays', 'video plays') ?? labelled('impressions', 'reach')
    const days = (m?.data ?? [])
      .filter((d) => num(d.total) !== null)
      .sort((a, b) => String(a.date ?? '').localeCompare(String(b.date ?? '')))
      .map((d) => num(d.total)!)
    if (days.length === 0) return null
    const running = days.length > 1 && days.every((v, i) => i === 0 || v >= days[i - 1])
    return Math.round(running ? days[days.length - 1] : days.reduce((a, b) => a + b, 0))
  }
  if (answer && typeof answer === 'object') {
    const fields = answer as Record<string, unknown>
    for (const key of ['views', 'viewCount', 'videoViews', 'plays', 'playCount', 'impressions']) {
      const n = num(fields[key])
      if (n !== null) return Math.round(n)
    }
  }
  return null
}

/** Whose views a Postiz post's are: the account it went to (posts are made
 *  with `integration: { id: account.id }`), by its name - the way the
 *  planner knows it. */
export function accountNameFor(accounts: readonly { id: string; name: string }[], integration: string): string {
  return accounts.find((a) => a.id === integration)?.name ?? (accounts.length === 1 ? accounts[0].name : integration)
}
