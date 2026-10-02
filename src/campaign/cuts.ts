// Fixing the cut by hand: splitting a kept part, taking one out, bringing a
// cut-out part back, and trimming a part's edges.
//
// The silence cut sometimes leaves in a pause, a restart or a flubbed line,
// and he used to fix it in another app afterwards. Everything here edits the
// list of kept ranges on the raw video's timeline - the same list the render
// already works from - so the recording itself is never touched, and a
// change can always be undone.

import type { Range } from '../media/silenceMath'

/** The shortest a kept part can be - shorter is a flicker, not a shot. */
export const MIN_PART_SEC = 0.1

/** Which kept part `t` is in, or -1 when it falls in a cut-out gap. */
export function partAt(keep: readonly Range[], t: number): number {
  return keep.findIndex((r) => t >= r.start && t < r.end)
}

/** One kept part becomes two at `t`. Nothing changes when `t` isn't in a
 *  part, or is too close to its edge to leave both halves long enough. */
export function splitAt(keep: readonly Range[], t: number): Range[] {
  const i = partAt(keep, t)
  if (i < 0) return [...keep]
  const { start, end } = keep[i]
  if (t - start < MIN_PART_SEC || end - t < MIN_PART_SEC) return [...keep]
  return [...keep.slice(0, i), { start, end: t }, { start: t, end }, ...keep.slice(i + 1)]
}

/** Takes out the kept part `t` is in. The last part left is never taken:
 *  a video with nothing in it can't be made. */
export function removeAt(keep: readonly Range[], t: number): Range[] {
  const i = partAt(keep, t)
  if (i < 0 || keep.length === 1) return [...keep]
  return [...keep.slice(0, i), ...keep.slice(i + 1)]
}

/** Brings back the cut-out gap `t` is in, joining it to the parts either
 *  side. `duration` bounds a gap at the very start or end. */
export function restoreAt(keep: readonly Range[], t: number, duration: number): Range[] {
  if (t < 0 || t >= duration || partAt(keep, t) >= 0) return [...keep]
  const before = keep.filter((r) => r.end <= t)
  const after = keep.filter((r) => r.start > t)
  const from = before.length > 0 ? before[before.length - 1].start : 0
  const to = after.length > 0 ? after[0].end : duration
  return [...before.slice(0, -1), { start: from, end: to }, ...after.slice(1)]
}

/** Moves one edge of part `i` to `to`, never past its neighbours, the ends
 *  of the video, or so close to its other edge that it is too short. */
export function trimPart(keep: readonly Range[], i: number, edge: 'start' | 'end', to: number, duration: number): Range[] {
  const part = keep[i]
  if (!part) return [...keep]
  const next = [...keep]
  if (edge === 'start') {
    const floor = i > 0 ? keep[i - 1].end : 0
    next[i] = { start: Math.min(Math.max(to, floor), part.end - MIN_PART_SEC), end: part.end }
  } else {
    const ceiling = i < keep.length - 1 ? keep[i + 1].start : duration
    next[i] = { start: part.start, end: Math.max(Math.min(to, ceiling), part.start + MIN_PART_SEC) }
  }
  return next
}

/** `t` moved onto the nearest of `points` within `within` seconds - the edge
 *  of a word, so a trim lands between words, not through one. */
export function snapTo(t: number, points: readonly number[], within = 0.08): number {
  let best = t
  let distance = within
  for (const p of points) {
    const d = Math.abs(p - t)
    if (d <= distance) {
      best = p
      distance = d
    }
  }
  return best
}

/** Where raw moment `t` lands in the finished video, and how long that is -
 *  the timer he sees while editing. A moment in a gap lands where the next
 *  part starts. */
export function outputTime(keep: readonly Range[], t: number): number {
  let out = 0
  for (const r of keep) {
    if (t <= r.start) return out
    if (t < r.end) return out + (t - r.start)
    out += r.end - r.start
  }
  return out
}

/** Where to go when playback reaches `t`: `t` itself inside a part, the next
 *  part's start in a gap, or null past the last part. */
export function playableFrom(keep: readonly Range[], t: number): number | null {
  if (partAt(keep, t) >= 0) return t
  const next = keep.find((r) => r.start >= t)
  return next ? next.start : null
}

/** "0:04.235" - the timer while editing, to the millisecond. */
export function formatPrecise(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000))
  const m = Math.floor(ms / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  return `${m}:${String(s).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`
}

/** The marks along the timeline at a zoom: a label every `major` seconds -
 *  far enough apart to read - with finer `minor` marks between. Zoomed all
 *  the way in they are hundredths of a second, with marks every 2 ms. */
export function rulerSteps(pxPerSec: number): { major: number; minor: number } {
  const steps: [number, number][] = [
    [0.01, 0.002],
    [0.02, 0.005],
    [0.05, 0.01],
    [0.1, 0.02],
    [0.2, 0.05],
    [0.5, 0.1],
    [1, 0.2],
    [2, 0.5],
    [5, 1],
    [10, 2],
  ]
  const [major, minor] = steps.find(([m]) => m * pxPerSec >= 70) ?? steps[steps.length - 1]
  return { major, minor }
}

/** A mark's label: whole seconds as "0:04", finer ones as "0:04.25". */
export function markLabel(t: number, major: number): string {
  const decimals = major >= 1 ? 0 : major >= 0.1 ? 1 : 2
  const whole = Math.floor(t + 1e-9)
  const m = Math.floor(whole / 60)
  const s = String(whole % 60).padStart(2, '0')
  if (decimals === 0) return `${m}:${s}`
  const fraction = Math.round((t - whole) * 10 ** decimals)
  return `${m}:${s}.${String(fraction).padStart(decimals, '0')}`
}
