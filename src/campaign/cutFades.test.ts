import { describe, expect, it } from 'vitest'

import { CUT_FADE_SEC, cutEdges, edgeGain, fadeAtCuts, nearCut } from './cutFades'

const RATE = 48000

/** A loud tone, as his voice would be mid-word. */
const tone = (from: number, seconds: number) =>
  Float32Array.from({ length: Math.round(seconds * RATE) }, (_, i) => 0.8 * Math.sin(2 * Math.PI * 220 * (from + i / RATE)))

/** The biggest step from one sample to the next - a click is a big one. */
const biggestStep = (wave: Float32Array) => {
  let most = 0
  for (let i = 1; i < wave.length; i++) most = Math.max(most, Math.abs(wave[i] - wave[i - 1]))
  return most
}

describe('a fade at every cut', () => {
  it('knows which ends of each part are a cut', () => {
    const keep = [
      { start: 0, end: 2 },
      { start: 3, end: 5 },
      { start: 5, end: 7 }, // straight on from the last: one stretch of sound
      { start: 7, end: 9 }, // ...unless a video plays in the middle there
    ]
    expect(cutEdges(keep, [2])).toEqual([
      { fadeIn: true, fadeOut: true },
      { fadeIn: true, fadeOut: false },
      { fadeIn: false, fadeOut: true },
      { fadeIn: true, fadeOut: true },
    ])
  })

  it('is silent outside the part and ramps over a few ms inside it', () => {
    const both = { fadeIn: true, fadeOut: true }
    expect(edgeGain(0.99, 1, 2, both)).toBe(0)
    expect(edgeGain(1 + CUT_FADE_SEC / 2, 1, 2, both)).toBeCloseTo(0.5)
    expect(edgeGain(1.5, 1, 2, both)).toBe(1)
    expect(edgeGain(2 - CUT_FADE_SEC / 4, 1, 2, both)).toBeCloseTo(0.25)
    expect(edgeGain(2, 1, 2, both)).toBe(0)
    // Not a cut: left exactly as it was.
    expect(edgeGain(0.99, 1, 2, { fadeIn: false, fadeOut: false })).toBe(1)
  })

  it('takes the click out of two parts butted together', () => {
    // A chunk ending past the part's end (1.0137 s), then the next part's
    // chunk starting before its start (2.0011 s): as they were, the wave
    // jumps where they meet.
    const first = tone(0.99, 0.0237)
    const second = tone(1.9883, 0.0213)
    const joined = (a: Float32Array, b: Float32Array) => Float32Array.from([...a, ...b])
    expect(biggestStep(joined(first, second))).toBeGreaterThan(0.3)

    const edges = { fadeIn: true, fadeOut: true }
    expect(nearCut(0.99, 0.0237, 0.5, 1.0137, edges)).toBe(true)
    fadeAtCuts([first], 0.99, RATE, 0.5, 1.0137, edges)
    fadeAtCuts([second], 1.9883, RATE, 2.0011, 3, edges)
    // Now no step is bigger than the tone itself makes from sample to sample.
    expect(biggestStep(joined(first, second))).toBeLessThan(0.03)
  })

  it('leaves the middle of a part alone', () => {
    const edges = { fadeIn: true, fadeOut: true }
    expect(nearCut(1.2, 0.0213, 1, 2, edges)).toBe(false)
  })
})
