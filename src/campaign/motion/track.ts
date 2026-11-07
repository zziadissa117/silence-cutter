// Word numbers to the finished video's clock, for the motion graphics
// (draw.ts). Two ways, one result:
//
//   - MotionTrack, in the render: each word placed with its kept part's real
//     shift as the render walks the parts (timeline.ts MomentPlacer), so a
//     graphic lands on the very frame its word is heard, like the captions.
//   - cutTiming, for the plan screen's stills and scrubbing: worked out from
//     the kept parts alone, before anything is made.

import type { Range } from '../../media/silenceMath'
import { cutTime } from '../captions'
import { MomentPlacer } from '../timeline'
import type { Timing } from './draw'

interface Word {
  start: number
  end: number
}

/** A word's end, a hair inside it, so a word ending right at a cut stays in
 *  its own part. */
const END_INSIDE = 0.001

export class MotionTrack {
  private readonly placer: MomentPlacer
  /** Where each word's start and end sit in the placer's moments. */
  private readonly startAt: number[]
  private readonly endAt: number[]
  readonly timing: Timing

  constructor(words: readonly Word[], keep: Range[]) {
    const moments = words.flatMap((w, i) => [
      { raw: w.start, key: 2 * i },
      { raw: Math.max(w.start, w.end - END_INSIDE), key: 2 * i + 1 },
    ])
    moments.sort((a, b) => a.raw - b.raw || a.key - b.key)
    this.startAt = Array.from({ length: words.length }, () => 0)
    this.endAt = Array.from({ length: words.length }, () => 0)
    moments.forEach((m, k) => {
      if (m.key % 2 === 0) this.startAt[m.key / 2] = k
      else this.endAt[(m.key - 1) / 2] = k
    })
    this.placer = new MomentPlacer(
      moments.map((m) => m.raw),
      keep,
    )
    const at = (k: number | undefined) => (k === undefined ? Infinity : (this.placer.times[k] ?? Infinity))
    this.timing = {
      start: (i) => at(this.startAt[i]),
      end: (i) => at(this.endAt[i]),
    }
  }

  /** Called with every kept part, in order, as the render reaches it. */
  enterRange(index: number, shift: number): void {
    this.placer.enterRange(index, shift)
  }
}

/** Where each word lands in the cut video, from the kept parts alone - for
 *  stills and scrubbing before it is made. `offset`: anything played before
 *  him (none in a motion video). */
export function cutTiming(words: readonly Word[], keep: Range[], offset = 0): Timing {
  return {
    start: (i) => (words[i] ? offset + cutTime(words[i].start, keep) : Infinity),
    end: (i) => (words[i] ? offset + cutTime(Math.max(words[i].start, words[i].end - END_INSIDE), keep) : Infinity),
  }
}

/** The raw video's moment shown at `t` of the cut video - for a still. */
export function rawTimeAt(t: number, keep: Range[]): number {
  let left = Math.max(0, t)
  for (const r of keep) {
    const length = r.end - r.start
    if (left < length) return r.start + left
    left -= length
  }
  return keep.length > 0 ? keep[keep.length - 1].end - 0.05 : 0
}

/** How long the cut video is. */
export function cutLength(keep: Range[]): number {
  return keep.reduce((sum, r) => sum + (r.end - r.start), 0)
}
