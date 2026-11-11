import { describe, expect, it } from 'vitest'

import { coverMs, withCover } from './cover'

describe('every video its own cover (his ask, 2026-11-11)', () => {
  it('a different moment for every video and account, never the start or the very end', () => {
    const seen = new Set<number>()
    for (let i = 0; i < 300; i++) {
      for (const account of ['ig-1', 'ig-2']) {
        const ms = coverMs(`post-${i}`, account, 25.5)
        expect(ms).toBeGreaterThanOrEqual(25_500 * 0.12 - 1)
        expect(ms).toBeLessThanOrEqual(25_500 * 0.88 + 1)
        seen.add(ms)
      }
    }
    // 600 covers, practically all different moments.
    expect(seen.size).toBeGreaterThan(590)
  })

  it('the same one every time the same video is sent again', () => {
    expect(coverMs('post-1', 'ig-1', 30)).toBe(coverMs('post-1', 'ig-1', 30))
    expect(coverMs('post-1', 'ig-1', 30)).not.toBe(coverMs('post-1', 'ig-2', 30))
  })

  it('spread over the whole video, not bunched', () => {
    const quarters = [0, 0, 0, 0]
    for (let i = 0; i < 400; i++) {
      const share = (coverMs(`p${i}`, 'a', 20) / 20_000 - 0.12) / 0.76
      quarters[Math.min(3, Math.floor(share * 4))]++
    }
    for (const q of quarters) expect(q).toBeGreaterThan(60)
  })

  it('without a known length: within its first seconds, still past the start', () => {
    const ms = coverMs('p', 'a', null)
    expect(ms).toBeGreaterThanOrEqual(800)
    expect(ms).toBeLessThanOrEqual(6000)
  })

  it('goes to Postiz with the video', () => {
    expect(withCover({ id: 'm1', path: 'https://uploads.postiz.com/x.mp4' }, 'p', 'a', 10)).toEqual({
      id: 'm1',
      path: 'https://uploads.postiz.com/x.mp4',
      thumbnailTimestamp: coverMs('p', 'a', 10),
    })
  })
})
