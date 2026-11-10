// A post a run made in Postiz before the platform stopped the run - created
// there, not yet saved here - has to be found again by the next run, or the
// same video goes out twice. This says where to look.
//
// Plain TypeScript with no imports, for Deno and the tests.

const MINUTE = 60_000

/** How far Postiz's copy may be from where it is looked for: the date it was
 *  sent with, give or take the clocks. */
export const CREATED_WITHIN_MS = 10 * MINUTE

export interface PostGroup {
  /** Postiz's: 'now' or 'schedule'. */
  type: string
  /** The date the run would send: a scheduled one's time, or this run's "now". */
  date: string
}

/** The date a group goes to Postiz with: a scheduled one at its time; one
 *  sent now dated the moment the run marked it as going in (creating_at),
 *  not the moment the run began - the upload between the two can take
 *  minutes. The next run then knows where to look (createdAround). */
export function sentDate(group: PostGroup, creatingAt: string): string {
  return group.type === 'now' ? creatingAt : group.date
}

/** Where in Postiz a run that stopped half-way would have left this group's
 *  post: a scheduled one at its time; one sent now at that run's creating_at.
 *  Looking around this run's own "now" found nothing - the run before was
 *  minutes ago, past CREATED_WITHIN_MS - and the video was posted again. */
export function createdAround(group: PostGroup, creatingAt: string | null): number {
  const marked = creatingAt ? Date.parse(creatingAt) : NaN
  return group.type === 'now' && !Number.isNaN(marked) ? marked : Date.parse(group.date)
}

/** Whether a post Postiz holds, dated `publishDate`, is the one looked for around `at`. */
export function isCreatedAround(publishDate: string | undefined, at: number): boolean {
  if (!publishDate) return false
  const when = Date.parse(publishDate)
  return !Number.isNaN(when) && Math.abs(when - at) < CREATED_WITHIN_MS
}
