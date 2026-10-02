import { describe, expect, it } from 'vitest'

import {
  MIN_PART_SEC,
  formatPrecise,
  markLabel,
  outputTime,
  partAt,
  playableFrom,
  removeAt,
  restoreAt,
  rulerSteps,
  snapTo,
  splitAt,
  trimPart,
} from './cuts'

const keep = [
  { start: 1, end: 4 },
  { start: 6, end: 9 },
]

describe('partAt', () => {
  it('finds the part a moment is in, or none in a gap', () => {
    expect(partAt(keep, 2)).toBe(0)
    expect(partAt(keep, 6)).toBe(1)
    expect(partAt(keep, 5)).toBe(-1)
  })
})

describe('splitAt', () => {
  it('splits a part in two at the moment', () => {
    expect(splitAt(keep, 2.5)).toEqual([
      { start: 1, end: 2.5 },
      { start: 2.5, end: 4 },
      { start: 6, end: 9 },
    ])
  })

  it('does nothing in a gap or right at an edge', () => {
    expect(splitAt(keep, 5)).toEqual(keep)
    expect(splitAt(keep, 1 + MIN_PART_SEC / 2)).toEqual(keep)
  })
})

describe('removeAt', () => {
  it('takes out the part the moment is in', () => {
    expect(removeAt(keep, 7)).toEqual([{ start: 1, end: 4 }])
  })

  it('never takes the last part', () => {
    expect(removeAt([{ start: 1, end: 4 }], 2)).toEqual([{ start: 1, end: 4 }])
  })
})

describe('restoreAt', () => {
  it('brings a gap back, joining the parts either side', () => {
    expect(restoreAt(keep, 5, 10)).toEqual([{ start: 1, end: 9 }])
  })

  it('brings back the start and the end of the recording', () => {
    expect(restoreAt(keep, 0.5, 10)).toEqual([
      { start: 0, end: 4 },
      { start: 6, end: 9 },
    ])
    expect(restoreAt(keep, 9.5, 10)).toEqual([
      { start: 1, end: 4 },
      { start: 6, end: 10 },
    ])
  })

  it('does nothing inside a part', () => {
    expect(restoreAt(keep, 2, 10)).toEqual(keep)
  })
})

describe('trimPart', () => {
  it('moves an edge', () => {
    expect(trimPart(keep, 0, 'end', 3.2, 10)[0]).toEqual({ start: 1, end: 3.2 })
    expect(trimPart(keep, 1, 'start', 5, 10)[1]).toEqual({ start: 5, end: 9 })
  })

  it('stops at the neighbours and the ends of the video', () => {
    expect(trimPart(keep, 0, 'end', 8, 10)[0].end).toBe(6)
    expect(trimPart(keep, 1, 'start', 2, 10)[1].start).toBe(4)
    expect(trimPart(keep, 0, 'start', -3, 10)[0].start).toBe(0)
    expect(trimPart(keep, 1, 'end', 12, 10)[1].end).toBe(10)
  })

  it('never makes a part too short', () => {
    expect(trimPart(keep, 0, 'end', 0.5, 10)[0].end).toBeCloseTo(1 + MIN_PART_SEC)
  })
})

describe('snapTo', () => {
  it('lands on a word edge close by, and stays put otherwise', () => {
    expect(snapTo(2.05, [1.5, 2.02, 3])).toBe(2.02)
    expect(snapTo(2.5, [1.5, 2.02, 3])).toBe(2.5)
  })
})

describe('outputTime and playableFrom', () => {
  it('counts only what is kept', () => {
    expect(outputTime(keep, 2)).toBe(1)
    expect(outputTime(keep, 5)).toBe(3)
    expect(outputTime(keep, 7)).toBe(4)
    expect(outputTime(keep, 10)).toBe(6)
  })

  it('jumps a gap to the next part, and stops after the last', () => {
    expect(playableFrom(keep, 2)).toBe(2)
    expect(playableFrom(keep, 4.5)).toBe(6)
    expect(playableFrom(keep, 9.5)).toBeNull()
  })
})

describe('formatPrecise', () => {
  it('is the time to the millisecond', () => {
    expect(formatPrecise(4.2354)).toBe('0:04.235')
    expect(formatPrecise(65.0006)).toBe('1:05.001')
    expect(formatPrecise(0)).toBe('0:00.000')
    expect(formatPrecise(59.9996)).toBe('1:00.000')
  })
})

describe('rulerSteps and markLabel', () => {
  it('labels far enough apart to read at every zoom, finer as it zooms in', () => {
    expect(rulerSteps(40)).toEqual({ major: 2, minor: 0.5 })
    expect(rulerSteps(110)).toEqual({ major: 1, minor: 0.2 })
    expect(rulerSteps(800)).toEqual({ major: 0.1, minor: 0.02 })
    expect(rulerSteps(2000)).toEqual({ major: 0.05, minor: 0.01 })
    for (const px of [40, 110, 300, 800, 2000, 5000]) expect(rulerSteps(px).major * px).toBeGreaterThanOrEqual(70)
  })

  it('writes each mark as finely as its step', () => {
    expect(markLabel(4, 1)).toBe('0:04')
    expect(markLabel(64.2, 0.1)).toBe('1:04.2')
    expect(markLabel(4.25, 0.05)).toBe('0:04.25')
    expect(markLabel(4.3 - 1e-12, 0.1)).toBe('0:04.3')
  })
})
