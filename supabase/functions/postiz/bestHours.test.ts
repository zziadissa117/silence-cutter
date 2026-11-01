import { describe, expect, it } from 'vitest'

import { MIN_VIDEOS, bestRuns, dayOfWeek, hoursOn, learnHours, parseHours, weekHour, type HourVideo } from './bestHours.ts'

const TZ = 'America/Toronto'
const NOW = Date.parse('2026-11-01T12:00:00Z')

/** Videos over the last month, every hour of every day, two campaigns; at
 *  `good` hours (any day) or on `goodDay` at `goodDayHour` they do 3 times better. */
function month(good: (day: number, hour: number) => boolean): HourVideo[] {
  const out: HourVideo[] = []
  for (let back = 4 * 24; back < 32 * 24; back += 2) {
    const at = new Date(NOW - back * 3_600_000)
    const { day, hour } = weekHour(at, TZ)
    for (const [campaign, usual] of [['a', 1000], ['b', 100]] as const) {
      out.push({ campaign, at: at.toISOString(), views: good(day, hour) ? usual * 3 : usual })
    }
  }
  return out
}

describe('learnHours', () => {
  it('nothing until enough videos are read', () => {
    expect(learnHours(month(() => false).slice(0, MIN_VIDEOS - 1), { now: NOW, tz: TZ })).toBeNull()
  })

  it('weighs up the good hours of every day, a day at a time, the usual at 1', () => {
    const best = learnHours(month((_, hour) => hour >= 13 && hour < 16), { now: NOW, tz: TZ })!
    expect(best.weights).toHaveLength(7)
    for (const day of best.weights) {
      expect(day).toHaveLength(24)
      expect(day.reduce((a, b) => a + b, 0) / 24).toBeCloseTo(1, 1)
      expect(Math.max(...day)).toBeLessThanOrEqual(2)
      expect(Math.min(...day)).toBeGreaterThanOrEqual(0.5)
      expect(day[14]).toBeGreaterThan(1.3)
      expect(day[4]).toBeLessThan(1)
    }
  })

  it("one day's own good hours show on that day more than on the others", () => {
    const best = learnHours(month((day, hour) => day === 2 && hour >= 20 && hour < 23), { now: NOW, tz: TZ })!
    expect(best.weights[2][21]).toBeGreaterThan(best.weights[5][21] + 0.3)
  })

  it('leaves out videos too new to have their views, and too old', () => {
    const fresh = month(() => false).map((v) => ({ ...v, at: new Date(NOW - 3_600_000).toISOString() }))
    expect(learnHours(fresh, { now: NOW, tz: TZ })).toBeNull()
  })
})

describe('reading them back', () => {
  it('a date takes its day of the week; off or not learnt is none', () => {
    const weights = Array.from({ length: 7 }, (_, d) => Array.from({ length: 24 }, () => d + 1))
    expect(dayOfWeek('2026-11-01')).toBe(0)
    expect(hoursOn({ weights, videos: 200, at: '' }, '2026-11-03')![0]).toBe(3)
    expect(hoursOn({ weights, videos: 200, at: '', off: true }, '2026-11-03')).toBeUndefined()
    expect(hoursOn(null, '2026-11-03')).toBeUndefined()
    expect(parseHours('nonsense')).toBeNull()
    expect(parseHours(JSON.stringify({ weights, videos: 200, at: 'x' }))!.videos).toBe(200)
  })

  it('the best hours as runs', () => {
    const day = Array.from({ length: 24 }, (_, h) => (h >= 13 && h < 16 ? 1.8 : h === 21 ? 1.4 : 0.9))
    expect(bestRuns(day)).toEqual([{ from: 13, to: 16 }, { from: 21, to: 22 }])
  })
})
