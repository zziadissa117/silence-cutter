// A headline moved by hand in the edit screen - and words of his own, laid
// out the same way: where they go on the frame, how big, kept inside it; and
// the next video of the angle starting where he put the last one.

import { beforeEach, describe, expect, it } from 'vitest'

import { cleanPlace, headlinePlaceOf, rememberPlace, rememberedPlace } from './headlinePlace'
import { withHeadlinePlace, type Angle } from './look'
import { isPicture, isText, isVideo, longestFor, manualCues, textHeadline, type ManualPicture } from './manualPictures'
import { layoutHeadline } from './overlay'

/** Enough of a canvas to lay text out: every letter 10 px wide. */
const ctx = {
  font: '',
  measureText: (s: string) => ({ width: s.length * 10, fontBoundingBoxAscent: 20, fontBoundingBoxDescent: 5 }),
} as unknown as Parameters<typeof layoutHeadline>[0]

const base = { text: 'HELLO THERE', position: 'top', size: 'medium', style: 'outline' } as const
const middleOf = (l: NonNullable<ReturnType<typeof layoutHeadline>>) => ({ x: l.centerX, y: l.top + (l.lines.length * l.lineHeight) / 2 })

describe('a headline where he put it', () => {
  it('is centred on his spot instead of its position', () => {
    const left = layoutHeadline(ctx, 1080, 1920, { ...base, place: { x: 0.3, y: 0.7, scale: 1 } })!
    const middle = middleOf(left)
    expect(middle.x).toBeCloseTo(0.3 * 1080, 0)
    expect(middle.y).toBeCloseTo(0.7 * 1920, 0)
    const usual = layoutHeadline(ctx, 1080, 1920, base)!
    expect(usual.centerX).toBe(540)
    expect(usual.fontPx).toBe(left.fontPx)
  })

  it('is bigger or smaller by how much he pinched it', () => {
    const usual = layoutHeadline(ctx, 1080, 1920, base)!
    const big = layoutHeadline(ctx, 1080, 1920, { ...base, place: { x: 0.5, y: 0.5, scale: 1.5 } })!
    expect(big.fontPx).toBeCloseTo(usual.fontPx * 1.5, -1)
    // Never smaller or bigger than the range.
    const tiny = layoutHeadline(ctx, 1080, 1920, { ...base, place: { x: 0.5, y: 0.5, scale: 0.01 } })!
    expect(tiny.fontPx).toBeGreaterThanOrEqual(Math.floor(usual.fontPx * 0.4) - 1)
  })

  it('stays inside the frame when dragged to its edge', () => {
    const l = layoutHeadline(ctx, 1080, 1920, { ...base, place: { x: 0, y: 1, scale: 1 } })!
    const half = Math.max(...l.lines.map((line) => line.width)) / 2
    expect(l.centerX - half).toBeGreaterThanOrEqual(0)
    expect(l.top + l.lines.length * l.lineHeight).toBeLessThanOrEqual(1920)
  })

  it("keeps Snapchat's band across the frame: it only moves up and down", () => {
    const l = layoutHeadline(ctx, 1080, 1920, { ...base, style: 'snap', place: { x: 0.1, y: 0.6, scale: 1 } })!
    expect(l.centerX).toBe(540)
    expect(middleOf(l).y).toBeCloseTo(0.6 * 1920, 0)
  })

  it('goes on the angle only for the video it was moved on', () => {
    const angle = { id: 'a1', headline: { text: '', seconds: 4, position: 'top', style: 'box', size: 'medium' } } as unknown as Angle
    expect(withHeadlinePlace(angle, null)).toBe(angle)
    const moved = withHeadlinePlace(angle, { x: 0.5, y: 0.6, scale: 1.2 })
    expect(moved.headline.place).toEqual({ x: 0.5, y: 0.6, scale: 1.2 })
    expect(angle.headline.place).toBeUndefined()
  })
})

describe('where the next video of the angle starts', () => {
  beforeEach(() => localStorage.clear())

  it('is where he last put one, until he puts it back', () => {
    expect(rememberedPlace('a1')).toBeNull()
    rememberPlace('a1', { x: 0.4, y: 0.3, scale: 1.1 })
    expect(rememberedPlace('a1')).toEqual({ x: 0.4, y: 0.3, scale: 1.1 })
    expect(rememberedPlace('a2')).toBeNull()
    expect(headlinePlaceOf(undefined, 'a1')).toEqual({ x: 0.4, y: 0.3, scale: 1.1 })
    // A video's own place wins - "back in its spot" (null) too.
    expect(headlinePlaceOf({ headlinePlace: { x: 0.5, y: 0.5, scale: 1 } }, 'a1')).toEqual({ x: 0.5, y: 0.5, scale: 1 })
    expect(headlinePlaceOf({ headlinePlace: null }, 'a1')).toBeNull()
    rememberPlace('a1', null)
    expect(rememberedPlace('a1')).toBeNull()
  })

  it('reads back only a real place', () => {
    expect(cleanPlace(null)).toBeNull()
    expect(cleanPlace({ x: 'a', y: 1 })).toBeNull()
    expect(cleanPlace({ x: 2, y: -1, scale: 9 })).toEqual({ x: 1, y: 0, scale: 2.5 })
    expect(cleanPlace({ x: 0.5, y: 0.5 })).toEqual({ x: 0.5, y: 0.5, scale: 1 })
  })
})

describe('what he puts on a video', () => {
  const picture: ManualPicture = { id: 'p', source: { kind: 'bank', pictureId: 'b1' }, at: 1, seconds: 3, position: 'top', widthPct: 40 }
  const phoneVideo: ManualPicture = { id: 'v', source: { kind: 'phone', name: 'a.mov', type: 'video/quicktime' }, at: 2, seconds: 8, position: 'middle', widthPct: 70, length: 8 }
  const bankVideo: ManualPicture = { id: 'w', source: { kind: 'video', videoId: 'x' }, at: 2, seconds: 5, position: 'middle', widthPct: 70, length: 90 }
  const words: ManualPicture = { id: 't', source: { kind: 'text', text: 'link in bio', style: 'snap' }, at: 3, seconds: 3, position: 'middle', widthPct: 60, center: { x: 0.5, y: 0.8 } }

  it('tells a picture, a video and words apart', () => {
    expect([picture, phoneVideo, bankVideo, words].map((m) => [isPicture(m), isVideo(m), isText(m)])).toEqual([
      [true, false, false],
      [false, true, false],
      [false, true, false],
      [false, false, true],
    ])
  })

  it('lets a video stay up for its own length, at most a minute', () => {
    expect(longestFor(picture)).toBe(20)
    expect(longestFor(phoneVideo)).toBe(8)
    expect(longestFor(bankVideo)).toBe(60)
  })

  it('makes words a headline at his spot and size, and nothing for none typed', () => {
    expect(textHeadline(words)).toEqual({ text: 'link in bio', style: 'snap', position: 'middle', size: 'medium', place: { x: 0.5, y: 0.8, scale: 1.5 } })
    expect(textHeadline({ ...words, source: { kind: 'text', text: '  ', style: 'box' } })).toBeNull()
    expect(textHeadline(picture)).toBeNull()
  })

  it("draws only pictures as the look's pictures", () => {
    const image = new Blob(['x'])
    const { cues } = manualCues([picture, phoneVideo, bankVideo, words], new Map([['p', image], ['v', image], ['w', image]]))
    expect(cues.map((c) => c.id)).toEqual(['p'])
  })
})
