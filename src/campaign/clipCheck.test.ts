import { describe, expect, it } from 'vitest'

import { madeWith } from './batch'
import { frameTiming } from './clipCheck'

describe('what a clip file is made of', () => {
  it('reads an even 30 fps file stored in order', () => {
    const packets = Array.from({ length: 60 }, (_, k) => ({ timestamp: k / 30, duration: 1 / 30, key: k % 30 === 0 }))
    expect(frameTiming(packets)).toMatchObject({ frames: 60, fps: 30, uneven: 0, reordered: false, statedMs: 33.3, keyFrames: 2 })
  })
  it('sees frames stored out of order, held ones, and a stated length that is wrong', () => {
    // B-frames: shown 0, 2, 1, 3... stored 0, 2, 1; one frame missing at 10.
    const shown = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12].map((k) => k / 30)
    const stored = [shown[0], shown[2], shown[1], ...shown.slice(3)]
    const timing = frameTiming(stored.map((timestamp) => ({ timestamp, duration: 0.1, key: false })))
    expect(timing.reordered).toBe(true)
    expect(timing.uneven).toBe(1)
    expect(timing.gapMs.max).toBeCloseTo(66.7, 1)
    expect(timing.statedMs).toBe(100)
  })
})

describe('the videos made with a clip', () => {
  const post = (fileName: string, status: string, campaignId = 'c1') => ({ campaignId, fileName, status, batch: { id: 'b' } })
  const posts = [
    post('IMG_0250 + IMG_0323 + song.mp4', 'rejected'),
    post('IMG_0250 + IMG_0325 + song.mp4', 'rejected'),
    post('IMG_0248 + IMG_0250 + song.mp4', 'scheduled'),
    post('IMG_0250 + IMG_0331 + song.mp4', 'posted', 'c2'),
    { campaignId: 'c1', fileName: 'IMG_0250 talking.mp4', status: 'rejected', batch: null },
  ]
  it('counts a reaction by the first file a video was made of, in its campaign and batches only', () => {
    expect(madeWith(posts, 'c1', 'IMG_0250.MOV', true)).toEqual({ made: 2, rejected: 2 })
  })
  it('counts a product clip by the files after it', () => {
    expect(madeWith(posts, 'c1', 'IMG_0250.MOV', false)).toEqual({ made: 1, rejected: 0 })
    expect(madeWith(posts, 'c1', 'IMG_0323.mov', false)).toEqual({ made: 1, rejected: 1 })
  })
})
