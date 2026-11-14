// How the Posts screen's long lists stay short: a filter by campaign, and a
// batch (often 25 a day for a week) folded into one row he opens when he
// wants to see inside it.

import type { ServerPost } from './posting'

/** A row of a list: one post, or a batch of two or more folded together. */
export type ListItem = { kind: 'post'; post: ServerPost } | { kind: 'batch'; id: string; posts: ServerPost[] }

/** The posts in the order given, each batch folded into one row where its
 *  first post would be. A batch with only one post left stays a post. */
export function foldBatches(posts: readonly ServerPost[]): ListItem[] {
  const byBatch = new Map<string, ServerPost[]>()
  for (const post of posts) {
    const id = post.batch?.id
    if (id) byBatch.set(id, [...(byBatch.get(id) ?? []), post])
  }
  const items: ListItem[] = []
  const placed = new Set<string>()
  for (const post of posts) {
    const id = post.batch?.id
    const batch = id ? byBatch.get(id)! : []
    if (!id || batch.length < 2) items.push({ kind: 'post', post })
    else if (!placed.has(id)) {
      placed.add(id)
      items.push({ kind: 'batch', id, posts: batch })
    }
  }
  return items
}

/** The posts in the order given, each campaign's folded into one row where
 *  its first would be - however many batches made them (2026-10-29: "I don't
 *  need 10 different Lovable Steve ones ... Just one that shows every single
 *  post that Lovable Steve has scheduled"). Only batch videos with `own`
 *  false: a post of his own is read and approved on its own. One alone stays
 *  a post. */
export function foldCampaigns(posts: readonly ServerPost[], { own = true }: { own?: boolean } = {}): ListItem[] {
  const folds = (post: ServerPost) => own || Boolean(post.batch)
  const byCampaign = new Map<string, ServerPost[]>()
  for (const post of posts) if (folds(post)) byCampaign.set(post.campaignId, [...(byCampaign.get(post.campaignId) ?? []), post])
  const items: ListItem[] = []
  const placed = new Set<string>()
  for (const post of posts) {
    const group = folds(post) ? byCampaign.get(post.campaignId)! : []
    if (group.length < 2) items.push({ kind: 'post', post })
    else if (!placed.has(post.campaignId)) {
      placed.add(post.campaignId)
      items.push({ kind: 'batch', id: `campaign:${post.campaignId}`, posts: group })
    }
  }
  return items
}

/** "YYYY-MM-DD" of a moment on this phone. */
export function localDay(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** The posts by the day they go out, like a calendar: days in order, each
 *  day's posts by time. Ones with no time yet come last. */
export function byDay(posts: readonly ServerPost[]): { date: string | null; posts: ServerPost[] }[] {
  const days = new Map<string | null, ServerPost[]>()
  const sorted = [...posts].sort(byTime)
  for (const post of sorted) {
    const at = goesAt(post)
    const date = at ? localDay(at) : null
    days.set(date, [...(days.get(date) ?? []), post])
  }
  return [...days.entries()].map(([date, list]) => ({ date, posts: list }))
}

/** The campaigns among the posts, with how many each has, biggest first. */
export function campaignsIn(posts: readonly ServerPost[]): { id: string; name: string; count: number }[] {
  const counts = new Map<string, { id: string; name: string; count: number }>()
  for (const post of posts) {
    const entry = counts.get(post.campaignId) ?? { id: post.campaignId, name: post.campaignName, count: 0 }
    entry.count++
    counts.set(post.campaignId, entry)
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

const SHOW_KEY = 'cutter.posts.show'

/** The campaign the Posts screen was last filtered to on this phone. */
export function shownCampaign(): string | null {
  try {
    return localStorage.getItem(SHOW_KEY)
  } catch {
    return null
  }
}

export function rememberShown(id: string | null): void {
  try {
    if (id) localStorage.setItem(SHOW_KEY, id)
    else localStorage.removeItem(SHOW_KEY)
  } catch {
    // A private window: the filter just isn't remembered.
  }
}

/** "Just posted" goes back this far (his ask, 2026-11-11: "things that have
 *  been posted, but only in the past couple hours. I don't need more"). */
export const JUST_POSTED_MS = 3 * 3_600_000
/** A post that didn't go out stays on the screen this long, to post again. */
export const MISSED_MS = 24 * 3_600_000

const timeOf = (p: Pick<ServerPost, 'postAt' | 'createdAt'>) => Date.parse(p.postAt ?? p.createdAt)

/** A post that didn't go out, or not to every account. */
export function missedPost(p: Pick<ServerPost, 'status' | 'error'>): boolean {
  return p.status === 'failed' || p.status === 'error' || (p.status === 'posted' && Boolean(p.error?.startsWith('Not posted to')))
}

/** A post that didn't go out and that the server posts again by itself at
 *  `retryAt` (postiz missedFields): it goes out again, so it is listed with
 *  the rest still to go, at that time. */
export function goingAgain(p: Pick<ServerPost, 'status' | 'error' | 'retryAt'>, now = Date.now()): boolean {
  return missedPost(p) && p.status !== 'failed' && Boolean(p.retryAt) && Date.parse(p.retryAt!) > now - 30 * 60_000
}

/** When a post still to go goes: its time, or for one going again, then. */
export function goesAt(p: Pick<ServerPost, 'status' | 'error' | 'retryAt' | 'postAt'>): string | null {
  return goingAgain(p, 0) ? p.retryAt : p.postAt
}

const byTime = <P extends Pick<ServerPost, 'status' | 'error' | 'retryAt' | 'postAt'>>(a: P, b: P) =>
  (goesAt(a) ?? '\uffff').localeCompare(goesAt(b) ?? '\uffff')

/** The Posts screen, in the order he reads it (his ask, 2026-11-13: "The
 *  videos that have to be at the top are the videos that are up for
 *  approval ... I cannot be scrolling and looking for videos for approval.
 *  ... Then we're going to have the ones that are today, the ones for
 *  Saturday and Sunday"):
 *  - toApprove: everything waiting for him, the soonest first, always on top;
 *  - next: what is set to go out - approved, scheduled, and what didn't go
 *    out and goes again by itself - by its time, for the day blocks;
 *  - justPosted: what went out in the last few hours, newest first;
 *  - missed: what didn't go out in the last day and won't go again by itself
 *    - at the bottom: he is told of each one by a notification, not by a
 *    banner over the screen (his ask, 2026-11-13). Older posts are on Analytics. */
export function postsOrder<P extends Pick<ServerPost, 'status' | 'postAt' | 'createdAt' | 'error' | 'retryAt'>>(
  posts: readonly P[],
  now = Date.now(),
): { toApprove: P[]; next: P[]; missed: P[]; justPosted: P[] } {
  const toApprove = posts.filter((p) => p.status === 'waiting').sort(byTime)
  const next = posts
    .filter((p) => p.status === 'approved' || p.status === 'scheduled' || goingAgain(p, now))
    .sort(byTime)
  const missed = posts
    .filter((p) => missedPost(p) && !goingAgain(p, now) && now - timeOf(p) < MISSED_MS)
    .sort((a, b) => timeOf(b) - timeOf(a))
  const justPosted = posts
    .filter((p) => p.status === 'posted' && !missedPost(p) && p.postAt && now - Date.parse(p.postAt) < JUST_POSTED_MS)
    .sort((a, b) => timeOf(b) - timeOf(a))
  return { toApprove, next, missed, justPosted }
}

/** The accounts a missed post didn't reach: the ones its note names, by
 *  username or name - all of them when the note names none. */
export function missedAccounts<A extends { name: string; profile?: string; platform: string }>(
  post: { accounts: A[]; error: string | null; status: string },
): A[] {
  if (post.status === 'failed') return post.accounts
  const note = (post.error ?? '').replace(/ (Posting again|Still not posted)\b.*$/s, '')
  const handle = (a: A) => (a.profile ?? '').trim().replace(/^@+/, '')
  // The server names an account by its @username when it has one, else by its
  // name - a whole item of the list, so "Kari" isn't found in "Kari YT".
  const item = (text: string) => new RegExp(`(^|[ ,])${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=,|\\.|\\s\\(|$)`).test(note)
  const named = post.accounts.filter((a) => (handle(a) && item(`@${handle(a)}`)) || (Boolean(a.name.trim()) && item(a.name.trim())))
  return named.length > 0 ? named : post.accounts
}
