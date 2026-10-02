// Keeps the phone's screen on while videos are being made. An iPhone stops a
// web page's work the moment the screen locks, and a day's videos take long
// enough for auto-lock to come round - so while anything is working, the
// screen is asked to stay on, and let go of the moment nothing is.

type Sentinel = { release(): Promise<void>; released: boolean }
type WakeLockApi = { request(type: 'screen'): Promise<Sentinel> }

let sentinel: Sentinel | null = null
let wanted = false

async function acquire(): Promise<void> {
  const api = (navigator as Navigator & { wakeLock?: WakeLockApi }).wakeLock
  if (!api || !wanted || (sentinel && !sentinel.released) || document.visibilityState !== 'visible') return
  try {
    sentinel = await api.request('screen')
  } catch {
    // Refused - low battery mode, or an older iOS. The work still runs while
    // the screen happens to be on.
  }
}

// A lock is dropped whenever the page is hidden; take it back on return.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => void acquire())
}

export function keepScreenOn(on: boolean): void {
  wanted = on
  if (on) void acquire()
  else if (sentinel) {
    void sentinel.release().catch(() => {})
    sentinel = null
  }
}

export function canKeepScreenOn(): boolean {
  return 'wakeLock' in navigator
}
