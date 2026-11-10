// One tab works at a time. Two open copies of the same page - or Cut only in
// one tab and Campaign videos in another - both found the same waiting video
// and both set about it: twice the memory, and the one that finished second
// wrote over the first. The lock is held for one video at a time and let go
// the moment it is done, so the other tab picks up the next one.

const WORK_LOCK = 'cutter-work'

/** Runs `work` while holding the shared work lock, or returns 'busy' at once
 *  when another tab holds it. Browsers without locks simply run the work. */
export async function withWorkLock<T>(work: () => Promise<T>): Promise<T | 'busy'> {
  if (typeof navigator === 'undefined' || !navigator.locks) return work()
  return navigator.locks.request(WORK_LOCK, { ifAvailable: true }, async (lock) => (lock ? work() : ('busy' as const)))
}

/** What the page says while another tab has the lock. */
export const BUSY_ELSEWHERE = 'Another Cutter tab is working on the videos. Close it, or wait for it to finish.'
/** How long until the page looks again whether the other tab is done. */
export const BUSY_RECHECK_MS = 10_000
