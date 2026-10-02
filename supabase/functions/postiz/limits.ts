// Pausing a platform, and capping how many it gets in a day.
//
// Each platform - and, finer than that, each account - can be paused, and can
// have a most-posts-per-day. They are independent: pausing TikTok never slows
// Instagram, and a cap on one account does not touch its siblings.
//
// Nothing is dropped. A post is one video going to several accounts at one
// time; an account that is paused or full simply does not go in that group and
// is marked `held` on the post, with why. The video's other accounts go out as
// planned. When the account is let go again (unpaused, or a day with room), the
// held account gets its own scheduled post later, from the same video and
// caption - so a pause only delays, and resuming loses nothing.
//
// Limits live in the profile's settings (no table of their own):
//   settings.limits = {
//     platforms: { tiktok: { paused?: true, perDay?: 3 } },
//     accounts:  { "<account id>": { paused?: true, perDay?: 1 } },
//   }
//
// Plain TypeScript with no imports, for Deno and for the unit tests.

export interface Limit {
  paused?: boolean
  perDay?: number
}

export interface Limits {
  platforms?: Record<string, Limit>
  accounts?: Record<string, Limit>
}

export type HeldReason = 'paused' | 'cap'

export interface PostAccount {
  id: string
  name: string
  platform: string
  /** Not scheduled yet, and why. Absent: it goes with the video. */
  held?: HeldReason
}

/** What applies to one account: paused if either it or its platform is, and
 *  the smaller of the two caps. A cap of 0 is a pause by another name. */
export function ruleFor(limits: Limits | undefined, account: { id: string; platform: string }): { paused: boolean; cap: number | null } {
  const byPlatform = limits?.platforms?.[account.platform]
  const byAccount = limits?.accounts?.[account.id]
  const caps = [byPlatform?.perDay, byAccount?.perDay].filter((n): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0)
  const cap = caps.length > 0 ? Math.min(...caps) : null
  return { paused: Boolean(byPlatform?.paused || byAccount?.paused) || cap === 0, cap }
}

export interface Split {
  send: PostAccount[]
  held: PostAccount[]
}

/** Which of a video's accounts go on `used` - how many each already has that
 *  day - and which are held. Accounts take their place in order, so two
 *  videos asking for the last place in a day are decided one after the other,
 *  never both let through. */
export function split(accounts: readonly PostAccount[], limits: Limits | undefined, used: Readonly<Record<string, number>>): Split {
  const send: PostAccount[] = []
  const held: PostAccount[] = []
  for (const account of accounts) {
    const { held: _was, ...bare } = account
    void _was
    const { paused, cap } = ruleFor(limits, account)
    if (paused) held.push({ ...bare, held: 'paused' })
    else if (cap !== null && (used[account.id] ?? 0) >= cap) held.push({ ...bare, held: 'cap' })
    else send.push(bare as PostAccount)
  }
  return { send, held }
}

/** How many posts each account has on a day, from posts that have one: a
 *  scheduled or posted video counts for each account it actually goes to
 *  (a held account does not count - it has not been given a place). */
export function usedOn(
  posts: readonly { post_at: string | null; status: string; accounts: readonly PostAccount[] }[],
  date: string,
  dateOf: (iso: string) => string,
): Record<string, number> {
  const used: Record<string, number> = {}
  for (const post of posts) {
    if (!post.post_at || (post.status !== 'scheduled' && post.status !== 'posted')) continue
    if (dateOf(post.post_at) !== date) continue
    for (const account of post.accounts) if (!account.held) used[account.id] = (used[account.id] ?? 0) + 1
  }
  return used
}

/** The accounts of a post that were held and could go now: not paused. Whether
 *  there is room is decided day by day (see firstDayWithRoom). */
export function releasable(accounts: readonly PostAccount[], limits: Limits | undefined): PostAccount[] {
  return accounts.filter((a) => a.held && !ruleFor(limits, a).paused)
}

/** The first of the next `days` days (starting at `from`) on which the account
 *  has room, or null. `usedFor(date)` says how many it already has that day. */
export function firstDayWithRoom(
  account: { id: string; platform: string },
  limits: Limits | undefined,
  from: string,
  addDays: (date: string, n: number) => string,
  usedFor: (date: string, accountId: string) => number,
  days = 7,
): string | null {
  const { paused, cap } = ruleFor(limits, account)
  if (paused) return null
  for (let n = 0; n < days; n++) {
    const date = addDays(from, n)
    if (cap === null || usedFor(date, account.id) < cap) return date
  }
  return null
}

/** "TikTok is paused" / "TikTok is full today" - for the post's own note. */
export function heldNote(held: readonly PostAccount[]): string | null {
  if (held.length === 0) return null
  const paused = held.filter((a) => a.held === 'paused').map((a) => a.name)
  const full = held.filter((a) => a.held === 'cap').map((a) => a.name)
  const parts: string[] = []
  if (paused.length > 0) parts.push(`${paused.join(', ')} ${paused.length === 1 ? 'is' : 'are'} paused`)
  if (full.length > 0) parts.push(`${full.join(', ')} ${full.length === 1 ? 'has' : 'have'} reached today's limit`)
  return `Held back: ${parts.join('; ')}. ${held.length === 1 ? 'It goes out by itself once it is free.' : 'They go out by themselves once they are free.'}`
}

/** Cleans what a phone sent: only known shapes, whole numbers, bounded. */
export function cleanLimits(value: unknown): Limits {
  const out: Limits = {}
  const one = (v: unknown): Limit | null => {
    if (!v || typeof v !== 'object') return null
    const raw = v as Record<string, unknown>
    const limit: Limit = {}
    if (raw.paused === true) limit.paused = true
    if (typeof raw.perDay === 'number' && Number.isInteger(raw.perDay) && raw.perDay >= 0 && raw.perDay <= 50) limit.perDay = raw.perDay
    return limit.paused || limit.perDay !== undefined ? limit : null
  }
  const group = (v: unknown): Record<string, Limit> | undefined => {
    if (!v || typeof v !== 'object') return undefined
    const result: Record<string, Limit> = {}
    for (const [key, entry] of Object.entries(v as Record<string, unknown>).slice(0, 100)) {
      const limit = key.length <= 200 ? one(entry) : null
      if (limit) result[key] = limit
    }
    return Object.keys(result).length > 0 ? result : undefined
  }
  const raw = (value ?? {}) as Record<string, unknown>
  const platforms = group(raw.platforms)
  const accounts = group(raw.accounts)
  if (platforms) out.platforms = platforms
  if (accounts) out.accounts = accounts
  return out
}
