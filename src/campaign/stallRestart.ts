// A video the phone stopped making: the Cutter starts again by itself, once
// per video (CampaignApp's work queue). On an iPhone the phone's video maker,
// once it goes quiet, stays quiet for as long as the page is open - every
// video after it sat at 0% - and a fresh page gets it back.

/** A video that stopped moving for STALL_MS (see `watched`). */
export class StallError extends Error {}

const RESTARTS_KEY = 'cutter.stallRestarts'
/** A restart is remembered this long, so one video never restarts the page twice. */
const RESTART_MEMORY_MS = 6 * 3_600_000

/** Whether a stalled video may restart the page: once each - a second stall
 *  is the video's own, and goes the usual way (another go, the plain cut,
 *  Try again). Remembers that it did. */
export function firstRestartFor(id: string, now = Date.now()): boolean {
  let seen: Record<string, number> = {}
  try {
    seen = JSON.parse(localStorage.getItem(RESTARTS_KEY) ?? '{}') as Record<string, number>
  } catch {
    // Unreadable: as good as none.
  }
  const recent = Object.fromEntries(Object.entries(seen).filter(([, at]) => now - at < RESTART_MEMORY_MS))
  if (recent[id] !== undefined) return false
  try {
    localStorage.setItem(RESTARTS_KEY, JSON.stringify({ ...recent, [id]: now }))
  } catch {
    // Storage blocked: a restart that can't be remembered is not made.
    return false
  }
  return true
}
