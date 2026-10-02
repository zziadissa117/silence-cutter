// Moves moments on the raw video's timeline - "he said inflow at 12.4s" -
// onto the cut video's timeline, using the shift the render actually applied
// to each kept range rather than the ranges' nominal lengths.
//
// The difference matters. Each range comes out up to a frame longer than it
// nominally is (the frame already on screen at its start is kept), so adding
// up nominal lengths drifts by a frame per cut - half a second late by the
// twentieth pause, which is a logo arriving well after the word. The render
// knows the true shift the moment a range's first frame goes out, and every
// moment inside that range is placed with it.

import type { Range } from '../media/silenceMath'

export class MomentPlacer {
  private readonly placed: number[] = []
  private next = 0
  private readonly moments: number[]
  private readonly keep: Range[]

  /** `moments` are times on the raw video, in order. */
  constructor(moments: number[], keep: Range[]) {
    this.moments = moments
    this.keep = keep
  }

  /** Called once per range, in order, as soon as that range's shift is known
   *  (output time = raw time + shift). Places every moment up to the end of
   *  this range. A moment that fell in a gap that was cut out lands at the
   *  start of the range after it - the nearest thing that still exists. */
  enterRange(index: number, shift: number): void {
    const range = this.keep[index]
    const isLast = index === this.keep.length - 1
    while (this.next < this.moments.length && (isLast || this.moments[this.next] < range.end)) {
      const raw = Math.max(this.moments[this.next], range.start)
      this.placed.push(raw + shift)
      this.next++
    }
  }

  /** Output times placed so far. */
  get times(): readonly number[] {
    return this.placed
  }
}

/** Whether `t` falls inside any window starting at one of `starts` and
 *  lasting `seconds`. */
export function inWindow(t: number, starts: readonly number[], seconds: number): boolean {
  for (const start of starts) {
    if (t >= start && t < start + seconds) return true
  }
  return false
}
