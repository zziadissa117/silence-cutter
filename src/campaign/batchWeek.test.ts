// Some days of the week (his asks, 2026-11-14: "make it so you can post X
// times per week and not per day. Also, make it so we can choose the days
// too", then "right now it's pretty confusing to use"): the days lit are
// exactly the days it posts on, the same number on each.

import { describe, expect, it } from 'vitest'

import { describeWeek, weekCount, weekdayOf, weekPlan, weekShare, type BatchBank } from './batch'
import { daysToMake, perDayOn, runSlots } from './batchRun'
import type { CampaignPlace } from './posting'

// 2026-11-16 is a Monday.
const MON = '2026-11-16'

describe('some days of the week', () => {
  it('posts the same number on each day he lit, none on the others', () => {
    expect(weekdayOf(MON)).toBe(1)
    const week = { days: [4, 1, 3], each: 2 }
    expect(weekPlan(week)).toEqual({ days: [1, 3, 4], each: 2 })
    expect(weekCount(week)).toBe(6)
    expect([1, 2, 3, 4, 5, 6, 0].map((d) => weekShare(week, d))).toEqual([2, 0, 2, 2, 0, 0, 0])
  })

  it('says it plainly', () => {
    expect(describeWeek({ days: [1, 3, 4], each: 1 })).toEqual({ title: '3 videos a week', line: 'One on Monday, Wednesday and Thursday.' })
    expect(describeWeek({ days: [0], each: 2 })).toEqual({ title: '2 videos a week', line: '2 on Sunday.' })
    expect(describeWeek({ days: [0, 1, 2, 3, 4, 5, 6], each: 1 }).line).toBe('One on each day.')
    expect(describeWeek({ days: [], each: 1 })).toEqual({ title: 'No day picked', line: 'Tap the days it should post on.' })
    expect(describeWeek({ days: [1], each: 0 }).title).toBe('Paused')
  })

  it('a week saved as a number a week reads as its days and the nearest number on each', () => {
    expect(weekPlan({ count: 3 })).toEqual({ days: [1, 3, 5], each: 1 })
    expect(weekPlan({ count: 6, days: [1, 3, 4] })).toEqual({ days: [1, 3, 4], each: 2 })
    expect(weekPlan({ count: 0 })).toEqual({ days: [1], each: 0 })
  })

  it('the batch makes them only on those days, and how long its videos last counts the week', () => {
    const bank = { perDay: 3, week: { days: [1, 3, 4], each: 1 } } as unknown as BatchBank
    expect([0, 1, 2, 3, 4, 5, 6].map((k) => perDayOn(bank, `2026-11-${16 + k}`))).toEqual([1, 0, 1, 1, 0, 0, 0])
    // Back to every day: his number a day again.
    expect(perDayOn({ ...bank, week: { ...bank.week!, off: true } }, '2026-11-17')).toBe(3)
    // 4 videos from Monday: Mon, Wed, Thu, then the next Monday - 8 days.
    expect(daysToMake(bank, 4, MON)).toBe(8)
    expect(daysToMake({ ...bank, week: { days: [], each: 1 } } as BatchBank, 4, MON)).toBe(Infinity)
    const place = { accounts: ['a'], times: [], window: null } as unknown as CampaignPlace
    const slots = runSlots({ bank: { ...bank, filled: {} } as BatchBank, place, campaignId: 'c', now: new Date('2026-11-16T05:00:00') })
    expect(slots.map((s) => s.date)).toEqual([MON, '2026-11-18'])
  })
})
