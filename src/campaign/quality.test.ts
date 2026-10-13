import { describe, expect, it } from 'vitest'

import { SHORT_HD, SHORT_4K, makeSize, videoBitrate } from './quality'
import { outputSize } from './overlay'

describe('how sharp a made video is', () => {
  it('gets about what the phone itself records at, not ~6 Mbps', () => {
    const mbps = (w: number, h: number, fps: number) => Math.round(videoBitrate(w, h, fps) / 1e6)
    expect(mbps(1080, 1920, 30)).toBe(10)
    expect(mbps(1080, 1920, 60)).toBe(16)
    expect(mbps(2160, 3840, 30)).toBe(28)
    expect(mbps(2160, 3840, 60)).toBe(45)
  })

  it('falls back to 1080p when the phone can\'t encode 4K', async () => {
    const size = (maxShort: number) => outputSize(2160, 3840, maxShort)
    expect(SHORT_4K).toBe(2160)
    // jsdom has no encoder, so "can it" is no - and it falls back to 1080p.
    expect(await makeSize(size, 60)).toEqual({ width: 1080, height: 1920 })
  })

  it('a second go after the first failed is made in 1080p', async () => {
    expect(await makeSize((maxShort) => outputSize(2160, 3840, maxShort), 60, true)).toEqual({ width: SHORT_HD, height: 1920 })
  })

  it('a 1080p take is never asked about 4K', async () => {
    expect(await makeSize((maxShort) => outputSize(1080, 1920, maxShort), 60)).toEqual({ width: 1080, height: 1920 })
  })
})
