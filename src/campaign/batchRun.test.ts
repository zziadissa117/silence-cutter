import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./engine', () => ({
  saveEngineSeries: vi.fn(async () => ({})),
  sendFootage: vi.fn(async () => {}),
  makeOnEngine: vi.fn(async () => ({ id: 'job-1' })),
}))
vi.mock('./store', () => ({ loadBankFile: vi.fn(async () => null) }))
vi.mock('./posting', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  listPosts: vi.fn(async () => []),
  stopPostsNow: vi.fn(async (posts: unknown[]) => ({ stopped: posts.length, unposting: 0, failed: [] })),
}))

import { addDays, emptyBank, recastPicks, type BankFile, type BatchBank } from './batch'
import { AHEAD_DAYS, changeLook, countedDays, dayVideos, daysToMake, filledOn, growthSummary, leftToMake, missingFor, nextInLine, oneAtATime, overfull, perDayOn, planVideos, runSlots, startOver, takeOutHook, takenBy, topUp, trimPlan, variationParts, withGrowth, withPerDay, type BatchVideo } from './batchRun'
import { hookOfJob, hookOfPost, swapLook } from './batchHooks'
import { makeOnEngine } from './engine'
import type { Job } from './jobs'
import { listPosts, stopPostsNow, type CampaignPlace, type ServerPost } from './posting'

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

/** The last day made ahead, from Sep 30 (NOON). */
const LAST = addDays('2026-09-30', AHEAD_DAYS - 1)

describe('the days a running batch still needs', () => {
  it('fills today too - its times still an hour away, and one more for the one gone by - then whole days, the days ahead', () => {
    const slots = runSlots({ bank: bank(), place, campaignId: 'c1', now: NOON })
    const today = slots.filter((s) => s.date === '2026-09-30').map((s) => s.time)
    expect(today).toHaveLength(3)
    expect(today).toContain('14:00')
    expect(today).toContain('18:00')
    expect(today.every((t) => t >= '13:30')).toBe(true)
    expect(slots.filter((s) => s.date === '2026-10-01').map((s) => s.time)).toEqual(['12:00', '14:00', '18:00'])
    expect(slots).toHaveLength(3 * AHEAD_DAYS)
    expect(slots.at(-1)!.date).toBe(LAST)
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
    const old = bank({ madeThrough: '2026-10-02', lastPerDay: 2 })
    expect(filledOn(old, '2026-10-02')).toBe(2)
    expect(filledOn(old, '2026-10-04')).toBe(0)
    // So at 3 a day those days get one more each, and the rest whole days.
    const slots = runSlots({ bank: old, place, campaignId: 'c1', now: new Date(2026, 9, 1, 6, 0) })
    expect(slots.filter((s) => s.date <= '2026-10-02')).toHaveLength(2)
    // The rest of the days ahead from Oct 1.
    expect(slots.filter((s) => s.date > '2026-10-02')).toHaveLength(3 * (AHEAD_DAYS - 2))
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
    expect(plan.bank.filled?.[LAST]).toBe(3)
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
    expect(next?.filled?.[LAST]).toBe(3)
  })

  it('hands the engine the days and keeps its job', async () => {
    const save = vi.fn(async (_b: BatchBank) => {})
    const next = await topUp({ bank: bank({ layout: 'engine' }), campaign, place, profileId: 'p', save, make: vi.fn(), now: NOON })
    expect(vi.mocked(makeOnEngine).mock.calls[0][0].slots).toHaveLength(3 * AHEAD_DAYS)
    expect(next?.engineJob).toBe('job-1')
    expect(save.mock.calls[0][0].filled?.[LAST]).toBe(3)
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

describe('lowering the number', () => {
  const NOW = new Date(2026, 8, 30, 9, 0)
  const post = (id: string, date: string, time: string, status: ServerPost['status'] = 'scheduled') =>
    ({ id, key: `k-${id}`, campaignId: 'c1', status, postAt: `${date}T${time}:00`, batch: { id: 'b', date, time, size: 9 } }) as ServerPost
  const job = (id: string, date: string, time: string, status: Job['status'] = 'queued') =>
    ({ id, campaignId: 'c1', status, batch: { id: 'b', date, time, size: 9 } }) as Job

  it('finds the days over it', () => {
    const b = bank({ perDay: 2, filled: { '2026-09-30': 2, '2026-10-01': 5, '2026-10-02': 3 } })
    expect(overfull(b, NOW)).toEqual(['2026-10-01', '2026-10-02'])
    expect(overfull({ ...b, perDay: 0 }, NOW)).toEqual(['2026-09-30', '2026-10-01', '2026-10-02'])
  })

  it('takes out the extra, leaving the rest spread through the day', () => {
    const times = ['11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00']
    const videos = dayVideos(times.map((t, i) => post(`p${i}`, '2026-10-01', t)), [], 'c1', NOW)
    const plan = trimPlan(bank({ perDay: 2, filled: { '2026-10-01': 10 } }), videos, NOW)
    expect(plan.remove).toHaveLength(8)
    const kept = videos.filter((v) => !plan.remove.includes(v)).map((v) => v.time)
    expect(kept).toEqual(['11:00', '16:00'])
    expect(plan.filled['2026-10-01']).toBe(2)
  })

  it('never takes out one already posted, or one this phone is making', () => {
    const videos = dayVideos(
      [post('a', '2026-09-30', '08:00', 'posted'), post('b', '2026-09-30', '12:00'), post('c', '2026-09-30', '18:00')],
      [job('j1', '2026-09-30', '20:00', 'working'), job('j2', '2026-09-30', '21:00')],
      'c1',
      NOW,
    )
    const plan = trimPlan(bank({ perDay: 0, filled: { '2026-09-30': 5 } }), videos, NOW)
    expect(plan.remove.map((v) => v.id).sort()).toEqual(['b', 'c', 'j2'])
    // The posted one and the one being made stay, and still count.
    expect(plan.filled['2026-09-30']).toBe(2)
  })

  it('counts a video once when it is both a job here and a post on the server', () => {
    const videos = dayVideos([post('p', '2026-10-01', '12:00')], [{ ...job('k-p', '2026-10-01', '12:00'), status: 'done' } as Job], 'c1', NOW)
    expect(videos).toHaveLength(1)
    expect(videos[0].kind).toBe('post')
  })

  it('leaves days gone by and other campaigns alone', () => {
    const videos = dayVideos([post('old', '2026-09-29', '12:00'), { ...post('x', '2026-10-01', '12:00'), campaignId: 'c2' }], [], 'c1', NOW)
    expect(videos).toEqual([])
  })

  it('after the engine stops partway, counts the days as they really are', () => {
    const videos = dayVideos([post('a', '2026-09-30', '12:00'), post('b', '2026-10-01', '12:00')], [], 'c1', NOW)
    const counted = countedDays(videos, NOW)
    expect(counted['2026-09-30']).toBe(1)
    expect(counted['2026-10-01']).toBe(1)
    expect(counted[LAST]).toBe(0)
  })
})

describe("each step's name goes with its video", () => {
  it('is kept on every video, for the words over its clip', () => {
    const steps = [
      { id: 's1', name: 'DRAW SOMETHING', files: files('d', 2) },
      { id: 's2', name: 'Step 2', files: files('a', 2) },
    ]
    const b = bank({ steps })
    const plan = planVideos(b, runSlots({ bank: b, place, campaignId: 'c1', now: NOON }).slice(0, 3), { now: NOON })
    for (const v of plan.videos) expect(v.steps?.map((s) => s.name)).toEqual(['DRAW SOMETHING', 'Step 2'])
  })
})

describe('headlines in several looks, planned', () => {
  it('gives each video the look it was mixed with', () => {
    const b = bank({ headlineStyles: ['snap', 'box'] })
    const plan = planVideos(b, runSlots({ bank: b, place, campaignId: 'c1', now: NOON }).slice(0, 4), { now: NOON })
    expect(plan.videos.map((v) => v.headlineStyle).sort()).toEqual(['box', 'box', 'snap', 'snap'])
  })

  it('with one look picked, each video carries it (the same look it is made in) - none picked: the angle\'s', () => {
    const b = bank({ headlineStyles: ['snap'] })
    const plan = planVideos(b, runSlots({ bank: b, place, campaignId: 'c1', now: NOON }).slice(0, 2), { now: NOON })
    expect(plan.videos.every((v) => v.headlineStyle === 'snap')).toBe(true)
    const none = planVideos(bank(), runSlots({ bank: bank(), place, campaignId: 'c1', now: NOON }).slice(0, 2), { now: NOON })
    expect(none.videos.every((v) => v.headlineStyle === undefined)).toBe(true)
  })
})

describe('how many variations', () => {
  it('says what multiplies into the number', () => {
    const b = bank({ headlineStyles: ['outline', 'snap', 'box'], music: files('m', 2) })
    expect(variationParts(b)).toEqual(['2 reactions', '2 product showcases', '2 songs', '2 headlines', '3 headline looks'])
    expect(leftToMake(b).total).toBe(2 * 2 * 2 * 2 * 3)
  })

  it('names each step, and leaves out one song or one look', () => {
    const steps = [
      { id: 's1', name: 'DRAW SOMETHING', files: files('d', 3) },
      { id: 's2', name: 'The app', files: files('a', 1) },
    ]
    expect(variationParts(bank({ steps, music: files('m', 1) }))).toEqual(['2 reactions', '3 clips for DRAW SOMETHING', '1 clip for The app', '2 headlines'])
  })

  it('has no headlines for the Claude + X hook', () => {
    expect(variationParts(bank({ hook: 'formula', headlineStyles: ['snap', 'box'] }))).toEqual(['2 reactions', '2 product showcases'])
    expect(leftToMake(bank({ hook: 'formula', headlineStyles: ['snap', 'box'] })).total).toBe(4)
  })
})

describe('Claude + X taking turns with headlines, planned', () => {
  const logos = { left: files('l', 1)[0], right: files('o', 1)[0], min: 500, max: 600 }
  const mixed = (fields: Partial<BatchBank> = {}) =>
    bank({ looks: [{ look: 'snap', parts: 1 }, { look: 'box', parts: 1 }, { look: 'formula', parts: 1 }], formula: logos, ...fields })

  it('makes some videos with the logos and an amount, the rest with a headline in its look', () => {
    const b = mixed()
    const plan = planVideos(b, runSlots({ bank: b, place, campaignId: 'c1', now: NOON }).slice(0, 6), { now: NOON })
    const formula = plan.videos.filter((v) => v.formula)
    expect(formula.length).toBe(2)
    for (const v of formula) {
      expect(v.formula!.line).toMatch(/^\$(500|550|600)/)
      expect(v.headlineStyle).toBeUndefined()
    }
    expect(plan.videos.filter((v) => !v.formula).map((v) => v.headlineStyle).sort()).toEqual(['box', 'box', 'snap', 'snap'])
  })

  it('counts its amounts as hooks next to the headlines', () => {
    expect(variationParts(mixed())).toEqual(['2 reactions', '2 product showcases', '7 hooks (2 headlines in 2 looks + 3 Claude + X amounts)'])
    expect(leftToMake(mixed()).total).toBe(2 * 2 * 7)
    expect(variationParts(mixed({ looks: [{ look: 'snap', parts: 1 }, { look: 'formula', parts: 1 }] }))).toContain('5 hooks (2 headlines + 3 Claude + X amounts)')
  })

  it('needs headlines and both logos', () => {
    expect(missingFor(mixed({ headlines: [], formula: { ...logos, right: null } }))).toEqual(['a headline', 'both logos'])
  })
})

describe('the last different videos', () => {
  it('are marked as the last, so he is told to film new clips', () => {
    // 2 reactions x 2 products x 2 headlines: 8 different videos.
    const b = bank()
    const slots = runSlots({ bank: b, place, campaignId: 'c1', now: NOON })
    const first = planVideos(b, slots.slice(0, 5), { now: NOON })
    expect(first.videos.every((v) => v.batch.last === undefined)).toBe(true)
    const rest = planVideos(first.bank, slots.slice(5), { now: NOON })
    expect(rest.videos).toHaveLength(3)
    expect(rest.videos.every((v) => v.batch.last === true)).toBe(true)
    expect(rest.bank.running).toBe(false)
  })
})

describe('starting the batch over', () => {
  it("takes out what hasn't gone out, lets those be made again, and never one that went out", async () => {
    const today = new Date()
    const day = (offset: number) => {
      const d = new Date(today)
      d.setDate(d.getDate() + offset)
      return d.toLocaleDateString('en-CA')
    }
    const post = (id: string, status: string, offset: number, fileName: string, headline: string) =>
      ({
        id,
        key: id,
        campaignId: 'c1',
        status,
        fileName,
        headline,
        postAt: new Date(Date.now() + (offset + 1) * 86400000).toISOString(),
        batch: { id: 'b1', date: day(offset), time: '12:00', size: 3 },
      }) as unknown as ServerPost
    const posts = [
      post('p1', 'scheduled', 1, 'r1 + p1.mp4', 'h1'),
      post('p2', 'scheduled', 2, 'r2 + p2.mp4', 'h2'),
      // Gone out already, an earlier day.
      post('old', 'posted', -3, 'r1 + p2.mp4', 'h1'),
    ]
    vi.mocked(listPosts).mockResolvedValueOnce(posts)
    const made = ['r1|p1|h:h1|', 'r2|p2|h:h2|', 'r1|p2|h:h1|', 'r2|p1|h:h1|']
    const b = bank({ made, filled: { [day(1)]: 3, [day(2)]: 3 }, madeThrough: day(6) })
    const saved: BatchBank[] = []
    const done = await startOver({ bank: b, campaignId: 'c1', jobs: [], removeJob: () => {}, save: async (next) => void saved.push(next) })
    expect(done.taken).toBe(2)
    expect(vi.mocked(stopPostsNow).mock.calls.at(-1)![0].map((p) => p.id).sort()).toEqual(['p1', 'p2'])
    // The two taken out can be made again; the posted one and one never touched stay made.
    expect(done.bank.made).toEqual(['r1|p2|h:h1|', 'r2|p1|h:h1|'])
    expect(done.bank.running).toBe(false)
    expect(done.bank.madeThrough).toBeUndefined()
    expect(Object.values(done.bank.filled ?? {}).every((n) => n === 0)).toBe(true)
    expect(saved).toHaveLength(1)
    // So Start makes the week again.
    expect(runSlots({ bank: done.bank, place, campaignId: 'c1' }).length).toBeGreaterThanOrEqual(3 * (AHEAD_DAYS - 1))
  })
})

describe('taking one hook out', () => {
  it("takes out only that hook's videos not out yet, frees their mixes, keeps the batch running and changes the bank", async () => {
    const today = new Date()
    const day = (offset: number) => {
      const d = new Date(today)
      d.setDate(d.getDate() + offset)
      return d.toLocaleDateString('en-CA')
    }
    const post = (id: string, status: string, offset: number, fileName: string, headline: string) =>
      ({
        id,
        key: id,
        campaignId: 'c1',
        status,
        fileName,
        headline,
        postAt: new Date(Date.now() + (offset + 1) * 86400000).toISOString(),
        batch: { id: 'b1', date: day(offset), time: '12:00', size: 3 },
      }) as unknown as ServerPost
    const posts = [
      post('p1', 'scheduled', 1, 'r1 + p1.mp4', 'h1'),
      post('p2', 'scheduled', 2, 'r2 + p2.mp4', 'h2'),
      post('old', 'posted', -3, 'r1 + p2.mp4', 'h2'),
    ]
    vi.mocked(listPosts).mockResolvedValueOnce(posts)
    const jobs = [{ id: 'j1', campaignId: 'c1', status: 'queued', name: 'r2 + p1.mp4', headlineText: 'h2', batch: { id: 'b1', date: day(3), time: '12:00', size: 3 } }] as unknown as Job[]
    const made = ['r1|p1|h:h1|', 'r2|p2|h:h2|', 'r1|p2|h:h2|', 'r2|p1|h:h2|']
    const b = bank({ made, filled: { [day(1)]: 1, [day(2)]: 1, [day(3)]: 1 }, madeThrough: day(6) })
    const removed: string[] = []
    const done = await takeOutHook({
      bank: b,
      campaignId: 'c1',
      jobs,
      matches: ({ post, job }) => (post?.headline ?? job?.headlineText) === 'h2',
      change: (next) => ({ ...next, headlines: ['h1', 'h3'] }),
      removeJob: (id) => removed.push(id),
      save: async () => {},
    })
    expect(done.taken).toBe(2)
    expect(removed).toEqual(['j1'])
    expect(vi.mocked(stopPostsNow).mock.calls.at(-1)![0].map((p) => p.id)).toEqual(['p2'])
    // The posted h2 video and the untouched h1 one stay made; the two taken out can be made again.
    expect(done.bank.made).toEqual(['r1|p1|h:h1|', 'r1|p2|h:h2|'])
    expect(done.bank.running).toBe(true)
    expect(done.bank.headlines).toEqual(['h1', 'h3'])
    expect([day(1), day(2)].map((d) => done.bank.filled?.[d])).toEqual([1, 0])
    expect(done.bank.filled?.[day(3)] ?? 0).toBe(0)
  })
})

describe('a batch that grows each day ("start with 4 and add +1 per day")', () => {
  const growing = (fields: Partial<BatchBank> = {}) => bank({ perDay: 4, growth: 1, growthFrom: '2026-09-30', ...fields })

  it("makes its number on its first day, and one more each day after - up to Instagram's most", () => {
    expect(perDayOn(growing(), '2026-09-30')).toBe(4)
    expect(perDayOn(growing(), '2026-10-01')).toBe(5)
    expect(perDayOn(growing(), '2026-10-07')).toBe(11)
    expect(perDayOn(growing(), '2026-11-13')).toBe(48)
    expect(perDayOn(growing(), '2026-12-31')).toBe(48)
    expect(perDayOn(bank({ perDay: 125 }), '2026-10-07')).toBe(48)
    // "25 today, 30 tomorrow, then 50": 30 and +10 a day.
    const ending = withGrowth(withPerDay(bank({ perDay: 25 }), 30, '2026-10-26'), 10, '2026-10-26')
    expect(['2026-10-26', '2026-10-27', '2026-10-28', '2026-11-01'].map((d) => perDayOn(ending, d))).toEqual([30, 40, 48, 48])
    expect(perDayOn(growing(), '2026-09-01')).toBe(4)
    expect(perDayOn(growing({ perDay: 0 }), '2026-10-07')).toBe(0)
    expect(perDayOn(bank({ perDay: 4 }), '2026-10-07')).toBe(4)
  })

  it("fills each day of the week ahead to that day's number", () => {
    const slots = runSlots({ bank: growing(), place: { accounts: ['tt'], times: [] }, campaignId: 'c1', now: new Date(2026, 8, 30, 6, 0) })
    const per = (date: string) => slots.filter((s) => s.date === date).length
    expect(per('2026-09-30')).toBe(4)
    expect(per('2026-10-01')).toBe(5)
    expect(per(LAST)).toBe(4 + AHEAD_DAYS - 1)
  })

  it("a day already made at a lower number is topped up, and it is never overfull", () => {
    const made = growing({ filled: { '2026-10-01': 4 } })
    const slots = runSlots({ bank: made, place: { accounts: ['tt'], times: [] }, campaignId: 'c1', now: new Date(2026, 8, 30, 6, 0) })
    expect(slots.filter((s) => s.date === '2026-10-01')).toHaveLength(1)
    expect(overfull(made, new Date(2026, 8, 30, 6, 0))).toEqual([])
  })

  it("changing today's number or the growth carries on from today", () => {
    const later = growing()
    const today = '2026-10-03'
    expect(perDayOn(later, today)).toBe(7)
    const lowered = withPerDay(later, 5, today)
    expect(perDayOn(lowered, today)).toBe(5)
    expect(perDayOn(lowered, '2026-10-04')).toBe(6)
    const steady = withGrowth(later, 0, today)
    expect(steady.perDay).toBe(7)
    expect(perDayOn(steady, '2026-10-10')).toBe(7)
    const started = withGrowth(bank({ perDay: 4 }), 1, today)
    expect(perDayOn(started, '2026-10-04')).toBe(5)
  })

  it('says how it goes, and when the posting window is too small', () => {
    const { text, tight } = growthSummary(growing(), '2026-09-30', (_date, wanted) => Math.min(wanted, 12))
    expect(text).toMatch(/^Today 4, tomorrow 5, in a week 11\. From/)
    expect(text).not.toMatch(/the most/)
    expect(tight).toBe(true)
    expect(text).toMatch(/only fits 12 a day/)
    expect(daysToMake(growing(), 15, '2026-09-30')).toBe(3)
  })
})

describe('changing one look for another ("Claude + X doesn\'t work - make those Snapchat")', () => {
  const today = new Date()
  const day = (offset: number) => {
    const d = new Date(today)
    d.setDate(d.getDate() + offset)
    return d.toLocaleDateString('en-CA')
  }
  const post = (id: string, status: string, offset: number, fileName: string, headline: string, look?: string) =>
    ({
      id,
      key: id,
      campaignId: 'c1',
      status,
      fileName,
      headline,
      postAt: new Date(Date.now() + (offset + 1) * 86400000).toISOString(),
      batch: { id: 'b1', date: day(offset), time: '12:00', size: 3, ...(look ? { look } : {}) },
    }) as unknown as ServerPost

  it('makes only that look\'s videos not out yet again, same clips and slots, in the new look', async () => {
    const posts = [
      post('f1', 'scheduled', 1, 'r1 + p1.mp4', 'Claude + Lovable = $800 a day'),
      post('s1', 'scheduled', 2, 'r2 + p2.mp4', 'h1', 'snap'),
      post('f0', 'posted', -2, 'r2 + p2.mp4', 'Claude + Lovable = $650 a day'),
    ]
    vi.mocked(listPosts).mockResolvedValueOnce(posts)
    const files2 = files('r', 2)
    const prods = files('p', 2)
    const jobs = [
      {
        id: 'j1',
        campaignId: 'c1',
        status: 'queued',
        name: 'r2 + p1.mp4',
        headlineText: 'Claude + Lovable = $900 a day',
        montage: { bank: { reaction: files2[1], product: prods[0], music: null, formula: { left: null, right: null, line: '$900 a day' } } },
        batch: { id: 'b1', date: day(3), time: '15:00', size: 3, look: 'formula' },
      },
    ] as unknown as Job[]
    const logo = { id: 'l', name: 'claude.png', type: 'image/png', size: 1 }
    const b = bank({
      looks: [
        { look: 'snap', parts: 1 },
        { look: 'formula', parts: 1 },
      ],
      formula: { left: logo, right: { ...logo, id: 'l2', name: 'lovable.png' }, min: 500, max: 1000 },
      filled: { [day(1)]: 1, [day(2)]: 1, [day(3)]: 1 },
    })
    const removed: string[] = []
    const made: BatchVideo[] = []
    const done = await changeLook({
      bank: b,
      campaignId: 'c1',
      jobs,
      from: 'formula',
      to: 'snap',
      matches: ({ post, job }) => (post ? hookOfPost(post) : job ? hookOfJob(job) : null)?.look === 'formula',
      change: (next) => swapLook(next, 'formula', 'snap'),
      removeJob: (id) => removed.push(id),
      save: async () => {},
      make: (videos) => made.push(...videos),
    })
    expect(removed).toEqual(['j1'])
    expect(vi.mocked(stopPostsNow).mock.calls.at(-1)![0].map((p) => p.id)).toEqual(['f1'])
    expect(done.remade).toBe(2)
    expect(made.map((v) => [v.reaction.id, v.product.id, v.batch.date, v.batch.time, v.headlineStyle, v.formula ? 'formula' : 'words'])).toEqual([
      ['r1', 'p1', day(1), '12:00', 'snap', 'words'],
      ['r2', 'p1', day(3), '15:00', 'snap', 'words'],
    ])
    expect(made.every((v) => ['h1', 'h2'].includes(v.headline))).toBe(true)
    // Snapchat takes Claude + X's share; nothing else is touched.
    expect(done.bank.looks).toEqual([{ look: 'snap', parts: 2 }])
    expect([day(1), day(2), day(3)].map((d) => done.bank.filled?.[d])).toEqual([1, 1, 1])
  })

  it('a headline keeps its words when only its look changes', () => {
    const b = bank({
      looks: [
        { look: 'outline', parts: 1 },
        { look: 'box', parts: 1 },
      ],
    })
    const { picks } = recastPicks(b, [{ reaction: 'r1', products: ['p2'], headline: 'h2', music: null }], 'box', () => 0.5)
    expect(picks[0]).toMatchObject({ reaction: 'r1', product: 'p2', headline: 'h2', look: 'box' })
    // Already made in that look: the next headline instead.
    const again = recastPicks({ ...b, made: ['r1|p2|h:h2||box'] }, [{ reaction: 'r1', products: ['p2'], headline: 'h2', music: null }], 'box', () => 0.5)
    expect(again.picks[0]?.headline).toBe('h1')
  })
})

describe('nextInLine', () => {
  it('runs after a top-up that is running, never dropped (oneAtATime drops it)', async () => {
    const order: string[] = []
    let finish = () => {}
    const topUp = oneAtATime('cx', () => new Promise<void>((resolve) => (finish = () => (order.push('top-up'), resolve()))))
    expect(await oneAtATime('cx', async () => order.push('dropped'))).toBeNull()
    const change = nextInLine('cx', async () => (order.push('change'), 'done'))
    await Promise.resolve()
    expect(order).toEqual([])
    finish()
    await topUp
    expect(await change).toBe('done')
    expect(order).toEqual(['top-up', 'change'])
  })
})
