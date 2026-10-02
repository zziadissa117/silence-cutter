// The app opens on Campaign videos, where he does his work, not on the plain
// cutter at "/" that a Home Screen icon starts on. "Cut only" is one tap
// away, and its link carries #cut so it stays put, and so does a reload of it.
//
// The one exception: a plain-cutter video still waiting to be cut. It only
// picks up again on Cut only, so the app opens there instead of leaving it
// sitting unnoticed behind the other section.

import { loadPendingJobs, MAX_ATTEMPTS } from './media/jobStore'
import { within } from './media/within'

export const CUT_ONLY_HASH = '#cut'

/** Whether "/" should show the plain cutter rather than move on. */
export async function staysOnCutOnly(): Promise<boolean> {
  if (window.location.hash === CUT_ONLY_HASH) return true
  try {
    // A held-back video waits to be asked for by hand, so it doesn't count.
    const pending = await within(loadPendingJobs(), 2000, [])
    return pending.some((job) => job.attempts < MAX_ATTEMPTS)
  } catch {
    return false
  }
}
