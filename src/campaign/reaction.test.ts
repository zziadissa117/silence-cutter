import { describe, expect, it } from 'vitest'

import { Resampler, TALKING_WORDS, cover, fitChannels, layOut, productMoment, talksIn, toStereo } from './reaction'

const sine = (rate: number, seconds: number, hz = 440) =>
  Float32Array.from({ length: Math.round(rate * seconds) }, (_, i) => Math.sin((2 * Math.PI * hz * i) / rate))

describe('Resampler', () => {
  it('leaves a matching rate alone', () => {
    const plane = sine(48000, 0.01)
    expect(new Resampler(48000, 48000).push([plane])[0]).toBe(plane)
  })

  it('turns 44.1 kHz into 48 kHz at the right length, the same in chunks as whole', () => {
    const input = sine(44100, 1)
    const whole = new Resampler(44100, 48000).push([input])[0]
    expect(Math.abs(whole.length - 48000)).toBeLessThanOrEqual(1)

    const chunked = new Resampler(44100, 48000)
    const pieces: number[] = []
    for (let at = 0; at < input.length; at += 1000) pieces.push(...chunked.push([input.subarray(at, at + 1000)])[0])
    expect(Math.abs(pieces.length - whole.length)).toBeLessThanOrEqual(1)
    // Nothing lost or doubled at the seams: the same wave either way.
    let worst = 0
    for (let i = 0; i < Math.min(pieces.length, whole.length); i++) worst = Math.max(worst, Math.abs(pieces[i] - whole[i]))
    expect(worst).toBeLessThan(1e-5)
    // And still the same tone: compare with a true 48 kHz sine.
    const truth = sine(48000, 1)
    let error = 0
    for (let i = 0; i < 47000; i++) error = Math.max(error, Math.abs(whole[i] - truth[i]))
    expect(error).toBeLessThan(0.01)
  })
})

describe('toStereo', () => {
  it('doubles mono and drops extra channels', () => {
    const a = new Float32Array([1, 2])
    expect(toStereo([a]).map((p) => [...p])).toEqual([[1, 2], [1, 2]])
    expect(toStereo([a, a, a])).toHaveLength(2)
  })
})

describe('fitChannels', () => {
  const a = new Float32Array([1, 3])
  const b = new Float32Array([3, 5])
  it("gives a clip's sound the channels of the video it joins", () => {
    expect(fitChannels([a], 4).map((p) => [...p])).toEqual([[1, 3], [1, 3], [1, 3], [1, 3]])
    expect(fitChannels([a, b], 1).map((p) => [...p])).toEqual([[2, 4]])
    expect(fitChannels([a, b, a, b], 2)).toHaveLength(2)
    expect(fitChannels([a, b], 3).map((p) => [...p])).toEqual([[1, 3], [3, 5], [1, 3]])
    expect(fitChannels([a, b], 2)[1]).toBe(b)
  })
})

describe('layOut', () => {
  it('puts the reaction first, then the product parts back to back', () => {
    const { segments, switchAt, total } = layOut({ start: 0, end: 3 }, [
      { start: 1, end: 4 },
      { start: 6, end: 8 },
    ])
    expect(switchAt).toBe(3)
    expect(total).toBe(8)
    expect(segments.map((s) => [s.part, s.at])).toEqual([
      ['reaction', 0],
      ['product', 3],
      ['product', 6],
    ])
    expect(productMoment(segments, 2)).toBe(4)
    expect(productMoment(segments, 7)).toBe(7)
    expect(productMoment(segments, 5)).toBeNull()
  })
})

describe('talksIn', () => {
  const word = (text: string, start: number) => ({ text, start, end: start + 0.3 })
  it('needs real talking, not a stray word from music', () => {
    const keep = [{ start: 0, end: 5 }]
    expect(talksIn([word('Thank', 0), word('you.', 0.4)], keep)).toBe(false)
    const said = Array.from({ length: TALKING_WORDS }, (_, i) => word('word', i))
    expect(talksIn(said, keep)).toBe(true)
    expect(talksIn(said, [{ start: 0, end: 0.5 }])).toBe(false)
  })
})

describe('cover', () => {
  it('fills a 9:16 frame with a taller screen recording, trimming top and bottom', () => {
    const place = cover(1179, 2556, 1080, 1920)
    expect(place.width).toBeCloseTo(1080)
    expect(place.height).toBeGreaterThan(1920)
    expect(place.x).toBeCloseTo(0)
    expect(place.y).toBeLessThan(0)
  })
})
