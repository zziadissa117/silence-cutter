import { describe, expect, it } from 'vitest'

import { KEEP_DAYS, REFRESH_HOURS, RETRY_HOURS, dueAt, fillPerVideo, notRead, parseCache, readViews, remember } from './views'

const today = '2026-10-18'
const NOW = new Date(`${today}T12:00:00Z`)

describe('views per video, from what Postiz says', () => {
  it("TikTok: its last 20 videos' views over how many it has, at most 20", () => {
    const tiktok = [
      { label: 'Followers', data: [{ total: '3200', date: today }] },
      { label: 'Videos', data: [{ total: '57', date: today }] },
      { label: 'Views', data: [{ total: '25000', date: today }] },
    ]
    expect(readViews('tiktok', tiktok, 0)).toEqual({ views: 25000, followers: 3200, perVideo: 1250 })
    // A new account with 5 videos: over 5, not 20.
    const fresh = [
      { label: 'Videos', data: [{ total: 5, date: today }] },
      { label: 'Views', data: [{ total: 1000, date: today }] },
    ]
    expect(readViews('tiktok-business', fresh, 0).perVideo).toBe(200)
  })

  it("Instagram and the rest: the week's views over the videos posted there that week", () => {
    const instagram = [
      { label: 'Follower Count', data: [{ total: 10, date: '2026-10-16' }, { total: 14, date: '2026-10-17' }] },
      { label: 'Reach', data: [{ total: 300, date: '2026-10-17' }] },
      { label: 'Views', data: [{ total: 9000, date: today }] },
    ]
    expect(readViews('instagram', instagram, 6)).toEqual({ views: 9000, followers: 14, perVideo: 1500 })
    // A week of days, added up.
    const youtube = [{ label: 'Views', data: [{ total: '100', date: '2026-10-16' }, { total: '300', date: '2026-10-17' }] }]
    expect(readViews('youtube', youtube, 2).perVideo).toBe(200)
  })

  it('has no views per video when nothing was posted there, or no views came back', () => {
    expect(readViews('instagram', [{ label: 'Views', data: [{ total: 900, date: today }] }], 0).perVideo).toBeNull()
    expect(readViews('tiktok', [], 0)).toEqual({ views: null, followers: null, perVideo: null })
    expect(readViews('tiktok', { error: 'nope' }, 0).perVideo).toBeNull()
  })
})

describe('keeping one reading a day', () => {
  it("adds today's, replacing an earlier one of today, and lets old ones go", () => {
    const old = new Date(NOW.getTime() - (KEEP_DAYS + 1) * 86_400_000).toISOString().slice(0, 10)
    const before = {
      views: 1,
      followers: 1,
      perVideo: 100,
      at: '2026-10-18T01:00:00Z',
      next: '2026-10-18T21:00:00Z',
      history: [
        { date: old, perVideo: 50 },
        { date: '2026-10-17', perVideo: 90 },
        { date: today, perVideo: 100 },
      ],
    }
    const after = remember(before, { views: 2, followers: 2, perVideo: 120 }, NOW)
    expect(after.history).toEqual([
      { date: '2026-10-17', perVideo: 90 },
      { date: today, perVideo: 120 },
    ])
    expect(dueAt(after)).toBe(NOW.getTime() + REFRESH_HOURS * 3_600_000)
  })

  it('keeps the last good numbers when a read fails, and tries again a few hours later', () => {
    const good = remember(undefined, { views: 10, followers: 5, perVideo: 300 }, new Date('2026-10-17T12:00:00Z'))
    const after = notRead(good, 'Postiz had a problem (502).', NOW)
    expect(after.perVideo).toBe(300)
    expect(after.at).toBe(good.at)
    expect(after.error).toContain('502')
    expect(dueAt(after)).toBe(NOW.getTime() + RETRY_HOURS * 3_600_000)
  })

  it('reads an account never read before first', () => {
    expect(dueAt(undefined)).toBe(-Infinity)
  })

  it('never trusts what was saved', () => {
    expect(parseCache(null)).toEqual({ accounts: {} })
    expect(parseCache('nope')).toEqual({ accounts: {} })
    expect(parseCache('{"accounts":{"a":{"perVideo":1}}}').accounts.a.perVideo).toBe(1)
  })
})

describe('an account read before the count of its videos worked', () => {
  const read = { views: 17070, followers: null, perVideo: null, at: '2026-10-22T09:20:02.281Z', next: '2026-10-23T05:20:02.281Z', history: [] }

  it('gets its views per video from the videos posted there, kept for the day it was read', () => {
    expect(fillPerVideo(read, 'instagram', 23)).toMatchObject({ perVideo: 742, history: [{ date: '2026-10-22', perVideo: 742 }] })
  })

  it('is left alone when it has one, is TikTok, or nothing was posted there', () => {
    expect(fillPerVideo({ ...read, perVideo: 500 }, 'instagram', 23).perVideo).toBe(500)
    expect(fillPerVideo(read, 'tiktok', 23)).toBe(read)
    expect(fillPerVideo(read, 'instagram', 0)).toBe(read)
  })
})
