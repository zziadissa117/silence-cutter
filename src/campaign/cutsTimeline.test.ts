import { describe, expect, it } from 'vitest'

import { clipsOf, outputTime, sourceAt, trimPart } from './cuts'

const keep = [
  { start: 1, end: 3 },
  { start: 5, end: 6 },
  { start: 8, end: 10 },
]

describe('the timeline of what plays', () => {
  it('lays the parts back to back', () => {
    expect(clipsOf(keep)).toEqual([
      { at: 0, length: 2 },
      { at: 2, length: 1 },
      { at: 3, length: 2 },
    ])
  })

  it('finds the raw moment for a moment of the video, and back', () => {
    expect(sourceAt(keep, 0)).toBe(1)
    expect(sourceAt(keep, 1.5)).toBe(2.5)
    // Where two parts meet: the later one.
    expect(sourceAt(keep, 2)).toBe(5)
    expect(sourceAt(keep, 3.5)).toBe(8.5)
    expect(sourceAt(keep, 99)).toBe(10)
    for (const out of [0, 0.7, 2.2, 4.9]) expect(outputTime(keep, sourceAt(keep, out))).toBeCloseTo(out)
  })

  it('pulls a cut bit back by dragging an edge outward, never past the next part', () => {
    expect(trimPart(keep, 0, 'end', 4, 12)[0]).toEqual({ start: 1, end: 4 })
    expect(trimPart(keep, 0, 'end', 7, 12)[0]).toEqual({ start: 1, end: 5 })
    expect(trimPart(keep, 1, 'start', 2, 12)[1]).toEqual({ start: 3, end: 6 })
  })
})
