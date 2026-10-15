import { describe, expect, it } from 'vitest'

import { MAX_BITRATE, SHORT_HD, makeSize, videoBitrate } from './quality'
import { outputSize } from './overlay'

describe('how a posted video is made', () => {
  it('gets about what the phone itself records at, not ~6 Mbps', () => {
    const mbps = (w: number, h: number, fps: number) => Math.round(videoBitrate(w, h, fps) / 1e6)
    expect(mbps(1080, 1920, 30)).toBe(10)
    expect(mbps(1080, 1920, 60)).toBe(16)
  })

  it("never goes over Instagram's 25 Mbps", () => {
    expect(videoBitrate(2160, 3840, 60)).toBe(MAX_BITRATE)
    expect(MAX_BITRATE).toBeLessThan(25_000_000)
  })

  it('a 4K take is posted at 1080×1920 - no wider than Instagram takes', () => {
    const made = makeSize((maxShort) => outputSize(2160, 3840, maxShort))
    expect(made).toEqual({ width: SHORT_HD, height: 1920 })
    expect(made.width).toBeLessThanOrEqual(1920)
  })

  it('a 1080p take stays 1080p', () => {
    expect(makeSize((maxShort) => outputSize(1080, 1920, maxShort))).toEqual({ width: 1080, height: 1920 })
  })
})
