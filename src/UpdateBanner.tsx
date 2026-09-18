import { useEffect, useState } from 'react'
import { registerSW } from 'virtual:pwa-register'

/** Gets a new version onto the phone without ever pulling the page out from
 *  under a cut.
 *
 *  The service worker takes over as soon as a new version downloads
 *  (`skipWaiting` in vite.config.ts) rather than parking it until every copy
 *  of the old page has closed. Parking is what froze the phone on the first
 *  build ever deployed: iOS never really closes a bookmarked web app, it only
 *  freezes it in the background, so the new version waited forever - and the
 *  button meant to let it in lived inside the version that never arrived.
 *
 *  What this component decides is only when the page itself swaps over. If
 *  everything on screen is also safe on disk - nothing cutting, and no
 *  finished video that exists only in this tab's memory - it reloads straight
 *  away. Otherwise it says a new version is ready and waits to be asked. It
 *  never reloads on its own while there is something to lose; a reload
 *  mid-cut is how the planner version lost videos. */
export function UpdateBanner({ safeToReload }: { safeToReload: boolean }) {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const sw = 'serviceWorker' in navigator ? navigator.serviceWorker : null
    let registration: ServiceWorkerRegistration | undefined

    registerSW({
      immediate: true,
      onRegisteredSW(_url, r) {
        registration = r
      },
      // Replaces the plugin's own reaction, which is to reload unconditionally.
      onNeedReload: () => setReady(true),
      onNeedRefresh: () => setReady(true),
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

  useEffect(() => {
    if (ready && safeToReload) window.location.reload()
  }, [ready, safeToReload])

  if (!ready || safeToReload) return null

  return (
    <div className="notice">
      <span>
        A new version is ready. It loads by itself once nothing is cutting and the finished videos
        have been cleared. Updating now clears them.
      </span>
      <button type="button" className="linkbtn" onClick={() => window.location.reload()}>
        Update now
      </button>
    </div>
  )
}
