import { useEffect, useState } from 'react'
import { registerSW } from 'virtual:pwa-register'

import { pickQuiet } from './pickWatch'

/** Gets a new version onto the phone without ever pulling the page out from
 *  under a cut.
 *
 *  A new version downloads and then waits; the page lets it in itself, at a
 *  moment of its own choosing (reloadIntoUpdate). It used to take over the
 *  moment it downloaded (`skipWaiting`), which deleted the old version's
 *  files from the cache under a page still cutting - its speech worker was
 *  then fetched from a deploy that no longer existed, and the queue died at
 *  the next video. Waiting for every copy of the old page to close is no
 *  good either: iOS never really closes a bookmarked web app, it only freezes
 *  it, so on the first build ever deployed the new version waited for ever.
 *  So: the page asks for it, and the page is always a version that knows to.
 *
 *  What this component decides is only when the page swaps over. If
 *  everything on screen is also safe on disk - nothing cutting, and no
 *  finished video that exists only in this tab's memory - it reloads straight
 *  away. Otherwise it says a new version is ready and waits to be asked. It
 *  never reloads on its own while there is something to lose; a reload
 *  mid-cut is how the planner version lost videos. */
/** Whether a page may swap to a new version by itself: only when everything
 *  on it is also safe on disk. A held or failed video is, and so is one
 *  sorted and waiting for approval - its plan, captions and cuts are written
 *  as they change - unless he is in the middle of checking it, which lives
 *  in this tab until he is done. A queued one may still be being copied, and
 *  a running or finished one lives only in this tab's memory. One rule, used
 *  by both pages. */
export function safeToReloadWith(jobs: { status: string }[], checking = false): boolean {
  return jobs.every((job) => job.status === 'held' || job.status === 'failed' || (job.status === 'sorted' && !checking))
}

/** Fired on window once a new version has downloaded and is waiting for the page to load it. */
export const UPDATE_READY_EVENT = 'cutter:update-ready'
let downloaded = false
/** A new version has downloaded: the page loads it on its next reload. */
export function updateDownloaded(): boolean {
  return downloaded
}

/** Tells the waiting version to take over (set by registerSW below). */
let letUpdateIn: ((reload?: boolean) => Promise<void>) | null = null

/** Reloads the page - into the new version when one is waiting: the waiting
 *  worker is told to take over and the page reloads as it does. A plain
 *  reload would come back on the old version with the new one still waiting.
 *  If the worker never answers, the page reloads anyway after a moment. */
export function reloadIntoUpdate(): void {
  if (!downloaded || !letUpdateIn) {
    window.location.reload()
    return
  }
  window.setTimeout(() => window.location.reload(), 4000)
  void letUpdateIn(true)
}

export function UpdateBanner({ safeToReload, handled = false }: { safeToReload: boolean; handled?: boolean }) {
  const [ready, setReadyState] = useState(false)
  const setReady = (on: boolean) => {
    if (on && !downloaded) {
      downloaded = true
      window.dispatchEvent(new Event(UPDATE_READY_EVENT))
    }
    setReadyState(on)
  }

  useEffect(() => {
    const sw = 'serviceWorker' in navigator ? navigator.serviceWorker : null
    let registration: ServiceWorkerRegistration | undefined

    letUpdateIn = registerSW({
      immediate: true,
      onRegisteredSW(_url, r) {
        registration = r
      },
      // A new version downloaded and waiting: said, not loaded.
      onNeedRefresh: () => setReady(true),
      // The waiting version took over (reloadIntoUpdate asked it to): now the
      // page loads it.
      onNeedReload: () => window.location.reload(),
    })

    // A first install also changes the controller, and that is not an update.
    const hadController = Boolean(sw?.controller)
    const onControllerChange = () => {
      if (hadController) setReady(true)
    }
    sw?.addEventListener('controllerchange', onControllerChange)

    // A web app brought back from the background is resumed, not reopened,
    // so the browser never gets its usual cue to look for a new version.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void registration?.update().catch(() => {})
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      sw?.removeEventListener('controllerchange', onControllerChange)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  // Never while he is picking videos: they only exist once the picker has
  // handed them over and they are saved (see pickWatch.ts).
  useEffect(() => {
    // The page reloads into it by itself, at its own safe moment (the Cutter's
    // batch page: between two videos).
    if (handled || !ready || !safeToReload) return
    let cancelled = false
    void pickQuiet().then(() => {
      if (!cancelled) reloadIntoUpdate()
    })
    return () => {
      cancelled = true
    }
  }, [ready, safeToReload])

  if (handled || !ready || safeToReload) return null

  return (
    <div className="notice">
      <span>New version ready. Updating now clears the finished videos on this page.</span>
      <button type="button" className="linkbtn" onClick={() => reloadIntoUpdate()}>
        Update now
      </button>
    </div>
  )
}
