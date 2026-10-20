// @vitest-environment node
// A clip trimmed without re-encoding keeps hidden lead-in frames before its
// start (fixtures/trimmed.mov: cut at 1.5 s of a clip with a key frame every
// second, so half a second of them). The picture starts at 0, never in them.
import { readFileSync } from 'node:fs'

import { ALL_FORMATS, BufferSource, Input } from 'mediabunny'
import { describe, expect, it } from 'vitest'

import { firstShown, steadyFrom, usualFrame } from './clipParts'
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

  it("reads how long its own frames last, not its lead-in's", async () => {
    const bytes = readFileSync(new URL('./fixtures/trimmed.mov', import.meta.url))
    const input = new Input({ source: new BufferSource(bytes), formats: ALL_FORMATS })
    expect(await usualFrame((await input.getPrimaryVideoTrack())!, 0)).toBeCloseTo(1 / 30, 4)
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
  // A clip's frames as they came into the video: `count` of them, `step` apart.
  const frames = (step: number, count: number, from = 0) => Array.from({ length: count }, (_, k) => ({ own: from + k * step, at: from + k * step }))

  it('says nothing about a steady start', () => {
    expect(openingProblem(frames(1 / 30, 45))).toBeNull()
  })
  it('says when the first frame was held', () => {
    expect(openingProblem([{ own: 0.5, at: 0.5 }, { own: 0.533, at: 0.533 }])).toMatch(/first frame at 500 ms/)
  })
  it('says when the first frames come every other one - each shown twice, laggy', () => {
    // The laggy hooks: 0.8 s of every other frame, then every one.
    const laggy = [...frames(2 / 30, 12), ...frames(1 / 30, 21, 0.8)]
    expect(openingProblem(laggy, 1 / 30)).toMatch(/^12 of its first 45 frames repeat the one before \(0 from its own 30 a second\)/)
    expect(openingProblem(frames(2 / 30, 23), 1 / 30)).toMatch(/^22 of its first 45 frames repeat/)
  })
  it('says when two frames in a row are missing', () => {
    expect(openingProblem([...frames(1 / 30, 10), ...frames(1 / 30, 33, 0.4)], 1 / 30)).toMatch(/^2 of its first 45 .*longest gap 100 ms/)
  })
  it("takes a clip's own rate as it is: a 24 or 60 a second clip, or one a hair under 30", () => {
    expect(openingProblem(frames(1 / 24, 36), 1 / 24)).toBeNull()
    expect(openingProblem(frames(1 / 60, 90), 1 / 60)).toBeNull()
    expect(openingProblem(frames(1001 / 30000, 45), 1001 / 30000)).toBeNull()
    // ...but a 24 a second one that drops frames too still says so.
    expect(openingProblem([...frames(1 / 24, 12), ...frames(1 / 24, 20, 0.625)], 1 / 24)).toMatch(/from its own 24 a second/)
  })
  it('lets one stray repeat go', () => {
    expect(openingProblem([...frames(1 / 30, 10), ...frames(1 / 30, 34, 1 / 3 + 1 / 30)], 1 / 30)).toBeNull()
  })
})
