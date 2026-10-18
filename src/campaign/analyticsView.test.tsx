// The Analytics tab: numbers per campaign and account, and a suggestion he
// answers with one tap.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { BatchBank } from './batch'

let storedBank: BatchBank | null = null

vi.mock('./store', async (original) => {
  const real = await original<Record<string, unknown>>()
  const stubs = Object.fromEntries(Object.keys(real).map((key) => [key, typeof real[key] === 'function' ? vi.fn(async () => undefined) : real[key]]))
  return { ...stubs, loadBatchBank: vi.fn(async () => structuredClone(storedBank)), saveBatchBank: vi.fn(async () => undefined) }
})

import { AnalyticsView, answerSuggestion, useCampaignRows } from './AnalyticsView'
import type { ViewsByAccount } from './analytics'
import type { Campaign } from './look'
import type { Profile } from './posting'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const bank = (fields: Partial<BatchBank> = {}): BatchBank => ({
  campaignId: 'inflow',
  angleId: 'a1',
  reactions: [],
  products: [],
  headlines: [],
  music: [],
  perDay: 3,
  days: 7,
  used: {},
  running: true,
  ...fields,
})

const campaign = { id: 'inflow', name: 'Inflow', angles: [{ id: 'a1', name: 'Main' }] } as unknown as Campaign
const profile = {
  id: 'p1',
  accounts: [
    { id: 'tt', name: 'inflow.pay', platform: 'tiktok', profile: 'inflow.pay', picture: '', disabled: false },
    { id: 'ig', name: 'inflow', platform: 'instagram', profile: 'inflow', picture: '', disabled: false },
  ],
  settings: { campaigns: { inflow: { accounts: ['tt', 'ig'], times: [] } } },
  timezone: 'America/Toronto',
  hasAnthropic: true,
  vapidPublic: null,
} as unknown as Profile

const week = (from: number, to: number) =>
  Array.from({ length: 8 }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - 7 + i)
    return { date: d.toISOString().slice(0, 10), perVideo: i === 7 ? to : from }
  })

const views: ViewsByAccount = {
  tt: { views: 25000, followers: 3200, perVideo: 1250, at: new Date().toISOString(), next: '', history: week(900, 1250) },
}

let host: HTMLElement
let root: Root

beforeEach(() => {
  localStorage.clear()
  storedBank = bank()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function Screen({ onAnswer, onTarget }: { onAnswer: (id: string, to: number | null) => void; onTarget: (id: string, t: number | null) => void }) {
  const rows = useCampaignRows([campaign], profile, views, 0)
  return <AnalyticsView rows={rows} profile={profile} views={views} loading={false} onAnswer={onAnswer} onTarget={onTarget} />
}

async function show() {
  const onAnswer = vi.fn()
  const onTarget = vi.fn()
  await act(async () => root.render(<Screen onAnswer={onAnswer} onTarget={onTarget} />))
  await act(async () => {})
  return { onAnswer, onTarget }
}

describe('the Analytics tab', () => {
  it("shows each campaign's views a video, its trend, and each account", async () => {
    await show()
    expect(host.textContent).toContain('Inflow')
    expect(host.textContent).toContain('1.3K')
    expect(host.textContent).toContain('▲ 39% on last week')
    expect(host.textContent).toContain('@inflow.pay · TikTok')
    expect(host.textContent).toContain('3.2K followers')
    // Instagram not read yet.
    expect(host.textContent).toContain('Not read yet')
    expect(host.textContent).toContain('Views for 1 of 2 accounts so far.')
  })

  it('suggests more a day when views are up, and Yes says the new number', async () => {
    const { onAnswer } = await show()
    expect(host.textContent).toContain('Inflow: ready for 4 a day?')
    const yes = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Yes, 4 a day') as HTMLButtonElement
    await act(async () => yes.click())
    expect(onAnswer).toHaveBeenCalledWith('inflow', 4)
  })

  it('suggests nothing for a campaign with no batch running', async () => {
    storedBank = bank({ running: false })
    await show()
    expect(host.textContent).not.toContain('ready for')
    expect(host.textContent).toContain('No batch running')
  })

  it('keeps the number he wants before more a day', async () => {
    const { onTarget } = await show()
    const input = host.querySelector('[aria-label="Views a video before more a day"]') as HTMLInputElement
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
      set.call(input, '1000')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
    expect(onTarget).toHaveBeenCalledWith('inflow', 1000)
  })
})

describe('answering a suggestion', () => {
  it('Yes sets the batch to the new number; either way it is left alone a few days', async () => {
    const { saveBatchBank } = await import('./store')
    await answerSuggestion('inflow', 4)
    expect(vi.mocked(saveBatchBank).mock.calls.at(-1)![0].perDay).toBe(4)
    expect(JSON.parse(localStorage.getItem('analytics.answered')!).inflow).toBeGreaterThan(0)
    vi.mocked(saveBatchBank).mockClear()
    await answerSuggestion('inflow', null)
    expect(saveBatchBank).not.toHaveBeenCalled()
  })
})
