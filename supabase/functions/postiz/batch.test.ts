import { describe, expect, it } from 'vitest'

import { batchChoices, batchInfo, batchSpan } from './batch.ts'

describe('a batch video', () => {
  it('is only taken as one with a real id, day, time and size', () => {
    expect(batchInfo({ id: 'b-1', date: '2026-09-30', time: '08:00', size: 21 })).toEqual({ id: 'b-1', date: '2026-09-30', time: '08:00', size: 21 })
    expect(batchInfo({ id: 'b-1', date: '30/09', time: '08:00', size: 21 })).toBeNull()
    expect(batchInfo({ id: 'b-1', date: '2026-09-30', time: '25:00', size: 21 })).toBeNull()
    expect(batchInfo({ id: 'b 1; drop', date: '2026-09-30', time: '08:00', size: 21 })).toBeNull()
    expect(batchInfo(undefined)).toBeNull()
  })

  it('goes at its own time, else the day\'s next ones, else the earlier ones', () => {
    const choices = batchChoices({ id: 'b', date: '2026-09-30', time: '14:00', size: 3 }, ['11:00', '12:00', '14:00', '17:00'], 'America/Toronto')
    expect(choices.map((c) => c.slot)).toEqual(['2026-09-30 14:00', '2026-09-30 17:00', '2026-09-30 12:00', '2026-09-30 11:00'])
    // 2 PM in Montreal is 18:00 UTC, plus a few minutes.
    const first = choices[0].at.getTime() - Date.parse('2026-09-30T18:00:00Z')
    expect(first).toBeGreaterThanOrEqual(0)
    expect(first).toBeLessThan(10 * 60_000)
  })

  it('says which days it covers', () => {
    expect(batchSpan(['2026-10-06', '2026-09-30', '2026-10-01'])).toBe('Wed, Sep 30 to Tue, Oct 6')
    expect(batchSpan(['2026-09-30'])).toBe('Wed, Sep 30')
  })
})

describe('a batch video made for the night', () => {
  it('takes the day\'s times instead of its own night time', () => {
    const times = ['03:43', '13:42', '16:43', '20:44']
    const choices = batchChoices({ id: 'b', date: '2026-10-14', time: '03:43', size: 6 }, times, 'America/Toronto')
    expect(choices.map((c) => c.slot)).toEqual(['2026-10-14 13:42', '2026-10-14 16:43'])
  })

  it('keeps its own time when it is in the day', () => {
    const choices = batchChoices({ id: 'b', date: '2026-10-14', time: '13:42', size: 6 }, ['13:42', '16:43'], 'America/Toronto')
    expect(choices[0].slot).toBe('2026-10-14 13:42')
  })
})
