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
  const sorted = [...posts].sort((a, b) => (a.postAt ?? '\uffff').localeCompare(b.postAt ?? '\uffff'))
  for (const post of sorted) {
    const date = post.postAt ? localDay(post.postAt) : null
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
