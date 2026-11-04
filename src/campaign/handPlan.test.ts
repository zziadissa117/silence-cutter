import { describe, expect, it } from 'vitest'

import { planHandDays, planSaid } from './handPlan'

const base = { today: '2026-11-03', nowMinute: 9 * 60, used: () => 0, window: { from: 10 * 60, to: 22 * 60 }, key: 'vertus' }
const perDay = (slots: { date: string }[]) => slots.reduce<Record<string, number>>((n, s) => ({ ...n, [s.date]: (n[s.date] ?? 0) + 1 }), {})

describe('New post over the days', () => {
  it('14 videos, 2 a day at most: 7 days from today, each in the window', () => {
    const slots = planHandDays({ ...base, count: 14, campaignMost: 2 })!
    expect(slots).toHaveLength(14)
    expect(Object.values(perDay(slots))).toEqual([2, 2, 2, 2, 2, 2, 2])
    expect(slots[0].date).toBe('2026-11-03')
    for (const s of slots) expect(s.time! >= '10:00' && s.time! < '22:00').toBe(true)
  })

  it('counts what the campaign already has that day', () => {
    const slots = planHandDays({ ...base, count: 3, campaignMost: 2, used: (d) => (d === '2026-11-03' ? 1 : 0) })!
    expect(perDay(slots)).toEqual({ '2026-11-03': 1, '2026-11-04': 2 })
  })

  it("his note asks for fewer a day, or a later start - never more than the campaign's most", () => {
    expect(perDay(planHandDays({ ...base, count: 3, notePerDay: 1 })!)).toEqual({ '2026-11-03': 1, '2026-11-04': 1, '2026-11-05': 1 })
    expect(perDay(planHandDays({ ...base, count: 4, campaignMost: 2, notePerDay: 5 })!)).toEqual({ '2026-11-03': 2, '2026-11-04': 2 })
    expect(planHandDays({ ...base, count: 2, startDate: '2026-11-05' })![0].date).toBe('2026-11-05')
  })

  it("All now: today's room goes now, the rest on the next days", () => {
    const slots = planHandDays({ ...base, count: 3, campaignMost: 2, nowFirst: true })!
    expect(slots.slice(0, 2).map((s) => s.time)).toEqual([null, null])
    expect(slots[2].date).toBe('2026-11-04')
  })

  it('nothing to plan without a most a day or a note', () => {
    expect(planHandDays({ ...base, count: 5 })).toBeNull()
  })

  it('today past its window starts tomorrow', () => {
    const slots = planHandDays({ ...base, nowMinute: 23 * 60, count: 1, campaignMost: 2 })!
    expect(slots[0].date).toBe('2026-11-04')
  })

  it('says the plan', () => {
    expect(planSaid([{ date: '2026-11-03', time: null }, { date: '2026-11-04', time: '10:31' }, { date: '2026-11-04', time: '16:12' }], '2026-11-03')).toBe('Today 1 · Tomorrow 2')
  })

  it('as many a day as he picks, never past the campaign, counting what the day has', () => {
    expect(perDay(planHandDays({ ...base, count: 10, chosenPerDay: 2 })!)).toEqual({
      '2026-11-03': 2, '2026-11-04': 2, '2026-11-05': 2, '2026-11-06': 2, '2026-11-07': 2,
    })
    expect(Object.values(perDay(planHandDays({ ...base, count: 4, chosenPerDay: 3, campaignMost: 1 })!))).toEqual([1, 1, 1, 1])
    expect(perDay(planHandDays({ ...base, count: 2, chosenPerDay: 2, used: (d) => (d === '2026-11-03' ? 1 : 0) })!)).toEqual({ '2026-11-03': 1, '2026-11-04': 1 })
  })

  it('skips Saturdays and Sundays unless weekends are in', () => {
    // 2026-11-06 is a Friday.
    const days = Object.keys(perDay(planHandDays({ ...base, today: '2026-11-06', count: 3, chosenPerDay: 1, weekends: false })!))
    expect(days).toEqual(['2026-11-06', '2026-11-09', '2026-11-10'])
    const all = Object.keys(perDay(planHandDays({ ...base, today: '2026-11-06', count: 3, chosenPerDay: 1, weekends: true })!))
    expect(all).toEqual(['2026-11-06', '2026-11-07', '2026-11-08'])
  })
})
