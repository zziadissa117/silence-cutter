import { describe, expect, it } from 'vitest'

import { contiguousAudio, forwardOnly } from './forwardOnly'

describe('forwardOnly', () => {
  it('leaves well-ordered timestamps untouched', () => {
    const next = forwardOnly()
    expect([0, 0.033, 0.066, 1.5].map(next)).toEqual([0, 0.033, 0.066, 1.5])
  })

  it('never lets a timestamp go backwards or repeat', () => {
    const next = forwardOnly()
    // The two numbers from the error on the friend's iPhone.
    const out = [1.5789569, 1.5704081, 1.5704081, 1.6].map(next)
    for (let i = 1; i < out.length; i++) expect(out[i]).toBeGreaterThan(out[i - 1])
    expect(out[0]).toBe(1.5789569)
    expect(out[3]).toBe(1.6)
  })
})

describe('contiguousAudio', () => {
  const frame = 1024 / 48000

  it('leaves back-to-back samples untouched', () => {
    const place = contiguousAudio()
    const input = [0, frame, 2 * frame, 3 * frame]
    expect(input.map((t) => place(t, frame))).toEqual(input)
  })

  it('moves an overlapping sample to where the last one ended', () => {
    const place = contiguousAudio()
    expect(place(1.0, frame)).toBe(1.0)
    expect(place(1.0 + frame - 0.008, frame)).toBeCloseTo(1.0 + frame, 9)
  })

  it('leaves a late sample late, so a gap stays a gap', () => {
    const place = contiguousAudio()
    place(0, frame)
    expect(place(0.5, frame)).toBe(0.5)
  })

  it('never lets a start go backwards, even across a big overlap', () => {
    const place = contiguousAudio()
    const starts = [0, 0.01, 0.005, 0.03, 0.02].map((t) => place(t, frame))
    for (let i = 1; i < starts.length; i++) expect(starts[i]).toBeGreaterThanOrEqual(starts[i - 1] + frame - 1e-12)
  })
})
