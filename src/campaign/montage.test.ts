import { describe, expect, it } from 'vitest'

import { BATCH_LOWER, FPS, clipPlace, framesBy, liftMusic, lowered, montageSize, musicTrack, soloMusicGain, verticalSize } from './montageRender'
import type { HeadlineLayout } from './overlay'

/** Which of the clips' frames each steady frame shows: frames given as
 *  [start, duration], in order, as the render gets them - each steady frame
 *  before one starts shows the one before it, the last runs to its end. */
function steady(frames: [number, number][], fps = FPS): number[] {
  const shown: number[] = []
  let made = 0
  frames.forEach(([start], k) => {
    for (const by = framesBy(start, fps); made < by; made++) shown.push(Math.max(0, k - 1))
  })
  const [start, duration] = frames[frames.length - 1]
  for (const by = framesBy(start + duration, fps); made < by; made++) shown.push(frames.length - 1)
  return shown
}

describe('a steady frame rate', () => {
  it('draws one of every two frames of a 60 fps clip', () => {
    const sixty = Array.from({ length: 12 }, (_, k): [number, number] => [k / 60, 1 / 60])
    expect(steady(sixty)).toEqual([0, 2, 4, 6, 8, 10])
  })
  it('draws a 15 fps clip twice over', () => {
    const fifteen = Array.from({ length: 3 }, (_, k): [number, number] => [k / 15, 1 / 15])
    expect(steady(fifteen)).toEqual([0, 0, 1, 1, 2, 2])
  })
  it('starts at the first moment even when the first frame comes late, and holds a long one', () => {
    // A first frame at 0.1 s lasting 0.2 s, then ordinary ones.
    const uneven: [number, number][] = [[0.1, 0.2], [0.3, 1 / 30], [0.3333, 1 / 30]]
    expect(steady(uneven)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2])
  })
  it("goes by when each frame starts, never by how long a file says it lasts", () => {
    // Frames a 30th of a second apart that each claim a tenth: none skipped.
    const claimed = Array.from({ length: 6 }, (_, k): [number, number] => [k / 30, 0.1])
    expect(steady(claimed).slice(0, 6)).toEqual([0, 1, 2, 3, 4, 5])
  })
  it('carries on across clips with no frame twice or missing', () => {
    // A clip ending at 0.51 s, then the next from there.
    const first = Array.from({ length: 17 }, (_, k): [number, number] => [k * 0.03, 0.03])
    const next = Array.from({ length: 10 }, (_, k): [number, number] => [0.51 + k / 30, 1 / 30])
    const shown = steady([...first, ...next])
    expect(shown).toHaveLength(framesBy(0.51 + 10 / 30, FPS))
    expect(shown.indexOf(17)).toBe(16)
  })
})

describe("a batch video's words", () => {
  const layout = (top: number, lines = 2): HeadlineLayout => ({
    lines: Array.from({ length: lines }, () => ({ text: 'x', width: 10 })),
    font: '',
    fontPx: 60,
    centerX: 540,
    top,
    baselineOffset: 40,
    lineHeight: 70,
    style: 'outline',
    outlineColor: '#000000',
    outlineWidth: 'normal',
  })
  it('sit a little lower than the headline', () => {
    expect(lowered(layout(300), 1920)?.top).toBeCloseTo(300 + 1920 * BATCH_LOWER)
  })
  it('never into the caption at the bottom', () => {
    // Two lines of 70 px; the caption starts at 80% of 1920 = 1536.
    expect(lowered(layout(1380), 1920)?.top).toBeCloseTo(1536 - 140)
    expect(lowered(layout(1450), 1920)?.top).toBe(1450)
    expect(lowered(null, 1920)).toBeNull()
  })
})

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

describe('a wide clip in a batch (his ask, 2026-11-13: "it keeps being horizontal, and that\'s it")', () => {
  it('is shown whole across the middle, nothing cut off', () => {
    const placed = clipPlace(1920, 1080, 1080, 1920)
    expect(placed.whole).toBe(true)
    expect(placed.box.width).toBe(1080)
    expect(placed.box.height).toBeCloseTo(607.5, 1)
    expect(placed.box.x).toBe(0)
    expect(placed.box.y).toBeCloseTo((1920 - 607.5) / 2, 1)
    // Square and 3:4 (Meta glasses) too.
    expect(clipPlace(1080, 1080, 1080, 1920).whole).toBe(true)
    expect(clipPlace(1440, 1920, 1080, 1920).whole).toBe(true)
  })

  it('a phone video still fills the frame, as before', () => {
    expect(clipPlace(1080, 1920, 1080, 1920)).toEqual({ box: { x: 0, y: 0, width: 1080, height: 1920 }, whole: false })
    // A taller phone screen recording: filled, its ends trimmed.
    const tall = clipPlace(1170, 2532, 1080, 1920)
    expect(tall.whole).toBe(false)
    expect(tall.box.width).toBeCloseTo(1080, 0)
    expect(tall.box.height).toBeGreaterThan(1920)
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

describe('a talking batch', () => {
  it('writes his voice, with the music under it', async () => {
    const rate = 48000
    const voice = [new Float32Array(rate).fill(0.25), new Float32Array(rate).fill(0.25)]
    const bed = { mixInto: (planes: Float32Array[]) => planes.forEach((p) => p.forEach((_, i) => (p[i] += 0.1))) }
    const written: number[] = []
    const soundTo = musicTrack(bed, async (sample) => {
      const plane = new Float32Array(sample.numberOfFrames)
      sample.copyTo(plane, { planeIndex: 0, format: 'f32-planar' })
      written.push(...plane)
    }, voice)
    await soundTo(0.5)
    expect(written).toHaveLength(rate / 2)
    // Past the limiter's look-ahead: the voice and the music together.
    expect(written[written.length - 1]).toBeCloseTo(0.35, 2)
  })
})

describe("a Trial reel's frame", () => {
  it('keeps a horizontal clip horizontal, at most 1080 on its short side', () => {
    expect(montageSize(3840, 2160, true, 1080)).toEqual({ width: 1920, height: 1080 })
    expect(montageSize(1920, 1080, true, 1080)).toEqual({ width: 1920, height: 1080 })
    expect(montageSize(1080, 1920, true, 1080)).toEqual({ width: 1080, height: 1920 })
    // Any other batch video: 9:16 as always.
    expect(montageSize(1920, 1080, false, 1080)).toEqual({ width: 1080, height: 1920 })
  })
})
