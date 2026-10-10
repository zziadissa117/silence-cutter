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

vi.mock('./store', async (original) => {
  const real = await original<Record<string, unknown>>()
  const stubs = Object.fromEntries(Object.keys(real).map((key) => [key, typeof real[key] === 'function' ? vi.fn(async () => undefined) : real[key]]))
  return { ...stubs, loadBatchBank: vi.fn(async () => structuredClone(bank)), saveBatchBank: vi.fn(async () => undefined) }
})

import { BatchView } from './BatchView'
import type { Job } from './jobs'
import type { Campaign } from './look'
import type { CampaignPlace, LocalPosting } from './posting'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLElement
let root: Root

beforeEach(() => {
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
    expect(makeButton().textContent).toMatch(/^Make 6 videos - .+ to .+$/)
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
    await show({ window: { from: '10:00', to: '11:00', perDay: 2 } })
    await upTo(10)
    expect(host.textContent).toContain('The window only fits 6 a day')
  })
})
