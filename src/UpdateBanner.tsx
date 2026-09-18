import { useEffect, useState } from 'react'
import { registerSW } from 'virtual:pwa-register'

/** Offers a new version rather than taking one.
 *
 *  The planner auto-updated, which meant its service worker could reload the
 *  page whenever a deploy landed - including in the middle of cutting a
 *  queue of videos, which is one of the ways videos went missing. So this
 *  one never reloads on its own. But a worker that never updates is worse
 *  again: without something to accept the new version, the app stays on
 *  whatever build it first cached, forever, and no fix ever reaches the
 *  phone. This is that something. */
export function UpdateBanner() {
  const [ready, setReady] = useState(false)
  const [update, setUpdate] = useState<(() => Promise<void>) | null>(null)

  useEffect(() => {
    const updateSW = registerSW({
      immediate: true,
      onNeedRefresh() {
        setUpdate(() => () => updateSW(true))
        setReady(true)
      },
    })
  }, [])

  if (!ready) return null

  return (
    <div className="notice">
      <span>A new version is ready. It will not interrupt anything that is still cutting.</span>
      <button type="button" className="linkbtn" onClick={() => void update?.()}>
        Update now
      </button>
    </div>
  )
}
