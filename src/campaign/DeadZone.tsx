// The dead zone shown on a video while something is moved on it (his ask,
// 2026-11-23: "show him the dead zone and tell him to respect the dead zone
// for the caption, for everything"): striped where TikTok and Instagram
// Reels put their own tabs, caption and buttons (overlay.TIKTOK_ZONES).
// Whatever is dragged in stops at its edge - the layouts keep it out
// (overlay.keepSafe) - so this shows why.

import { TIKTOK_ZONES } from './overlay'

const pct = (n: number) => `${Math.round(n * 1000) / 10}%`

export function DeadZone({ label = true }: { label?: boolean }) {
  const { top, bottom, right, rightFrom, side } = TIKTOK_ZONES
  return (
    <div className="dead-zone" aria-hidden="true">
      <span className="dz-band" style={{ top: 0, left: 0, right: 0, height: pct(top) }}>
        {label ? <span className="dz-label">App tabs - nothing here</span> : null}
      </span>
      <span className="dz-band" style={{ bottom: 0, left: 0, right: 0, height: pct(bottom) }}>
        {label ? <span className="dz-label">Caption, name, sound - nothing here</span> : null}
      </span>
      <span className="dz-band" style={{ top: pct(top), bottom: pct(bottom), left: 0, width: pct(side) }} />
      <span className="dz-band" style={{ top: pct(top), height: pct(rightFrom - top), right: 0, width: pct(side) }} />
      <span className="dz-band" style={{ top: pct(rightFrom), bottom: pct(bottom), right: 0, width: pct(right) }} />
    </div>
  )
}
