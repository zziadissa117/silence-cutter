// A number a week on the days he picks (his ask, 2026-11-14: "make it so you
// can post X times per week and not per day. Also, make it so we can choose
// the days too ... On the other days ... I can post my own talking head
// videos").

import { describe, expect, it } from 'vitest'

import { describeWeek, weekDays, weekdayOf, weekShare, type BatchBank } from './batch'
import { daysToMake, perDayOn, runSlots } from './batchRun'
import type { CampaignPlace } from './posting'

// 2026-11-16 is a Monday.
const MON = '2026-11-16'

describe('a number a week', () => {
  it('on the days he picks, shared out - the first days take one more', () => {
    expect(weekdayOf(MON)).toBe(1)
    const week = { count: 5, days: [4, 1, 3] }
    expect(weekDays(week)).toEqual([1, 3, 4])
    expect([1, 2, 3, 4, 5, 6, 0].map((d) => weekShare(week, d))).toEqual([2, 0, 2, 1, 0, 0, 0])
    expect(describeWeek(week).text).toBe('Mon 2 · Wed 2 · Thu 1.')
    expect(describeWeek({ count: 3, days: [1, 3, 4] }).text).toBe('Mon, Wed and Thu - 1 each.')
    expect(describeWeek({ count: 1, days: [0] }).text).toBe('Sun - 1.')
  })

  it('none picked: spread evenly over the week by itself', () => {
    expect(weekDays({ count: 3 })).toEqual([1, 3, 5])
    expect(weekDays({ count: 2 })).toEqual([1, 4])
    expect(weekDays({ count: 10 })).toEqual([1, 2, 3, 4, 5, 6, 0])
    expect(describeWeek({ count: 2 }).text).toBe('Spread over the week by itself: Mon and Thu - 1 each. Tap days to pick them.')
  })

  it('fewer than the days picked: the days left without one are said', () => {
    const d = describeWeek({ count: 2, days: [1, 3, 5] })
    expect(d.none).toEqual(['Fri'])
    expect(d.text).toBe('Mon and Wed - 1 each. Fri gets none - 3 a week gives each one.')
  })

  it("the batch makes them only on those days, and how long its videos last counts the week", () => {
    const bank = { perDay: 3, week: { count: 3, days: [1, 3, 4] } } as unknown as BatchBank
    expect([0, 1, 2, 3, 4, 5, 6].map((k) => perDayOn(bank, `2026-11-${16 + k}`))).toEqual([1, 0, 1, 1, 0, 0, 0])
    // Off: his number a day again.
    expect(perDayOn({ ...bank, week: { ...bank.week!, off: true } }, '2026-11-17')).toBe(3)
    // 4 videos from Monday: Mon, Wed, Thu, then the next Monday - 8 days.
    expect(daysToMake(bank, 4, MON)).toBe(8)
    expect(daysToMake({ ...bank, week: { count: 0 } } as BatchBank, 4, MON)).toBe(Infinity)
    const place = { accounts: ['a'], times: [], window: null } as unknown as CampaignPlace
    const slots = runSlots({ bank: { ...bank, filled: {} } as BatchBank, place, campaignId: 'c', now: new Date('2026-11-16T05:00:00') })
    expect(slots.map((s) => s.date)).toEqual([MON, '2026-11-18'])
  })
})
