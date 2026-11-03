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
})
