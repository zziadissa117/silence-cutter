import { describe, expect, it } from 'vitest'

import { dbToGain, mixInto, synthesize } from './sounds'

describe('mixInto', () => {
  const tone = (values: number[]) => ({ channels: [Float32Array.from(values)] })

  it('changes nothing when no sound overlaps', () => {
    const plane = new Float32Array([0.1, 0.1, 0.1])
    expect(mixInto([plane], 100, [{ ...tone([0.5, 0.5]), startFrame: 10, gain: 1 }])).toBe(false)
    expect(Array.from(plane)).toEqual([0.1, 0.1, 0.1].map(Math.fround))
  })

  it('adds a sound starting mid-way through the samples, in every channel', () => {
    const left = new Float32Array(4)
    const right = new Float32Array(4)
    expect(mixInto([left, right], 100, [{ ...tone([0.5, 0.25, 0.125]), startFrame: 102, gain: 1 }])).toBe(true)
    expect(Array.from(left)).toEqual([0, 0, 0.5, 0.25])
    expect(Array.from(right)).toEqual([0, 0, 0.5, 0.25])
  })

  it('carries on into the next samples where the last ones stopped', () => {
    const next = new Float32Array(4)
    mixInto([next], 104, [{ ...tone([0.5, 0.25, 0.125]), startFrame: 102, gain: 1 }])
    expect(Array.from(next)).toEqual([0.125, 0, 0, 0])
  })

  it('applies the gain, and never pushes past full scale', () => {
    const plane = new Float32Array([0.9, 0])
    mixInto([plane], 0, [{ ...tone([0.5, 0.5]), startFrame: 0, gain: 0.5 }])
    expect(Array.from(plane)).toEqual([1, 0.25])
  })

  it('folds a stereo sound into a mono video', () => {
    const plane = new Float32Array(1)
    mixInto([plane], 0, [{ channels: [Float32Array.from([0.5]), Float32Array.from([0.25])], startFrame: 0, gain: 1 }])
    expect(plane[0]).toBeCloseTo(0.375)
  })
})

describe('dbToGain', () => {
  it('is 1 at 0 dB and halves roughly every 6 dB', () => {
    expect(dbToGain(0)).toBe(1)
    expect(dbToGain(-6)).toBeCloseTo(0.501, 3)
  })
})

describe('synthesize', () => {
  it.each(['whoosh', 'ding', 'pop'] as const)('makes an audible %s that never clips', (name) => {
    const samples = synthesize(name, 48000)
    const peak = samples.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
    expect(samples.length).toBeGreaterThan(48000 * 0.05)
    expect(samples.length).toBeLessThan(48000)
    expect(peak).toBeGreaterThan(0.1)
    expect(peak).toBeLessThan(1)
  })

  it('makes the same whoosh every time', () => {
    expect(synthesize('whoosh', 44100)).toEqual(synthesize('whoosh', 44100))
  })
})
