// How each account's videos are doing, for the Cutter's Analytics tab and its
// "ready for more a day?" suggestions.
//
// Postiz reads views from the platforms (TikTok, Instagram, YouTube...), one
// account per question. Its public API counts every question against the
// same hourly allowance the posting uses, so views are read slowly in the
// background - one account per tick, each about once a day (stalest) - never
// in a burst that could make a post wait.
//
// What each platform gives back differs, so it is brought to one number that
// can be compared over time: views per video lately.
// - TikTok: the total views of its last 20 videos, and how many videos it
//   has - views per video is the one over the other (at most 20).
// - Everything else (Instagram, YouTube...): views over the last week, over
//   the videos the Cutter posted there in that week.
// One reading a day per account is kept, for 60 days, so the trend can be
// seen: this week against the one before.
//
// Kept in cutter_config (`views:<profile id>`, JSON) - read by the server
// only, like everything else there.

export const VIEWS_WINDOW_DAYS = 7
/** An account is read again once its last reading is this old. */
export const REFRESH_HOURS = 20
/** After Postiz couldn't read an account, it is tried again this much later. */
export const RETRY_HOURS = 6
export const KEEP_DAYS = 60
/** TikTok's numbers cover its most recent videos, this many at most. */
const TIKTOK_RECENT = 20

/** One of the numbers Postiz gives for an account, day by day or as one total. */
export interface PostizMetric {
  label?: unknown
  data?: { total?: unknown; date?: unknown }[]
}

export interface Reading {
  views: number | null
  followers: number | null
  /** Views per video lately - the number the trend and suggestions go by. */
  perVideo: number | null
}

export interface AccountViews extends Reading {
  /** When these numbers were read. */
  at: string
  /** When it is next due to be read. */
  next: string
  /** One reading a day, oldest first. */
  history: { date: string; perVideo: number }[]
  /** Why the last try didn't work, until one does. */
  error?: string
}

export interface ViewsCache {
  accounts: Record<string, AccountViews>
}

const num = (value: unknown): number | null => {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  return Number.isFinite(n) ? n : null
}

/** The metric with one of these labels, any case. */
function metric(metrics: readonly PostizMetric[], ...labels: string[]): PostizMetric | undefined {
  const wanted = labels.map((l) => l.toLowerCase())
  return metrics.find((m) => typeof m.label === 'string' && wanted.includes(m.label.trim().toLowerCase()))
}

/** All of a metric's days added up - one total, or a week of days. */
function sum(m: PostizMetric | undefined): number | null {
  const values = (m?.data ?? []).map((d) => num(d.total)).filter((n): n is number => n !== null)
  return values.length > 0 ? values.reduce((a, b) => a + b, 0) : null
}

/** A metric's latest value (followers: the last day's count, not a sum). */
function latest(m: PostizMetric | undefined): number | null {
  const days = (m?.data ?? []).filter((d) => num(d.total) !== null)
  if (days.length === 0) return null
  const sorted = [...days].sort((a, b) => String(a.date ?? '').localeCompare(String(b.date ?? '')))
  return num(sorted[sorted.length - 1].total)
}

/** Postiz's numbers for one account as views per video lately. `posted` is
 *  how many videos the Cutter posted there in the last VIEWS_WINDOW_DAYS. */
export function readViews(platform: string, metrics: unknown, posted: number): Reading {
  const list = Array.isArray(metrics) ? (metrics as PostizMetric[]) : []
  const views = sum(metric(list, 'Views', 'Video Views', 'Media views'))
  const followers = latest(metric(list, 'Followers', 'Follower Count', 'Subscribers'))
  let perVideo: number | null = null
  if (views !== null) {
    if (platform.startsWith('tiktok')) {
      const videos = latest(metric(list, 'Videos'))
      const counted = videos === null ? TIKTOK_RECENT : Math.min(TIKTOK_RECENT, videos)
      perVideo = counted > 0 ? views / counted : null
    } else if (posted > 0) perVideo = views / posted
  }
  return { views, followers, perVideo: perVideo === null ? null : Math.round(perVideo) }
}

const day = (iso: string) => iso.slice(0, 10)

/** The account's entry after a reading: today's reading replaces any earlier
 *  one of today, and readings older than KEEP_DAYS go. */
export function remember(before: AccountViews | undefined, reading: Reading, now: Date): AccountViews {
  const today = day(now.toISOString())
  const oldest = day(new Date(now.getTime() - KEEP_DAYS * 86_400_000).toISOString())
  const history = (before?.history ?? []).filter((h) => h.date !== today && h.date >= oldest)
  if (reading.perVideo !== null) history.push({ date: today, perVideo: reading.perVideo })
  return { ...reading, at: now.toISOString(), next: new Date(now.getTime() + REFRESH_HOURS * 3_600_000).toISOString(), history }
}

/** A try that failed: the last good numbers stay, with why, and it waits
 *  RETRY_HOURS before the next try. */
export function notRead(before: AccountViews | undefined, error: string, now: Date): AccountViews {
  return {
    views: before?.views ?? null,
    followers: before?.followers ?? null,
    perVideo: before?.perVideo ?? null,
    history: before?.history ?? [],
    at: before?.at ?? now.toISOString(),
    next: new Date(now.getTime() + RETRY_HOURS * 3_600_000).toISOString(),
    error: error.slice(0, 300),
  }
}

/** When the account is next due to be read: never read is due at once. */
export function dueAt(entry: AccountViews | undefined): number {
  if (!entry) return -Infinity
  const next = Date.parse(entry.next)
  return Number.isFinite(next) ? next : -Infinity
}

/** The cache as saved, or empty - never trusting its shape. */
export function parseCache(text: string | null | undefined): ViewsCache {
  try {
    const parsed = JSON.parse(text ?? '') as ViewsCache
    return parsed && typeof parsed.accounts === 'object' && parsed.accounts ? parsed : { accounts: {} }
  } catch {
    return { accounts: {} }
  }
}
