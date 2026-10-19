import { describe, expect, it } from 'vitest'

import { liftMusic, musicTrack, soloMusicGain, verticalSize } from './montageRender'

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

describe('the music on a batch video', () => {
  it('is one unbroken track to the very end, whatever the cuts', async () => {
    const rate = 48000
    const read: number[] = []
    const written: { start: number; frames: number; value: number }[] = []
    // A "song" that is just its own position, so a jump or a hole shows.
    const bed = {
      mixInto(planes: Float32Array[], first: number) {
        read.push(first)
        for (const plane of planes) for (let i = 0; i < plane.length; i++) plane[i] += ((first + i) % 1000) / 1000
      },
    }
    const soundTo = musicTrack(bed, async (sample) => {
      const plane = new Float32Array(sample.numberOfFrames)
      sample.copyTo(plane, { planeIndex: 0, format: 'f32-planar' })
      written.push({ start: Math.round(sample.timestamp * rate), frames: sample.numberOfFrames, value: plane[0] })
    })
    // Frames of three clips of uneven lengths, then the very end.
    for (const end of [0.033, 0.5, 0.517, 1.01, 1.043, 1.75, 1.783]) await soundTo(end)
    await soundTo(1.8)
    let next = 0
    for (const piece of written) {
      expect(piece.start).toBe(next)
      expect(piece.value).toBeCloseTo((piece.start % 1000) / 1000, 5)
      next += piece.frames
    }
    expect(next).toBe(Math.round(1.8 * rate))
    // Asked again for less: nothing written twice.
    await soundTo(1.2)
    expect(written.reduce((n, p) => n + p.frames, 0)).toBe(Math.round(1.8 * rate))
  })
})
