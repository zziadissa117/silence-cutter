import { describe, expect, it } from 'vitest'

import { QUIET_DAYS, campaignViews, shortNumber, stepFrom, suggestRate, weekChange, type AccountViews, type CampaignViews } from './analytics'

const days = (from: string, values: number[]) =>
  values.map((perVideo, i) => {
    const d = new Date(`${from}T12:00:00Z`)
    d.setUTCDate(d.getUTCDate() + i)
    return { date: d.toISOString().slice(0, 10), perVideo }
  })

const account = (history: { date: string; perVideo: number }[]): AccountViews => ({
  views: null,
  followers: null,
  perVideo: history.at(-1)?.perVideo ?? null,
  at: '2026-10-18T10:00:00Z',
  next: '2026-10-19T06:00:00Z',
  history,
})

describe('how views per video moved', () => {
  it('compares the latest day with the one a week before', () => {
    expect(weekChange(days('2026-10-10', [100, 0, 0, 0, 0, 0, 0, 150]))).toBeCloseTo(0.5)
  })

  it('takes the reading closest to a week back when that day is missing', () => {
    const history = [
      { date: '2026-10-08', perVideo: 400 },
      { date: '2026-10-12', perVideo: 200 },
      { date: '2026-10-18', perVideo: 300 },
    ]
    // 6 days back (200) is closer to a week than 10 (400).
    expect(weekChange(history)).toBeCloseTo(0.5)
  })

  it('has no trend before there is a reading 5 days back', () => {
    expect(weekChange(days('2026-10-15', [100, 120, 130, 140]))).toBeNull()
    expect(weekChange([])).toBeNull()
  })
})

describe("a campaign's accounts together", () => {
  it('averages their views per video, and their trend day by day', () => {
    const views = {
      tt: account(days('2026-10-11', [100, 100, 100, 100, 100, 100, 100, 200])),
      ig: account(days('2026-10-11', [300, 300, 300, 300, 300, 300, 300, 400])),
    }
    const stats = campaignViews(['tt', 'ig', 'yt'], views)
    expect(stats.perVideo).toBe(300)
    // (200 + 400) / 2 against (100 + 300) / 2.
    expect(stats.change).toBeCloseTo(0.5)
    expect([stats.read, stats.total]).toEqual([2, 3])
  })

  it('has nothing before any account was read', () => {
    expect(campaignViews(['tt'], {})).toEqual({ perVideo: null, change: null, read: 0, total: 1 })
  })
})

describe('suggesting a new videos a day', () => {
  const stats = (perVideo: number | null, change: number | null): CampaignViews => ({ perVideo, change, read: 1, total: 1 })
  const NOW = Date.parse('2026-10-18T12:00:00Z')

  it('suggests one more a day when views per video are up a fifth on last week', () => {
    expect(suggestRate({ perDay: 2, running: true, stats: stats(1240, 0.35), now: NOW })).toEqual({
      from: 2,
      to: 3,
      why: 'Views per video up 35% on last week (1,240 views a video).',
    })
  })

  it('suggests more when at or above his number, even with no trend yet', () => {
    const s = suggestRate({ perDay: 6, running: true, stats: stats(1500, null), target: 1000, now: NOW })
    expect(s).toEqual({ from: 6, to: 8, why: '1,500 views a video - at or above your 1,000 views.' })
  })

  it('suggests one fewer when views fall away, unless still at his number', () => {
    expect(suggestRate({ perDay: 4, running: true, stats: stats(300, -0.4), now: NOW })?.to).toBe(3)
    expect(suggestRate({ perDay: 4, running: true, stats: stats(1300, -0.4), target: 1000, now: NOW })).toBeNull()
  })

  it('says nothing when views hold steady, for a batch not running, or without numbers', () => {
    expect(suggestRate({ perDay: 4, running: true, stats: stats(800, 0.05), now: NOW })).toBeNull()
    expect(suggestRate({ perDay: 4, running: false, stats: stats(800, 0.5), now: NOW })).toBeNull()
    expect(suggestRate({ perDay: 0, running: true, stats: stats(800, 0.5), now: NOW })).toBeNull()
    expect(suggestRate({ perDay: 4, running: true, stats: stats(null, null), now: NOW })).toBeNull()
  })

  it('leaves a campaign alone for a few days after he answered', () => {
    const answered = NOW - (QUIET_DAYS - 1) * 86_400_000
    expect(suggestRate({ perDay: 2, running: true, stats: stats(1000, 0.5), answeredAt: answered, now: NOW })).toBeNull()
    const longAgo = NOW - (QUIET_DAYS + 1) * 86_400_000
    expect(suggestRate({ perDay: 2, running: true, stats: stats(1000, 0.5), answeredAt: longAgo, now: NOW })?.to).toBe(3)
  })

  it('steps slowly - one a day, two past five - and never past 25 or under 1', () => {
    expect([stepFrom(1, true), stepFrom(4, true), stepFrom(5, true), stepFrom(24, true), stepFrom(25, true)]).toEqual([2, 5, 7, 25, 25])
    expect([stepFrom(8, false), stepFrom(5, false), stepFrom(1, false)]).toEqual([6, 4, 1])
    expect(suggestRate({ perDay: 25, running: true, stats: stats(5000, 0.9), now: NOW })).toBeNull()
  })
})

describe('numbers short enough for a phone row', () => {
  it('reads like the platforms write them', () => {
    expect([shortNumber(null), shortNumber(950), shortNumber(1240), shortNumber(35_400), shortNumber(2_100_000)]).toEqual(['-', '950', '1.2K', '35K', '2.1M'])
  })
})
