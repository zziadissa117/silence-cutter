import { describe, expect, it } from 'vitest'

import { cutNoise, cutOut, loneSounds, peaksOf, protectWords, putBack } from './noiseCuts'

const r = (start: number, end: number) => ({ start, end })

describe('protectWords (a heard word is never cut)', () => {
  it('leaves everything alone when no word is being cut', () => {
    const out = protectWords([r(0, 2), r(3, 5)], [{ start: 0.5, end: 0.9 }, { start: 3.5, end: 4 }], [], 6)
    expect(out.keep).toEqual([r(0, 2), r(3, 5)])
    expect(out.broughtBack).toBe(0)
  })
  it('brings back a word that sat in a cut', () => {
    const out = protectWords([r(0, 2), r(4, 6)], [{ start: 2.4, end: 2.8 }], [], 6)
    expect(out.broughtBack).toBe(1)
    const covers = out.keep.some((k) => k.start <= 2.4 && k.end >= 2.8)
    expect(covers).toBe(true)
  })
  it('brings back the half of a word that was clipped', () => {
    const out = protectWords([r(0, 2), r(4, 6)], [{ start: 1.8, end: 2.3 }], [], 6)
    expect(out.keep.some((k) => k.start <= 1.8 && k.end >= 2.3)).toBe(true)
  })
  it('leaves out a word he asked to have cut (an um)', () => {
    const out = protectWords([r(0, 2), r(4, 6)], [{ start: 2.4, end: 2.8 }], [r(2.3, 2.9)], 6)
    expect(out.broughtBack).toBe(0)
    expect(out.keep).toEqual([r(0, 2), r(4, 6)])
  })
  it('stays inside the recording', () => {
    const out = protectWords([r(1, 2)], [{ start: 0.02, end: 0.5 }], [], 3)
    expect(out.keep[0].start).toBeGreaterThanOrEqual(0)
  })
})

describe('loneSounds', () => {
  it('lists only the kept parts with no word in them', () => {
    const found = loneSounds([r(0, 2), r(3, 3.5), r(5, 6)], [{ start: 0.5, end: 1 }, { start: 5.2, end: 5.6 }])
    expect(found.map((c) => c.range)).toEqual([r(3, 3.5)])
  })
})

describe('cutNoise', () => {
  const keep = [r(0, 3), r(4, 4.2), r(5, 5.8), r(7, 11), r(12, 20)]
  const words = [{ start: 0.5, end: 1 }, { start: 14, end: 15 }]
  const lone = loneSounds(keep, words)

  it('cuts a short lone sound and lists it', () => {
    const sub = [r(0, 3), r(4, 4.2), r(12, 20)]
    const out = cutNoise(sub, loneSounds(sub, words), new Set())
    expect(out.keep).toEqual([r(0, 3), r(12, 20)])
    expect(out.checks.find((c) => c.kind === 'noise')?.cut).toBe(true)
  })
  it('lists a longer one as a maybe-word, cut', () => {
    const out = cutNoise(keep, lone, new Set())
    const maybe = out.checks.find((c) => c.kind === 'maybe-word')
    expect(maybe).toMatchObject({ start: 5, end: 5.8, cut: true })
  })
  it('never cuts a long sound, only points it out', () => {
    const out = cutNoise(keep, lone, new Set())
    expect(out.keep.some((k) => k.start === 7 && k.end === 11)).toBe(true)
    expect(out.checks.find((c) => c.kind === 'long-sound')).toMatchObject({ start: 7, end: 11, cut: false })
  })
  it('keeps a stretch the model found a word in on its second listen', () => {
    const idx = lone.findIndex((c) => c.range.start === 5)
    const out = cutNoise(keep, lone, new Set([idx]))
    expect(out.keep.some((k) => k.start === 5)).toBe(true)
    expect(out.checks.some((c) => c.start === 5)).toBe(false)
  })
  it('does not list a click too short to be heard, but does cut it', () => {
    const out = cutNoise([r(0, 5), r(6, 6.05)], [{ range: r(6, 6.05), part: 1 }], new Set())
    expect(out.keep).toEqual([r(0, 5)])
    expect(out.checks).toEqual([])
  })
  it('cuts nothing when it would take out most of the video', () => {
    const out = cutNoise([r(0, 1), r(2, 3), r(4, 5)], loneSounds([r(0, 1), r(2, 3), r(4, 5)], []), new Set())
    expect(out.cut).toBe(0)
    expect(out.keep).toHaveLength(3)
    expect(out.note).toBeTruthy()
  })
})

describe('putBack', () => {
  it('joins the stretch to its neighbours', () => {
    expect(putBack([r(0, 2), r(3, 5)], r(2, 3))).toEqual([r(0, 5)])
  })
})

describe('peaksOf', () => {
  it('turns loudness into bars from 0 to 1', () => {
    const bars = peaksOf([{ time: 0.05, db: 0 }, { time: 0.55, db: -30 }, { time: 0.6, db: -120 }], 1, 2)
    expect(bars).toEqual([1, 0.5])
  })
})

describe('cutOut', () => {
  it('takes a stretch out of the middle of a part', () => {
    expect(cutOut([r(0, 10)], r(4, 6))).toEqual([r(0, 4), r(6, 10)])
  })
  it('never leaves nothing kept', () => {
    expect(cutOut([r(0, 2)], r(0, 2))).toEqual([r(0, 2)])
  })
})
