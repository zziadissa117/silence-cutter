// An account linked after videos were already made.
//
// A post's accounts are fixed when it is prepared, so an account he links
// afterwards - or ticks on the campaign's Posting later - misses every video
// already waiting, approved or scheduled. This decides, for each such post,
// what adding the new account means:
//
//   add            waiting or approved: it is not at Postiz yet, so the account
//                  just joins its list and goes with the rest when it does.
//   add-scheduled  already scheduled at Postiz, in the future: a post for ONLY
//                  the new account is created at the same time. The accounts
//                  already there are never touched, so nothing posts twice.
//   too-late       already gone out (or about to), or has no caption/video to
//                  copy: a new post would be a different post, so it is left.
//   busy           a run is creating it at Postiz this minute: left, and he is
//                  told, rather than racing it.
//   has-all        already has every one of them.
//
// Plain TypeScript with no imports, for Deno and for the unit tests.

export interface AttachPost {
  id: string
  status: string
  accounts: { id: string }[]
  post_at: string | null
  media: unknown | null
  caption: string | null
  creating_at: string | null
}

export type AttachMove = 'has-all' | 'add' | 'add-scheduled' | 'too-late' | 'busy' | 'not-open'

export interface AttachDecision {
  move: AttachMove
  /** The wanted accounts the post does not have yet. */
  missing: string[]
}

/** How close to its time a scheduled post can still be copied to a new account. */
export const LEAD_MS = 2 * 60_000

export function attachMove(post: AttachPost, wanted: readonly string[], now: number): AttachDecision {
  const have = new Set(post.accounts.map((a) => a.id))
  const missing = wanted.filter((id) => !have.has(id))
  if (missing.length === 0) return { move: 'has-all', missing }

  switch (post.status) {
    case 'waiting':
    case 'approved':
      return { move: post.creating_at ? 'busy' : 'add', missing }
    case 'scheduled': {
      const at = post.post_at ? Date.parse(post.post_at) : NaN
      if (!post.media || !post.caption?.trim() || !Number.isFinite(at) || at < now + LEAD_MS) return { move: 'too-late', missing }
      return { move: post.creating_at ? 'busy' : 'add-scheduled', missing }
    }
    case 'posted':
      return { move: 'too-late', missing }
    default:
      // Still being got ready (it will pick the account up from the campaign's
      // settings when it is prepared), or failed / rejected: nothing to attach.
      return { move: 'not-open', missing }
  }
}

export interface AttachSummary {
  /** Waiting or approved videos that now include the account. */
  added: number
  /** Scheduled videos that got a post for the account at the same time. */
  scheduled: number
  /** Gone out already, or too close to going out, or busy: left alone. */
  left: number
}

export function summarise(moves: readonly AttachMove[]): AttachSummary {
  return {
    added: moves.filter((m) => m === 'add').length,
    scheduled: moves.filter((m) => m === 'add-scheduled').length,
    left: moves.filter((m) => m === 'too-late' || m === 'busy').length,
  }
}
