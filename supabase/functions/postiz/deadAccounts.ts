// An account whose videos suddenly stopped getting views - most often a
// shadowban - told to him as soon as its numbers say so, his pick
// (2026-11-01). Each video's views are read per account a day, three days and
// a week after it went out (postViews.ts); an account is in trouble when its
// last few days' videos get a small share of what its videos usually get.
//
// Recent: videos RECENT_FROM-RECENT_TO days old (each read at three days).
// Usual: videos USUAL_FROM-USUAL_TO days old (each read at a week - a little
// more than three days gives, which only makes the test gentler).
//
// Plain TypeScript with no imports, for Deno and the tests.

export const RECENT_FROM = 3
export const RECENT_TO = 7
export const USUAL_FROM = 8
export const USUAL_TO = 35
/** Videos needed on each side before anything is said. */
export const RECENT_NEEDED = 4
export const USUAL_NEEDED = 8
/** In trouble: its recent videos' middle number under this share of its usual. */
export const DOWN_SHARE = 0.25
/** An account that usually gets fewer views a video than this is too small to tell. */
export const LEAST_USUAL = 100
/** He is told about the same account again only after this long. */
export const TELL_AGAIN_DAYS = 7

export interface AccountVideo {
  post_at: string | null
  accounts: { id: string; name: string; platform: string }[]
  views: Record<string, number> | null
}

export interface DeadAccount {
  id: string
  name: string
  platform: string
  /** Its recent videos' middle number of views, and its usual. */
  recent: number
  usual: number
  /** How many recent videos that is from. */
  videos: number
}

const median = (list: readonly number[]) => {
  const s = [...list].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/** The accounts in trouble now, worst first. */
export function deadAccounts(videos: readonly AccountVideo[], now: number): DeadAccount[] {
  const day = 86_400_000
  const byAccount = new Map<string, { name: string; platform: string; recent: number[]; usual: number[] }>()
  for (const video of videos) {
    const at = Date.parse(video.post_at ?? '')
    if (!Number.isFinite(at) || !video.views) continue
    const age = (now - at) / day
    const side = age >= RECENT_FROM && age < RECENT_TO ? 'recent' : age >= USUAL_FROM && age <= USUAL_TO ? 'usual' : null
    if (!side) continue
    for (const account of video.accounts ?? []) {
      const views = video.views[account.name]
      if (typeof views !== 'number' || !Number.isFinite(views)) continue
      const entry = byAccount.get(account.id) ?? { name: account.name, platform: account.platform, recent: [], usual: [] }
      entry[side].push(views)
      byAccount.set(account.id, entry)
    }
  }
  const out: DeadAccount[] = []
  for (const [id, a] of byAccount) {
    if (a.recent.length < RECENT_NEEDED || a.usual.length < USUAL_NEEDED) continue
    const usual = median(a.usual)
    const recent = median(a.recent)
    if (usual < LEAST_USUAL || recent >= usual * DOWN_SHARE) continue
    out.push({ id, name: a.name, platform: a.platform, recent: Math.round(recent), usual: Math.round(usual), videos: a.recent.length })
  }
  return out.sort((x, y) => x.recent / x.usual - y.recent / y.usual)
}

/** A platform as he says it. */
export function platformName(platform: string): string {
  if (platform.startsWith('tiktok')) return 'TikTok'
  if (platform.startsWith('instagram')) return 'Instagram'
  if (platform === 'youtube') return 'YouTube'
  if (platform === 'facebook') return 'Facebook'
  return platform.charAt(0).toUpperCase() + platform.slice(1)
}

/** What he is told about one. */
export function deadNote(a: DeadAccount): { title: string; body: string } {
  return {
    title: `${a.name} on ${platformName(a.platform)} may be shadowbanned`,
    body: `Its videos from the last few days get about ${a.recent} views each - it usually gets ${a.usual}. Check the account; you can pause posting to it in Analytics.`,
  }
}
