// A tiny fade at every cut, so the sound never clicks where two kept parts meet.
//
// The sound is read in chunks of about 20 ms, and a kept part takes whole
// chunks: the one already playing at its start and every one starting before
// its end. Butted together, the wave jumped from wherever the last part
// stopped to wherever the next one started - a little click at every cut, the
// sound "a video makes when it ends and starts". Now each part's sound fades
// in over its first few milliseconds and out over its last, and whatever a
// chunk holds from outside the part (a sliver of the pause that was cut) is
// silent. 8 ms is far too short to hear as a fade, and long enough that the
// wave never jumps.
//
// Only his voice goes through this; the music and the look's sounds are laid
// over it afterwards, on the finished video's own timeline, and play straight
// through the cuts.

import type { Range } from '../media/silenceMath'

export const CUT_FADE_SEC = 0.008

/** Two parts this close together are one stretch of sound, not a cut. */
const JOINED_SEC = 0.001

/** Which ends of a kept part are a cut, and so fade. */
export interface CutEdges {
  fadeIn: boolean
  fadeOut: boolean
}

/** For each kept part: a cut at its start and end - a gap before or after it,
 *  a video played in the middle right there, or the very start and end of
 *  him. Two parts with nothing between them play on as one. */
export function cutEdges(keep: readonly Range[], videosAfter: readonly number[] = []): CutEdges[] {
  const after = new Set(videosAfter)
  return keep.map((range, i) => ({
    fadeIn: i === 0 || range.start - keep[i - 1].end > JOINED_SEC || after.has(i - 1),
    fadeOut: i === keep.length - 1 || keep[i + 1].start - range.end > JOINED_SEC || after.has(i),
  }))
}

/** How loud the sound at time `t` (on the recording) is let through, for the
 *  kept part [start, end): nothing outside it, rising over the first
 *  CUT_FADE_SEC after a cut and falling over the last before one. */
export function edgeGain(t: number, start: number, end: number, edges: CutEdges, fade = CUT_FADE_SEC): number {
  let gain = 1
  if (edges.fadeIn) {
    if (t < start) return 0
    if (t < start + fade) gain = Math.min(gain, (t - start) / fade)
  }
  if (edges.fadeOut) {
    if (t >= end) return 0
    if (t > end - fade) gain = Math.min(gain, (end - t) / fade)
  }
  return gain
}

/** Whether a chunk of sound from `from` lasting `seconds` reaches into a fade
 *  - most chunks don't, and go through untouched. */
export function nearCut(from: number, seconds: number, start: number, end: number, edges: CutEdges, fade = CUT_FADE_SEC): boolean {
  return (edges.fadeIn && from < start + fade) || (edges.fadeOut && from + seconds > end - fade)
}

/** Fades the chunk in place: `planes` is one array per channel, its first
 *  frame at `from` seconds on the recording, `rate` frames a second. */
export function fadeAtCuts(
  planes: Float32Array[],
  from: number,
  rate: number,
  start: number,
  end: number,
  edges: CutEdges,
  fade = CUT_FADE_SEC,
): void {
  const length = planes[0]?.length ?? 0
  for (let i = 0; i < length; i++) {
    const gain = edgeGain(from + i / rate, start, end, edges, fade)
    if (gain === 1) continue
    for (const plane of planes) plane[i] *= gain
  }
}
