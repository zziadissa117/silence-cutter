import { describe, expect, it } from 'vitest'

import { liftMusic, soloMusicGain, verticalSize } from './montageRender'

describe('music on a video with no talking', () => {
  it('brings a loud master down to about -14 LUFS', () => {
    expect(20 * Math.log10(soloMusicGain(-8))).toBeCloseTo(-6, 5)
  })
  it('turns a quiet song up to the same level', () => {
    expect(20 * Math.log10(soloMusicGain(-20))).toBeCloseTo(6, 5)
    expect(soloMusicGain(-14)).toBe(1)
  })
  it('turns a near-silent one up 24 dB at most', () => {
    expect(20 * Math.log10(soloMusicGain(-70))).toBeCloseTo(24, 5)
  })
  it('leaves silence out', () => {
    expect(soloMusicGain(-Infinity)).toBe(0)
  })
  it('never clips a song it turns up', () => {
    const rate = 48000
    const song = [Float32Array.from({ length: rate }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 440 * i) / rate))]
    liftMusic(song, 4, rate)
    expect(Math.max(...song[0].map(Math.abs))).toBeLessThanOrEqual(10 ** (-1.5 / 20) + 1e-6)
    // Still turned up: far louder than it went in.
    expect(Math.max(...song[0].slice(rate / 2).map(Math.abs))).toBeGreaterThan(0.8)
  })
})

describe('the frame of a video with no talking', () => {
  it('is upright even when the first clip lies on its side', () => {
    expect(verticalSize(1280, 720)).toEqual({ width: 1080, height: 1920 })
    expect(verticalSize(1080, 1080)).toEqual({ width: 1080, height: 1920 })
  })
  it('keeps an upright first clip\'s own shape', () => {
    expect(verticalSize(1080, 1920)).toEqual({ width: 1080, height: 1920 })
    expect(verticalSize(2160, 3840)).toEqual({ width: 2160, height: 3840 })
    expect(verticalSize(2160, 3840, 1080)).toEqual({ width: 1080, height: 1920 })
  })
})
