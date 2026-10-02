import { describe, expect, it } from 'vitest'

import { soloMusicGain, verticalSize } from './montageRender'

describe('music on a video with no talking', () => {
  it('brings a loud master down to about -14 LUFS', () => {
    expect(20 * Math.log10(soloMusicGain(-8))).toBeCloseTo(-6, 5)
  })
  it('never turns a quiet track up', () => {
    expect(soloMusicGain(-20)).toBe(1)
    expect(soloMusicGain(-14)).toBe(1)
  })
  it('leaves silence out', () => {
    expect(soloMusicGain(-Infinity)).toBe(0)
  })
})

describe('the frame of a video with no talking', () => {
  it('is upright even when the first clip lies on its side', () => {
    expect(verticalSize(1280, 720)).toEqual({ width: 1080, height: 1920 })
    expect(verticalSize(1080, 1080)).toEqual({ width: 1080, height: 1920 })
  })
  it('keeps an upright first clip\'s own shape', () => {
    expect(verticalSize(1080, 1920)).toEqual({ width: 1080, height: 1920 })
    expect(verticalSize(2160, 3840)).toEqual({ width: 1080, height: 1920 })
  })
})
