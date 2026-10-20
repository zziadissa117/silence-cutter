// @vitest-environment node
// A clip trimmed without re-encoding keeps hidden lead-in frames before its
// start (fixtures/trimmed.mov: cut at 1.5 s of a clip with a key frame every
// second, so half a second of them). The picture starts at 0, never in them.
import { readFileSync } from 'node:fs'

import { ALL_FORMATS, BufferSource, Input } from 'mediabunny'
import { describe, expect, it } from 'vitest'

import { firstShown, steadyFrom } from './clipParts'
import { openingProblem } from './montageRender'

describe('where a trimmed clip starts', () => {
  it('starts at 0, not in the hidden frames before the cut', async () => {
    const bytes = readFileSync(new URL('./fixtures/trimmed.mov', import.meta.url))
    const input = new Input({ source: new BufferSource(bytes), formats: ALL_FORMATS })
    const track = (await input.getPrimaryVideoTrack())!
    // What the file holds: frames from half a second before the start.
    expect(await track.getFirstTimestamp()).toBeCloseTo(-0.5)
    expect(await firstShown(track)).toBe(0)
  })

  it('keeps a start after 0 as it is', async () => {
    expect(await firstShown({ getFirstTimestamp: async () => 0.25 })).toBe(0.25)
  })
})

describe('steadyFrom (where a clip plays steadily from)', () => {
  const at = (ms: number[]) => ms.map((m) => m / 1000)
  const every = (from: number, to: number, step = 33.333) => Array.from({ length: Math.round((to - from) / step) }, (_, k) => from + k * step)

  it('an ordinary clip starts where it was asked to', () => {
    expect(steadyFrom(at(every(0, 2000)), 0)).toBe(0)
    expect(steadyFrom(at(every(-500, 2000)), 0)).toBe(0)
  })

  it('skips first frames that come every other one or worse', () => {
    const times = at([0, 67, 133, 200, 267, ...every(300, 2000)])
    expect(steadyFrom(times, 0)).toBeCloseTo(0.267, 3)
  })

  it('starts on a first frame that comes late instead of freezing on it', () => {
    expect(steadyFrom(at(every(400, 2000)), 0)).toBeCloseTo(0.4, 3)
  })

  it('never skips more than a second', () => {
    const times = at([0, 400, 800, 1200, 1600, ...every(2000, 4000)])
    expect(steadyFrom(times, 0)).toBe(0)
  })
})

describe('openingProblem', () => {
  it('says nothing about a steady start', () => {
    expect(openingProblem(Array.from({ length: 45 }, (_, k) => ({ own: k / 30, at: k / 30 })))).toBeNull()
  })
  it('says when the first frame was held', () => {
    expect(openingProblem([{ own: 0.5, at: 0.5 }, { own: 0.533, at: 0.533 }])).toMatch(/first frame at 500 ms/)
  })
})
