// The Batch tab's Make button: one tap, one batch - and as many videos a day
// as he picks, whatever times the campaign has.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { BatchBank } from './batch'

const bank: BatchBank = {
  campaignId: 'inflow',
  angleId: 'a1',
  reactions: [1, 2, 3].map((i) => ({ id: `r${i}`, name: `r${i}.mp4`, type: 'video/mp4', size: 1e6 })),
  products: [1, 2, 3].map((i) => ({ id: `p${i}`, name: `p${i}.mp4`, type: 'video/mp4', size: 1e6 })),
  headlines: ['one', 'two', 'three'],
  music: [],
  perDay: 3,
  days: 2,
  used: {},
}

let storedBank: BatchBank = bank

vi.mock('./store', async (original) => {
  const real = await original<Record<string, unknown>>()
  const stubs = Object.fromEntries(Object.keys(real).map((key) => [key, typeof real[key] === 'function' ? vi.fn(async () => undefined) : real[key]]))
  return { ...stubs, loadBatchBank: vi.fn(async () => structuredClone(storedBank)), saveBatchBank: vi.fn(async () => undefined) }
})

import { BatchView } from './BatchView'
import type { Job } from './jobs'
import type { Campaign } from './look'
import type { CampaignPlace, LocalPosting } from './posting'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLElement
let root: Root

beforeEach(() => {
  storedBank = bank
  localStorage.clear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const campaign = { id: 'inflow', name: 'Inflow', angles: [{ id: 'a1', name: 'Main' }] } as unknown as Campaign

function posting(place: Partial<CampaignPlace>): LocalPosting {
  return {
    sendHere: true,
    profile: {
      id: 'p1',
      accounts: [{ id: 'tt', name: 'Inflow', platform: 'tiktok', profile: 'inflow', picture: '', disabled: false }],
      settings: { campaigns: { inflow: { accounts: ['tt'], times: [], ...place } } },
      timezone: 'America/Toronto',
      hasAnthropic: true,
      vapidPublic: null,
    },
  }
}

async function show(place: Partial<CampaignPlace>, jobs: Job[] = [], onMake = vi.fn()) {
  const render = (list: Job[]) =>
    root.render(<BatchView campaigns={[campaign]} posting={posting(place)} jobs={list} onMake={onMake} onRetry={() => {}} onRemove={() => {}} />)
  await act(async () => render(jobs))
  return { onMake, rerender: (list: Job[]) => act(async () => render(list)) }
}

const makeButton = () => host.querySelector('.batch-make') as HTMLButtonElement

describe('the Make button', () => {
  it('makes one batch however fast it is tapped twice', async () => {
    const { onMake } = await show({})
    expect(makeButton().disabled).toBe(false)
    await act(async () => {
      makeButton().click()
      makeButton().click()
    })
    expect(onMake).toHaveBeenCalledTimes(1)
    expect(makeButton().disabled).toBe(true)
    expect(makeButton().textContent).toBe('Making…')
  })

  it("stays busy, counting, while this campaign's batch is made", async () => {
    const job = (id: string) => ({ id, campaignId: 'inflow', status: 'queued', batch: { id: 'b1', date: '2099-01-01', time: '10:00', size: 6 } }) as unknown as Job
    await show({}, [job('1'), job('2'), job('3'), job('4')])
    expect(makeButton().disabled).toBe(true)
    expect(makeButton().textContent).toBe('Making 3 of 6…')
  })

  it('names the days it would make', async () => {
    await show({})
    expect(makeButton().textContent).toMatch(/^Make \d+ videos - .+ to .+$/)
  })
})

describe('videos a day', () => {
  const more = () => host.querySelector('[aria-label="More a day"]') as HTMLButtonElement
  const value = () => host.querySelector('[aria-label="Videos a day"]')?.textContent
  const upTo = async (n: number) => {
    while (Number(value()) < n) await act(async () => more().click())
  }

  it('goes up to 25 for a campaign with a single time of its own, keeping his time', async () => {
    await show({ times: ['18:00'] })
    await upTo(25)
    expect(value()).toBe('25')
    expect(more().disabled).toBe(true)
    expect(host.textContent).toContain('At your times and random ones in between')
    expect(host.querySelector('.stepper + .hint')?.textContent).toMatch(/6(:00)? PM/)
  })

  it("goes past a random campaign's 3 a day, all 25 inside the window", async () => {
    await show({ window: { from: '10:00', to: '22:00', perDay: 3 } })
    await upTo(25)
    expect(host.textContent).not.toContain('only fits')
  })

  it('says when the window is too short for that many', async () => {
    await show({ window: { from: '12:00', to: '13:00', perDay: 2 } })
    await upTo(10)
    expect(host.textContent).toContain('The window only fits 6 a day')
  })
})

describe('the "Claude + X" hook', () => {
  const logo = (id: string, name: string) => ({ id, name, type: 'image/png', size: 1000 })

  it('needs both logos instead of headlines', async () => {
    storedBank = { ...bank, headlines: [], hook: 'formula', formula: { left: logo('l', 'claude.png'), right: null, min: 500, max: 1000 } }
    await show({})
    expect(makeButton().disabled).toBe(true)
    expect(host.textContent).toContain('Add both logos first.')
  })

  it('gives every video the same two logos and its own amount, with no headline needed', async () => {
    storedBank = { ...bank, headlines: [], hook: 'formula', formula: { left: logo('l', 'claude.png'), right: logo('r', 'openart-logo.png'), min: 500, max: 1000 } }
    const { onMake } = await show({})
    await act(async () => makeButton().click())
    expect(onMake).toHaveBeenCalledTimes(1)
    const videos = onMake.mock.calls[0][2] as { headline: string; formula?: { left: { id: string }; right: { id: string }; line: string } }[]
    expect(videos.length).toBeGreaterThan(1)
    for (const v of videos) {
      expect(v.formula?.left.id).toBe('l')
      expect(v.formula?.right.id).toBe('r')
      expect(v.formula?.line).toMatch(/^\$(\d{3}|1,000)( a day|\/day| per day| daily)$/)
      expect(v.headline).toBe(`Claude + Openart = ${v.formula?.line}`)
    }
  })
})

describe('a batch on top of one still running', () => {
  const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
  const day = (offset: number) => {
    const d = new Date()
    d.setDate(d.getDate() + offset)
    return d
  }
  const iso = (d: Date) => d.toLocaleDateString('en-CA')
  const post = (offset: number, hhmm: string) => {
    const d = day(offset)
    d.setHours(Number(hhmm.slice(0, 2)), Number(hhmm.slice(3, 5)), 0, 0)
    return { id: `${offset}-${hhmm}`, campaignId: 'inflow', status: 'scheduled', postAt: d.toISOString() }
  }
  const scheduled = [1, 2, 3].flatMap((o) => [post(o, '12:00'), post(o, '14:30'), post(o, '17:00')])

  beforeEach(() => {
    storedBank = { ...bank, perDay: 2, days: 3, madeThrough: '2099-12-31', lastPerDay: 3 }
    localStorage.setItem('cutter.posts', JSON.stringify(scheduled))
  })

  it('goes on top, from today, on the days already scheduled - clear of their times', async () => {
    const { onMake } = await show({})
    const choice = host.querySelector('[aria-label="When this batch posts"] [aria-checked="true"]')
    expect(choice?.textContent).toBe('On top - from today')
    expect(host.textContent).toContain('More a day')
    expect(makeButton().textContent).toMatch(/^Make \d+ more videos - /)
    await act(async () => makeButton().click())
    const videos = onMake.mock.calls[0][2] as { batch: { date: string; time: string } }[]
    expect(videos[0].batch.date <= iso(day(1))).toBe(true)
    for (const v of videos) {
      expect(v.batch.time >= '11:00' && v.batch.time <= '18:00').toBe(true)
      const taken = scheduled.filter((p) => new Date(p.postAt).toLocaleDateString('en-CA') === v.batch.date)
      for (const p of taken) {
        const t = new Date(p.postAt)
        const at = t.getHours() * 60 + t.getMinutes()
        expect(Math.abs(at - minutes(v.batch.time))).toBeGreaterThanOrEqual(20)
      }
    }
  })

  it('says how many a day that makes while both run', async () => {
    await show({})
    expect(host.querySelector('.batch-total')?.textContent).toMatch(/3 already on .+ \+ 2 = 5 that day/)
  })

  it('keeps where the next batch after them starts', async () => {
    const { saveBatchBank } = await import('./store')
    const { onMake } = await show({})
    await act(async () => makeButton().click())
    expect(onMake).toHaveBeenCalled()
    const saved = (saveBatchBank as unknown as { mock: { calls: [BatchBank][] } }).mock.calls.at(-1)![0]
    expect(saved.madeThrough).toBe('2099-12-31')
  })

  it('can still go after the last one instead', async () => {
    await show({})
    const after = [...host.querySelectorAll('[aria-label="When this batch posts"] button')].find((b) => b.textContent?.startsWith('After')) as HTMLButtonElement
    await act(async () => after.click())
    expect(makeButton().textContent).toMatch(/Jan 1/)
  })
})
