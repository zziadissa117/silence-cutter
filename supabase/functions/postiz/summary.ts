// The morning summary (his ask, 2026-11-01): one notification a day saying how
// yesterday went - how many went out, which accounts were missed and what is
// being done about each, and every campaign with a most-a-day against it - so
// he knows without opening anything ("I'm not always going to know that I
// lose money").
//
// Plain TypeScript with no imports, for Deno and the tests.

/** When it is sent, his time: once the night's YouTube re-posts are out. */
export const SUMMARY_HOUR = 9

export interface DayPost {
  campaign: string
  status: string
  /** The post's note: "Not posted to X. Posting again ..." and the like. */
  error: string | null
  /** Set when it is to be posted again by itself (retry_at). */
  again: boolean
}

/** The notification: a title with the day's count, and a body - the misses
 *  first, then each campaign with a most a day. Null when nothing was due. */
export function summaryText(posts: readonly DayPost[], most: Readonly<Record<string, number>>): { title: string; body: string } | null {
  const out = posts.filter((p) => p.status === 'posted' || p.status === 'error')
  if (out.length === 0) return null
  const posted = out.filter((p) => p.status === 'posted').length
  const missed = out.filter((p) => p.status === 'error' || (p.error ?? '').startsWith('Not posted to'))
  const lines: string[] = []
  for (const p of missed) {
    const names = (p.error ?? '').match(/^(?:Not posted to|Postiz couldn't publish it to|Buffer couldn't post it to) (.+?)\.(?: |$)/)?.[1] ?? 'an account'
    lines.push(`${p.campaign}: missed ${names}${p.again ? ' - posting again by itself' : ' - Post again in Posts'}`)
  }
  for (const [campaign, n] of Object.entries(most)) {
    const count = out.filter((p) => p.campaign === campaign).length
    if (count > 0) lines.push(`${campaign} ${count}/${n}${count > n ? ' - over the limit' : ''}`)
  }
  const title = `Yesterday: ${posted} posted${missed.length > 0 ? `, ${missed.length} missed` : ''}`
  return { title, body: lines.length > 0 ? lines.slice(0, 8).join(' · ') : 'Everything went out.' }
}
