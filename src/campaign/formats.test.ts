import { describe, expect, it } from 'vitest'

import { perDayCounts, spreadOver } from './formats'
import type { CampaignPlace } from './posting'

const place: CampaignPlace = { accounts: ['tt'], times: ['12:00', '15:00', '18:00'] }
const MORNING = new Date(2026, 9, 19, 8, 0) // a Monday
const NIGHT = new Date(2026, 9, 19, 21, 30)

describe('spreading a format over the days', () => {
  it('shares the videos out as evenly as it can, starting on the first day', () => {
    expect(perDayCounts(4, 7)).toEqual([1, 1, 0, 1, 0, 1, 0])
    expect(perDayCounts(7, 7)).toEqual([1, 1, 1, 1, 1, 1, 1])
    expect(perDayCounts(10, 5)).toEqual([2, 2, 2, 2, 2])
    expect(perDayCounts(3, 5)).toEqual([1, 1, 0, 1, 0])
  })

  it('puts a week of videos on the campaign times, from today', () => {
    const slots = spreadOver({ count: 7, days: 7, place, campaignId: 'c', now: MORNING })
    expect(slots).toHaveLength(7)
    expect(slots[0].date).toBe('2026-10-19')
    expect(new Set(slots.map((s) => s.date)).size).toBe(7)
    expect(slots.every((s) => place.times.includes(s.time))).toBe(true)
  })

  it('starts tomorrow when today has no time left an hour ahead', () => {
    const slots = spreadOver({ count: 5, days: 5, place, campaignId: 'c', now: NIGHT })
    expect(slots[0].date).toBe('2026-10-20')
    expect(slots.at(-1)!.date).toBe('2026-10-24')
  })

  it('keeps clear of the times a day already holds', () => {
    const slots = spreadOver({ count: 7, days: 7, place, campaignId: 'c', now: MORNING, taken: (d) => (d === '2026-10-20' ? ['12:00'] : []) })
    const tuesday = slots.find((s) => s.date === '2026-10-20')!
    const at = Number(tuesday.time.slice(0, 2)) * 60 + Number(tuesday.time.slice(3, 5))
    expect(Math.abs(at - 12 * 60)).toBeGreaterThanOrEqual(20)
  })

  it('gives every video a time, more a day when there are many', () => {
    const slots = spreadOver({ count: 12, days: 5, place, campaignId: 'c', now: MORNING })
    expect(slots).toHaveLength(12)
    const perDay = Object.values(slots.reduce<Record<string, number>>((n, s) => ({ ...n, [s.date]: (n[s.date] ?? 0) + 1 }), {}))
    expect(Math.max(...perDay) - Math.min(...perDay)).toBeLessThanOrEqual(1)
    expect(slots.every((s) => s.date <= '2026-10-23')).toBe(true)
  })

  it('makes nothing of nothing', () => {
    expect(spreadOver({ count: 0, days: 7, place, campaignId: 'c', now: MORNING })).toEqual([])
  })
})
