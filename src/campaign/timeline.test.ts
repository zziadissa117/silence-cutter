import { describe, expect, it } from 'vitest'

import { MomentPlacer, inWindow } from './timeline'

describe('MomentPlacer', () => {
  const keep = [
    { start: 0, end: 2 },
    { start: 5, end: 8 },
    { start: 10, end: 12 },
  ]

  it('uses each range’s real shift, not its nominal position', () => {
    const placer = new MomentPlacer([1, 6, 11], keep)
    placer.enterRange(0, 0)
    // The first range came out 30ms long, so the second starts at 2.03.
    placer.enterRange(1, 2.03 - 5)
    placer.enterRange(2, 5.06 - 10)
    expect(placer.times.map((t) => +t.toFixed(3))).toEqual([1, 3.03, 6.06])
  })

  it('places a moment only once its range has been reached', () => {
    const placer = new MomentPlacer([6], keep)
    placer.enterRange(0, 0)
    expect(placer.times).toEqual([])
    placer.enterRange(1, -3)
    expect(placer.times).toEqual([3])
  })

  it('moves a moment that fell in a cut-out gap to the start of what follows', () => {
    const placer = new MomentPlacer([3.5], keep)
    placer.enterRange(0, 0)
    placer.enterRange(1, -3)
    expect(placer.times).toEqual([2])
  })

  it('places what is left over in the last range', () => {
    const placer = new MomentPlacer([12.5], keep)
    placer.enterRange(0, 0)
    placer.enterRange(1, -3)
    placer.enterRange(2, -5)
    expect(placer.times).toEqual([7.5])
  })
})

describe('inWindow', () => {
  it('is true from each start until the window runs out', () => {
    expect(inWindow(1, [1], 2.5)).toBe(true)
    expect(inWindow(3.49, [1], 2.5)).toBe(true)
    expect(inWindow(3.5, [1], 2.5)).toBe(false)
    expect(inWindow(0.99, [1], 2.5)).toBe(false)
    expect(inWindow(10, [1, 9], 2.5)).toBe(true)
    expect(inWindow(10, [], 2.5)).toBe(false)
  })
})
