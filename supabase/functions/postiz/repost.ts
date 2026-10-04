// Auto-repost and per-platform captions: the small pure parts, kept apart from
// the function so they can be tested. Plain TypeScript, no imports.

/** A campaign's opt-in to reposting a video that went out: after `afterDays`
 *  the same video is made into a new post with a different caption. Off
 *  unless he turned it on for the campaign. */
export interface RepostRule {
  on: boolean
  afterDays: number
}

export const NO_REPOST: RepostRule = { on: false, afterDays: 7 }

export function cleanRepost(value: unknown): RepostRule {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const days = Number(v.afterDays)
  return {
    on: v.on === true,
    afterDays: Number.isInteger(days) && days >= 1 && days <= 90 ? days : NO_REPOST.afterDays,
  }
}

/** When a video posted at `postedAt` is due its repost; null when the
 *  campaign has not opted in. */
export function repostDueAt(postedAt: number, rule: RepostRule | undefined): number | null {
  if (!rule?.on) return null
  return postedAt + rule.afterDays * 24 * 60 * 60 * 1000
}

/** What one account gets under a post: its own caption/title when he wrote
 *  them for it, else the post's. Platforms without an override are unchanged. */
export type AccountText = { caption?: string; title?: string }

export function textFor(
  post: { caption: string | null; title: string | null; captions: Record<string, AccountText> | null },
  accountId: string,
): { caption: string | null; title: string | null } {
  const own = post.captions?.[accountId]
  return {
    caption: own?.caption?.trim() ? own.caption : post.caption,
    title: own?.title?.trim() ? own.title : post.title,
  }
}

/** His per-account texts as sent from the phone: only string captions/titles,
 *  trimmed to sane lengths, account ids kept to a safe shape. An empty map
 *  clears them. `finish` applies the campaign's caption rules (hashtags). */
export function cleanCaptions(value: unknown, finish: (caption: string) => string): Record<string, AccountText> {
  const out: Record<string, AccountText> = {}
  if (!value || typeof value !== 'object') return out
  for (const [id, raw] of Object.entries(value as Record<string, unknown>).slice(0, 30)) {
    if (!/^[\w-]{1,100}$/.test(id) || !raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const entry: AccountText = {}
    if (typeof r.caption === 'string' && r.caption.trim()) entry.caption = finish(r.caption.slice(0, 5000))
    if (typeof r.title === 'string' && r.title.trim()) entry.title = r.title.slice(0, 100)
    if (entry.caption || entry.title) out[id] = entry
  }
  return out
}

/** Added to the caption request for a repost, so it reads as a different
 *  post and not the same words again. */
export function variationNote(previous: string | null): string {
  if (!previous?.trim()) return ''
  return `\n\nThis video is being reposted. It went out before with this caption:\n"""\n${previous.slice(0, 2000)}\n"""\nWrite a clearly different caption: a different opening and different wording, the same facts, and every rule above still applies.`
}

/** What a post made again from an earlier one keeps: the caption he already
 *  read and fixed, the title, and any per-account captions - so a video with
 *  music added is not rewritten by Claude or asked for again. `finish` applies
 *  the campaign's caption rules (hashtags). */
export function carryOver(
  value: unknown,
  finish: (caption: string) => string,
): { caption: string | null; title: string | null; captions: Record<string, AccountText> | null } | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  const caption = typeof v.caption === 'string' && v.caption.trim() ? finish(v.caption.slice(0, 5000)) : null
  const title = typeof v.title === 'string' && v.title.trim() ? v.title.slice(0, 100) : null
  const captions = cleanCaptions(v.captions, finish)
  const any = caption !== null || title !== null || Object.keys(captions).length > 0
  return any ? { caption, title, captions: Object.keys(captions).length > 0 ? captions : null } : null
}
