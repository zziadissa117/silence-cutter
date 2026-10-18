import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./engine', () => ({
  saveEngineSeries: vi.fn(async () => ({})),
  sendFootage: vi.fn(async () => {}),
  makeOnEngine: vi.fn(async () => ({ id: 'job-1' })),
}))
vi.mock('./store', () => ({ loadBankFile: vi.fn(async () => null) }))

import { emptyBank, type BankFile, type BatchBank } from './batch'
import { AHEAD_DAYS, filledOn, planVideos, runSlots, takenBy, topUp } from './batchRun'
import { makeOnEngine } from './engine'
import type { Job } from './jobs'
import type { CampaignPlace, ServerPost } from './posting'

const files = (prefix: string, n: number): BankFile[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i + 1}`, name: `${prefix}${i + 1}.mp4`, type: 'video/mp4', size: 1 }))

const place: CampaignPlace = { accounts: ['tt'], times: ['12:00', '14:00', '18:00'] }
const NOON = new Date(2026, 8, 30, 12, 30)

const bank = (fields: Partial<BatchBank> = {}): BatchBank => ({
  ...emptyBank('c1', 'a1'),
  reactions: files('r', 2),
  products: files('p', 2),
  headlines: ['h1', 'h2'],
  music: [],
  perDay: 3,
  running: true,
  ...fields,
})

describe('the days a running batch still needs', () => {
  it('fills today too - its times still an hour away, and one more for the one gone by - then whole days, a week ahead', () => {
    const slots = runSlots({ bank: bank(), place, campaignId: 'c1', now: NOON })
    const today = slots.filter((s) => s.date === '2026-09-30').map((s) => s.time)
    expect(today).toHaveLength(3)
    expect(today).toContain('14:00')
    expect(today).toContain('18:00')
    expect(today.every((t) => t >= '13:30')).toBe(true)
    expect(slots.filter((s) => s.date === '2026-10-01').map((s) => s.time)).toEqual(['12:00', '14:00', '18:00'])
    expect(slots).toHaveLength(3 * AHEAD_DAYS)
    expect(slots.at(-1)!.date).toBe('2026-10-06')
  })

  it('needs nothing while every day ahead is full', () => {
    const days = ['2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06']
    const full = bank({ filled: Object.fromEntries(days.map((d) => [d, 3])) })
    expect(runSlots({ bank: full, place, campaignId: 'c1', now: NOON })).toEqual([])
  })

  it('tops a day up to the number, clear of the times it already has', () => {
    const filled = { '2026-09-30': 3, '2026-10-01': 1, '2026-10-02': 3, '2026-10-03': 3, '2026-10-04': 3, '2026-10-05': 3, '2026-10-06': 3 }
    const slots = runSlots({ bank: bank({ filled }), place, campaignId: 'c1', now: NOON, taken: (date) => (date === '2026-10-01' ? ['14:00'] : []) })
    expect(slots).toHaveLength(2)
    for (const s of slots) {
      expect(s.date).toBe('2026-10-01')
      const at = Number(s.time.slice(0, 2)) * 60 + Number(s.time.slice(3, 5))
      expect(Math.abs(at - 14 * 60)).toBeGreaterThanOrEqual(20)
    }
  })

  it('counts days made before days were counted as full at the a-day they were made with', () => {
    const old = bank({ madeThrough: '2026-10-03', lastPerDay: 2 })
    expect(filledOn(old, '2026-10-02')).toBe(2)
    expect(filledOn(old, '2026-10-04')).toBe(0)
    // So at 3 a day those days get one more each, and the rest whole days.
    const slots = runSlots({ bank: old, place, campaignId: 'c1', now: new Date(2026, 9, 1, 6, 0) })
    expect(slots.filter((s) => s.date <= '2026-10-03')).toHaveLength(3)
    // Oct 4 to Oct 7: the rest of the week from Oct 1.
    expect(slots.filter((s) => s.date > '2026-10-03')).toHaveLength(12)
  })
})

describe('making them', () => {
  it('counts what it made, so the same days are never made twice', () => {
    const before = bank()
    const slots = runSlots({ bank: before, place, campaignId: 'c1', now: NOON })
    const plan = planVideos(before, slots, { id: 'b1', now: NOON })
    expect(plan.videos).toHaveLength(slots.length > 8 ? 8 : slots.length)
    expect(runSlots({ bank: plan.bank, place, campaignId: 'c1', now: NOON })).toHaveLength(slots.length - plan.videos.length)
  })

  it('stops at the last different video, lets the footage go and stops running', () => {
    // 2 reactions x 2 products x 2 headlines: 8 different videos.
    const before = bank()
    const plan = planVideos(before, runSlots({ bank: before, place, campaignId: 'c1', now: NOON }), { id: 'b1', now: NOON })
    expect(plan.videos).toHaveLength(8)
    expect(new Set(plan.videos.map((v) => `${v.reaction.id}|${v.product.id}|${v.headline}`)).size).toBe(8)
    expect(plan.bank.running).toBe(false)
    expect(plan.bank.spent?.videos).toBe(8)
    expect(plan.retire.sort()).toEqual(['p1', 'p2', 'r1', 'r2'])
  })

  it('goes on and on while there are more than it will ever need', () => {
    const big = bank({ reactions: files('r', 6), products: files('p', 6), headlines: ['a', 'b', 'c', 'd', 'e'] })
    const plan = planVideos(big, runSlots({ bank: big, place, campaignId: 'c1', now: NOON }), { now: NOON })
    expect(plan.bank.running).toBe(true)
    expect(plan.retire).toEqual([])
  })

  it('on the engine, only counts the days - the engine mixes', () => {
    const engine = bank({ layout: 'engine' })
    const slots = runSlots({ bank: engine, place, campaignId: 'c1', now: NOON })
    const plan = planVideos(engine, slots, { now: NOON })
    expect(plan.videos).toEqual([])
    expect(plan.slots).toEqual(slots)
    expect(plan.bank.filled?.['2026-10-06']).toBe(3)
  })
})

describe('a top-up', () => {
  const campaign = { id: 'c1', name: 'Inflow', posting: undefined }
  beforeEach(() => vi.mocked(makeOnEngine).mockClear())

  it('does nothing for a batch that is not running, or misses footage', async () => {
    const save = vi.fn(async () => {})
    const make = vi.fn()
    expect(await topUp({ bank: bank({ running: false }), campaign, place, profileId: 'p', save, make, now: NOON })).toBeNull()
    expect(await topUp({ bank: bank({ reactions: [] }), campaign, place, profileId: 'p', save, make, now: NOON })).toBeNull()
    expect(save).not.toHaveBeenCalled()
    expect(make).not.toHaveBeenCalled()
  })

  it('saves the bank before it queues the videos', async () => {
    const order: string[] = []
    const next = await topUp({
      bank: bank({ reactions: files('r', 6), products: files('p', 6) }),
      campaign,
      place,
      profileId: 'p',
      save: async () => void order.push('save'),
      make: (videos) => void order.push(`make ${videos.length}`),
      now: NOON,
    })
    expect(order).toEqual(['save', `make ${3 * AHEAD_DAYS}`])
    expect(next?.filled?.['2026-10-06']).toBe(3)
  })

  it('hands the engine the days and keeps its job', async () => {
    const save = vi.fn(async (_b: BatchBank) => {})
    const next = await topUp({ bank: bank({ layout: 'engine' }), campaign, place, profileId: 'p', save, make: vi.fn(), now: NOON })
    expect(vi.mocked(makeOnEngine).mock.calls[0][0].slots).toHaveLength(3 * AHEAD_DAYS)
    expect(next?.engineJob).toBe('job-1')
    expect(save.mock.calls[0][0].filled?.['2026-10-06']).toBe(3)
  })

  it('says why when the engine fails, and leaves the days to try again', async () => {
    vi.mocked(makeOnEngine).mockRejectedValueOnce(new Error('The engine is asleep.'))
    const save = vi.fn(async (_b: BatchBank) => {})
    const next = await topUp({ bank: bank({ layout: 'engine' }), campaign, place, profileId: 'p', save, make: vi.fn(), now: NOON })
    expect(next?.runProblem).toBe('The engine is asleep.')
    expect(next?.filled).toBeUndefined()
  })
})

describe('the times a day already holds', () => {
  it('takes its posts and the batch videos still being made here', () => {
    const at = new Date(2026, 9, 1, 14, 0).toISOString()
    const posts = [{ campaignId: 'c1', postAt: at, status: 'scheduled' }] as ServerPost[]
    const jobs = [{ campaignId: 'c1', batch: { id: 'b', date: '2026-10-01', time: '18:30', size: 1 } }] as Job[]
    expect(takenBy(posts, jobs, 'c1')('2026-10-01')).toEqual(['14:00', '18:30'])
    expect(takenBy(posts, jobs, 'other')('2026-10-01')).toEqual([])
  })
})
