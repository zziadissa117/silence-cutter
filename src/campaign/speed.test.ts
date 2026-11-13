// A clip's speed (the edit screen's Speed tool, cuts.Part): the cut's timing
// everywhere follows it - the timeline, the captions, everything placed on
// the video - and the edits keep it.

import { describe, expect, it } from 'vitest'

import type { Range } from '../media/silenceMath'
import { cutTime } from './captions'
import { clipsOf, frameSlots, joinParts, keptLength, outputTime, restoreAt, sourceAt, speedOf, splitAt, tidyParts, trimPart, withSpeed, type Part } from './cuts'
import { cutOut, putBack } from './noiseCuts'
import { MomentPlacer } from './timeline'
import { cutLength, rawTimeAt } from './motion/track'

// 0-4 s as filmed, 5-9 s at 2x (2 s long), 10-11 s at 0.5x (2 s long).
const keep: Part[] = [
  { start: 0, end: 4 },
  { start: 5, end: 9, speed: 2 },
  { start: 10, end: 11, speed: 0.5 },
]

describe("a clip's speed", () => {
  it('makes it shorter or longer in the finished video, and moves everything after it', () => {
    expect(keptLength(keep)).toBe(8)
    expect(cutLength(keep)).toBe(8)
    expect(clipsOf(keep)).toEqual([
      { at: 0, length: 4 },
      { at: 4, length: 2 },
      { at: 6, length: 2 },
    ])
    expect(outputTime(keep, 7)).toBe(5)
    expect(outputTime(keep, 10.5)).toBe(7)
    expect(sourceAt(keep, 5)).toBe(7)
    expect(sourceAt(keep, 7)).toBe(10.5)
    expect(rawTimeAt(7, keep)).toBe(10.5)
    // The captions' words land where they are heard.
    expect(cutTime(7, keep)).toBe(5)
    expect(cutTime(10.5, keep)).toBe(7)
  })

  it('places everything timed on the video at its new moment (logo, captions, pictures)', () => {
    const placer = new MomentPlacer([1, 7, 10.5], keep)
    placer.enterRange(0, 0)
    placer.enterRange(1, 4 - 5)
    placer.enterRange(2, 6 - 10)
    expect(placer.times).toEqual([1, 5, 7])
  })

  it('is kept by every edit: split, trim, a cut put back or cut out; only the same speeds join', () => {
    expect(splitAt(keep, 7).map(speedOf)).toEqual([1, 2, 2, 0.5])
    expect(trimPart(keep, 1, 'end', 8, 12)[1]).toEqual({ start: 5, end: 8, speed: 2 })
    expect(cutOut(keep, { start: 6, end: 7 }).filter((r) => r.start >= 5 && r.end <= 9)).toEqual([
      { start: 5, end: 6, speed: 2 },
      { start: 7, end: 9, speed: 2 },
    ])
    // Put back inside a 2x clip: 2x across it, one part again.
    expect(putBack(cutOut(keep, { start: 6, end: 7 }), { start: 6, end: 7 })).toEqual(keep)
    // A split never followed by a delete is one part again - unless the halves differ.
    const halves = splitAt(keep, 2)
    expect(tidyParts(halves)).toEqual(keep)
    expect(tidyParts(withSpeed(halves, 1, 1.5)).map(speedOf)).toEqual([1, 1.5, 2, 0.5])
    expect(joinParts([{ start: 0, end: 3 }, { start: 2, end: 5, speed: 2 } as Range])).toEqual([
      { start: 0, end: 3 },
      { start: 3, end: 5, speed: 2 },
    ])
    // The gap brought back between two parts plays at the part before it's speed.
    expect(restoreAt([{ start: 0, end: 2, speed: 2 } as Range, { start: 3, end: 5, speed: 2 } as Range], 2.5, 6)).toEqual([{ start: 0, end: 5, speed: 2 }])
    expect(withSpeed(keep, 1, 1)[1]).toEqual({ start: 5, end: 9 })
  })

  it('keeps the frame rate: sped up, frames dropped; slowed down, frames held', () => {
    const f = 1 / 30
    expect(frameSlots(1, f, 1, Infinity)).toEqual([{ t: 1, d: f }])
    // 2x: every other frame.
    expect(frameSlots(1, f, 2, -Infinity)).toHaveLength(1)
    expect(frameSlots(1 + f / 2, f, 2, 1 + f * 0.999)).toEqual([])
    // 0.5x: each frame twice.
    const held = frameSlots(1, f, 0.5, -Infinity)
    expect(held.map((s) => +s.t.toFixed(4))).toEqual([1, +(1 + f).toFixed(4)])
    // Never past the part's end.
    expect(frameSlots(1, f, 0.5, -Infinity, 1 + f / 2)).toEqual([{ t: 1, d: expect.closeTo(f / 2, 6) }])
  })

  it('stays between 0.5x and 3x', () => {
    expect(speedOf({ start: 0, end: 1, speed: 10 } as Range)).toBe(3)
    expect(speedOf({ start: 0, end: 1, speed: 0.1 } as Range)).toBe(0.5)
    expect(speedOf({ start: 0, end: 1, speed: Number.NaN } as Range)).toBe(1)
  })
})
