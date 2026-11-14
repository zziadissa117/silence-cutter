// A dropped clip cut like his talking videos - or, from the drop-in checklist
// (his ask, 2026-11-14), only heard and kept as he cut it; and a clip with no
// talking in it (a step he only shows) kept as filmed instead of failing.

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SilenceCutError } from '../media/errors'

const listened: { keepWhole?: boolean; quietIsFine?: boolean }[] = []
let heard: { text: string; start: number; end: number }[] = []
let quiet = false
vi.mock('./pipeline', () => ({
  listen: vi.fn(async (_file: Blob, _settings: unknown, options: { keepWhole?: boolean; quietIsFine?: boolean }) => {
    listened.push({ keepWhole: options.keepWhole, quietIsFine: options.quietIsFine })
    if (quiet && !options.quietIsFine) throw new SilenceCutError('Nothing loud enough to be talking.')
    return { keep: quiet && !options.keepWhole ? [] : [{ start: 1, end: 3 }], words: quiet ? [] : heard, duration: 4, aligned: true }
  }),
}))
const rendered: unknown[] = []
vi.mock('./render', () => ({
  renderCampaignCut: vi.fn(async () => {
    rendered.push(1)
    return { blob: new Blob(['cut'], { type: 'video/mp4' }) }
  }),
}))
vi.mock('./moments', () => ({ wordMoments: () => ({ brand: [] }) }))
vi.mock('./captions', () => ({
  captionWords: (words: { text: string; start: number; end: number }[], keep: { start: number; end: number }[]) =>
    words.filter((w) => keep.some((k) => w.start >= k.start && w.end <= k.end)),
  cutTime: (t: number, keep: { start: number }[]) => t - keep[0].start,
}))

import { cutDropped, videoType } from './prepareDrop'

const how = { settings: { thresholdDb: -40, minSilenceSec: 0.3 }, cleanSpeech: true, voice: true, names: [] } as unknown as Parameters<typeof cutDropped>[1]
const recording = new Blob(['raw'], { type: 'video/quicktime' })

beforeEach(() => {
  listened.length = 0
  rendered.length = 0
  quiet = false
  heard = [
    { text: 'open', start: 1.2, end: 1.5 },
    { text: 'the', start: 1.6, end: 1.7 },
    { text: 'app', start: 1.8, end: 2.1 },
  ]
})

describe('a dropped clip', () => {
  it('cut like his talking videos: its words on the cut clip’s own clock', async () => {
    const out = await cutDropped(recording, how)
    expect(out.cut).toBe(true)
    expect(rendered).toHaveLength(1)
    expect(out.text).toBe('open the app')
    expect(out.words[0].start).toBeCloseTo(0.2)
  })

  it('"Cut the clips" off: only heard - the recording itself, its words on its own clock, nothing cut', async () => {
    const out = await cutDropped(recording, { ...how, asFilmed: true })
    expect(out).toMatchObject({ blob: recording, cut: false, text: 'open the app' })
    expect(out.words[0].start).toBeCloseTo(1.2)
    expect(rendered).toHaveLength(0)
    expect(listened).toEqual([{ keepWhole: true, quietIsFine: true }])
  })

  it('no talking in it (a step he only shows): kept as filmed with no words - never a failure', async () => {
    quiet = true
    const out = await cutDropped(recording, how)
    expect(out).toMatchObject({ blob: recording, cut: false, words: [], text: '' })
    expect(rendered).toHaveLength(0)
  })

  it('a clip kept as he gave it keeps a video type', () => {
    expect(videoType('IMG_1.MOV', '')).toBe('video/quicktime')
    expect(videoType('a.mp4', 'application/octet-stream')).toBe('video/mp4')
    expect(videoType('a.mov', 'video/quicktime')).toBe('video/quicktime')
  })
})
