// A campaign's day, counted the same way by posts being scheduled at the same
// moment. Five videos sent together from New post (or made one after another
// from Videos) used to each find the day empty and all go on it, past the
// campaign's most a day (his ask, 2026-11-04: "never schedule more than 1
// post a day if the setting is 1 post a day").
//
// Plain TypeScript with no imports, for Deno and the tests.

export interface DayRow {
  id: string
  status: string
  created_at: string
}

/** How many of the campaign's posts already hold the day, for `post`: every
 *  one scheduled or posted, and of those still being scheduled ('approved')
 *  only the ones that came before it - so of two at once, the first keeps the
 *  day and the second moves on. */
export function countBefore(rows: readonly DayRow[], post: { id: string; created_at: string }): number {
  return rows.filter((r) => r.status !== 'approved' || r.created_at < post.created_at || (r.created_at === post.created_at && r.id < post.id)).length
}
