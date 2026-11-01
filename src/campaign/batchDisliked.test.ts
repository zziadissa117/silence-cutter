// A batch video he turns down in To approve is made again, a different mix -
// and the day's "too many" trim doesn't take the new one back out.

import { describe, expect, it, vi } from 'vitest'

vi.mock('./engine', () => ({ saveEngineSeries: vi.fn(), sendFootage: vi.fn(), makeOnEngine: vi.fn() }))
vi.mock('./store', () => ({ loadBankFile: vi.fn(async () => null) }))

import { emptyBank, type BatchBank } from './batch'
import { dislikedBy, overfull, runSlots, trimPlan, type DayVideo } from './batchRun'
import type { CampaignPlace, ServerPost } from './posting'

const place: CampaignPlace = { accounts: ['tt'], times: ['12:00', '14:00', '18:00'] }
const NOON = new Date(2026, 8, 30, 12, 30)
const DAY = '2026-10-01'
const bank = (filled: Record<string, number>): BatchBank => ({ ...emptyBank('c1', 'a1'), perDay: 3, running: true, filled })
const full = { '2026-09-30': 3, '2026-10-01': 3, '2026-10-02': 3 }

const post = (status: string, disliked?: boolean, date = DAY) =>
  ({ id: `${status}-${Math.random()}`, campaignId: 'c1', status, batch: { id: 'b', date, time: '14:00', size: 3, ...(disliked ? { disliked } : {}) } }) as unknown as ServerPost

describe('dislikedBy', () => {
  it('counts only batch videos he turned down, by day - not ones stopped or replaced', () => {
    const count = dislikedBy([post('rejected', true), post('rejected', true), post('rejected'), post('scheduled')], 'c1')
    expect(count(DAY)).toBe(2)
    expect(count('2026-10-02')).toBe(0)
  })
})

describe('a turned-down video made again', () => {
  it('leaves a gap in its day that the batch fills', () => {
    const slots = runSlots({ bank: bank(full), place, campaignId: 'c1', now: NOON, disliked: (d) => (d === DAY ? 1 : 0) })
    expect(slots.filter((s) => s.date === DAY)).toHaveLength(1)
  })

  it('is not taken back out by the trim once made', () => {
    // Made again: the day's count is 4, one of them turned down.
    const after = bank({ ...full, [DAY]: 4 })
    const disliked = (d: string) => (d === DAY ? 1 : 0)
    expect(overfull(after, NOON, disliked)).toEqual([])
    expect(overfull(after, NOON)).toEqual([DAY])
    const videos = [0, 1, 2].map((i) => ({ kind: 'post', id: `v${i}`, date: DAY, time: `1${i}:00`, removable: true }) as DayVideo)
    expect(trimPlan(after, videos, NOON, disliked).remove).toEqual([])
  })
})
