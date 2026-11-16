import { describe, expect, it } from 'vitest'

import { evenTurns, overlayWindows } from './stepOverlays'

describe("a step's overlays one after another", () => {
  it('all at once when not split', () => {
    expect(overlayWindows(2)).toEqual([{ from: 0, to: 1 }, { from: 0, to: 1 }])
  })

  it('the first until his split, the second after (his ask: 0-50%, then 50%)', () => {
    expect(overlayWindows(2, [0.5])).toEqual([{ from: 0, to: 0.5 }, { from: 0.5, to: 1 }])
    expect(overlayWindows(2, [0.7])).toEqual([{ from: 0, to: 0.7 }, { from: 0.7, to: 1 }])
  })

  it('never overlapping, edge to edge, for three', () => {
    const w = overlayWindows(3, [0.2, 0.6])
    expect(w).toEqual([{ from: 0, to: 0.2 }, { from: 0.2, to: 0.6 }, { from: 0.6, to: 1 }])
  })

  it('evenly when one was added or taken out since the split was set', () => {
    expect(overlayWindows(3, [0.5])).toEqual(overlayWindows(3, evenTurns(3)))
    expect(evenTurns(2)).toEqual([0.5])
    expect(evenTurns(4)).toEqual([0.25, 0.5, 0.75])
  })
})
