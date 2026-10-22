// Where he moved a headline in the edit screen. Each video keeps its own
// (job.day.headlinePlace), and the next videos of the same angle start where
// he put the last one - moved once, it stays there until he moves it again or
// puts it back - so a headline he likes higher up is not dragged up on every
// video. Kept on this phone only: the angle itself is never changed.

import { HEADLINE_SCALE, type HeadlinePlace } from './look'

const KEY = 'campaign.headlinePlace.'

/** A place read back from storage or a gesture, or null when it isn't one. */
export function cleanPlace(value: unknown): HeadlinePlace | null {
  if (!value || typeof value !== 'object') return null
  const { x, y, scale } = value as Record<string, unknown>
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return null
  const s = typeof scale === 'number' && Number.isFinite(scale) ? scale : 1
  const clamp = (n: number) => Math.min(1, Math.max(0, n))
  return { x: clamp(x), y: clamp(y), scale: Math.min(HEADLINE_SCALE.max, Math.max(HEADLINE_SCALE.min, s)) }
}

/** Where the last headline of this angle was moved to, or null. */
export function rememberedPlace(angleId: string): HeadlinePlace | null {
  try {
    const raw = localStorage.getItem(KEY + angleId)
    return raw ? cleanPlace(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

/** Keeps where he moved this angle's headline; null forgets it. */
export function rememberPlace(angleId: string, place: HeadlinePlace | null): void {
  try {
    if (place) localStorage.setItem(KEY + angleId, JSON.stringify(place))
    else localStorage.removeItem(KEY + angleId)
  } catch {
    // Only the next video starts in the angle's spot.
  }
}

/** Where a video's headline goes: where he put it on this video, else where
 *  he last put one of its angle's, else (null) the angle's own spot. */
export function headlinePlaceOf(day: { headlinePlace?: HeadlinePlace | null } | undefined, angleId: string): HeadlinePlace | null {
  if (day?.headlinePlace !== undefined) return day.headlinePlace
  return rememberedPlace(angleId)
}
