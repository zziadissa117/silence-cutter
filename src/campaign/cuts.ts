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

// A clip's speed (the edit screen's Speed tool, his pick 2026-11-10 with
// Split and Delete): a kept part can play faster or slower - its picture and
// his voice (its pitch kept) and everything timed in it with them. Kept on
// the part itself (`speed`), so it travels with the cut everywhere the cut
// goes - the render here and on the Cutter server, the captions, the
// timeline. Absent: as filmed.

/** A kept part, maybe sped up or slowed down. */
export interface Part extends Range {
  speed?: number
}

/** The speeds a clip can be set to, as the Speed tool offers them. */
export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3] as const
const SLOWEST = 0.5
const FASTEST = 3

/** How fast part `r` plays: 1 unless set. */
export function speedOf(r: Range): number {
  const s = (r as Part).speed
  return typeof s === 'number' && Number.isFinite(s) && s > 0 ? Math.min(FASTEST, Math.max(SLOWEST, s)) : 1
}

/** How long part `r` lasts in the finished video. */
export function partLength(r: Range): number {
  return (r.end - r.start) / speedOf(r)
}

/** How long the kept parts last in the finished video, speeds and all. */
export function keptLength(keep: readonly Range[]): number {
  return keep.reduce((sum, r) => sum + partLength(r), 0)
}

/** Part `i` set to play at `speed` (1: as filmed). */
export function withSpeed(keep: readonly Range[], i: number, speed: number): Range[] {
  return keep.map((r, k) => {
    if (k !== i) return r
    const { speed: _was, ...rest } = r as Part
    return speed === 1 ? rest : { ...rest, speed }
  })
}

/** The kept parts in order, touching or overlapping ones made one - when
 *  they play at the same speed. Parts at different speeds stay apart, the
 *  later one starting where the earlier one ends. */
export function joinParts(parts: readonly Range[]): Range[] {
  const sorted = [...parts].sort((a, b) => a.start - b.start)
  const out: Range[] = []
  for (const r of sorted) {
    const last = out[out.length - 1]
    if (last && r.start <= last.end) {
      if (r.end <= last.end) continue
      if (speedOf(last) === speedOf(r)) last.end = r.end
      else out.push({ ...r, start: last.end })
      continue
    }
    out.push({ ...r })
  }
  return out
}

/** Which kept part `t` is in, or -1 when it falls in a cut-out gap. */
export function partAt(keep: readonly Range[], t: number): number {
  return keep.findIndex((r) => t >= r.start && t < r.end)
}

/** One kept part becomes two at `t`. Nothing changes when `t` isn't in a
 *  part, or is too close to its edge to leave both halves long enough. */
export function splitAt(keep: readonly Range[], t: number): Range[] {
  const i = partAt(keep, t)
  if (i < 0) return [...keep]
  const part = keep[i]
  const { start, end } = part
  if (t - start < MIN_PART_SEC || end - t < MIN_PART_SEC) return [...keep]
  // Both halves keep the part's speed.
  return [...keep.slice(0, i), { ...part, end: t }, { ...part, start: t }, ...keep.slice(i + 1)]
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
  const gapStart = before.length > 0 ? before[before.length - 1].end : 0
  const gapEnd = after.length > 0 ? after[0].start : duration
  // The gap brought back plays at the speed of the part before it.
  const near = before[before.length - 1] ?? after[0]
  const speed = near ? speedOf(near) : 1
  const gap: Part = speed === 1 ? { start: gapStart, end: gapEnd } : { start: gapStart, end: gapEnd, speed }
  return joinParts([...before, gap, ...after])
}

/** Moves one edge of part `i` to `to`, never past its neighbours, the ends
 *  of the video, or so close to its other edge that it is too short. */
export function trimPart(keep: readonly Range[], i: number, edge: 'start' | 'end', to: number, duration: number): Range[] {
  const part = keep[i]
  if (!part) return [...keep]
  const next = [...keep]
  if (edge === 'start') {
    const floor = i > 0 ? keep[i - 1].end : 0
    next[i] = { ...part, start: Math.min(Math.max(to, floor), part.end - MIN_PART_SEC) }
  } else {
    const ceiling = i < keep.length - 1 ? keep[i + 1].start : duration
    next[i] = { ...part, end: Math.max(Math.min(to, ceiling), part.start + MIN_PART_SEC) }
  }
  return next
}

/** The kept parts as the cut will use them: two that touch - a split that
 *  was never followed by a Delete, or an edge trimmed up to its neighbour -
 *  are one part again. Left as two, the render would treat the seam as a
 *  cut and punch in on footage that never stopped. */
export function tidyParts(keep: readonly Range[]): Range[] {
  return joinParts(keep)
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
    if (t < r.end) return out + (t - r.start) / speedOf(r)
    out += partLength(r)
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

/** The raw moment playing at moment `out` of the finished video - the other
 *  way round from outputTime, for the timeline that shows only what plays
 *  (his pick, 2026-11-10: "like TikTok", the cut bits hidden). Where two
 *  parts meet, the later one's start; past the end, the last part's end. */
export function sourceAt(keep: readonly Range[], out: number): number {
  let at = 0
  for (const r of keep) {
    const length = partLength(r)
    if (out < at + length) return r.start + Math.max(0, out - at) * speedOf(r)
    at += length
  }
  const last = keep[keep.length - 1]
  return last ? last.end : 0
}

/** Each kept part where it sits on that timeline: from `at` seconds of the
 *  finished video, `length` long. */
export function clipsOf(keep: readonly Range[]): { at: number; length: number }[] {
  let at = 0
  return keep.map((r) => {
    const clip = { at, length: partLength(r) }
    at += clip.length
    return clip
  })
}

/** Where one source frame - `duration` long, landing at `at` on the finished
 *  video - is written when its part plays at `speed`, never past `limit` (the
 *  part's end there): once at 1x; sped up, only once at least a source frame
 *  has passed since the last one written (`after`), so the video keeps the
 *  source's frame rate rather than doubling it (Instagram takes at most 60);
 *  slowed down, held over as many frames as its longer stretch needs, so it
 *  doesn't drop below the source's rate (it takes no fewer than 23). */
export function frameSlots(at: number, duration: number, speed: number, after: number, limit = Infinity): { t: number; d: number }[] {
  if (speed === 1) return [{ t: at, d: duration }]
  const length = duration / speed
  const clip = (t: number, d: number) => Math.max(1e-4, Math.min(d, limit - t))
  if (speed > 1) return at + 1e-6 >= after && at < limit ? [{ t: at, d: clip(at, duration) }] : []
  const slots: { t: number; d: number }[] = []
  for (let t = at; t < at + length - 1e-6 && t < limit; t += duration) slots.push({ t, d: clip(t, Math.min(duration, at + length - t)) })
  return slots
}
