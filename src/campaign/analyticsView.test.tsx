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
import type { Insights, Profile } from './posting'

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

const row = (key: string, views: number, videos: number, mark?: 'best' | 'worst') => ({ key, label: key, views, videos, score: views, ...(mark ? { mark } : {}) })
let insights: Insights = { campaigns: [], bestHours: null }
const extra = {
  onIdeas: vi.fn(async () => ({ headlines: ['POV: you found it', 'Nobody tells you this'] })),
  onAddHeadline: vi.fn(async () => undefined),
  onPauseAccount: vi.fn(async () => undefined),
}

function Screen({
  onAnswer,
  onTarget,
  onUseBest,
  onBestHoursOff,
}: {
  onAnswer: (id: string, to: number | null) => void
  onTarget: (id: string, t: number | null) => void
  onUseBest: (id: string, on: boolean) => void
  onBestHoursOff: (off: boolean) => void
}) {
  const rows = useCampaignRows([campaign], profile, views, 0)
  return (
    <AnalyticsView
      rows={rows}
      profile={profile}
      loading={false}
      insights={insights}
      onAnswer={onAnswer}
      onTarget={onTarget}
      onUseBest={onUseBest}
      onBestHoursOff={onBestHoursOff}
      onIdeas={extra.onIdeas}
      onAddHeadline={extra.onAddHeadline}
      onPauseAccount={extra.onPauseAccount}
    />
  )
}

async function show() {
  const onAnswer = vi.fn()
  const onTarget = vi.fn()
  const onUseBest = vi.fn()
  const onBestHoursOff = vi.fn()
  await act(async () => root.render(<Screen onAnswer={onAnswer} onTarget={onTarget} onUseBest={onUseBest} onBestHoursOff={onBestHoursOff} />))
  await act(async () => {})
  return { onAnswer, onTarget, onUseBest, onBestHoursOff }
}

const button = (text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)

describe('what works and when to post', () => {
  beforeEach(() => {
    insights = { campaigns: [], bestHours: null }
  })

  it('shows each kind best first, marked, and Use the best hooks turns it on', async () => {
    insights = {
      campaigns: [
        {
          id: 'inflow',
          name: 'Inflow',
          videos: 40,
          views: 900,
          rows: {
            headline: [row('i made $800 a day', 2100, 9, 'best'), row('nobody talks about this', 800, 8), row('stop scrolling', 200, 7, 'worst')],
            reaction: [row('IMG_0249', 1500, 12, 'best'), row('IMG_0330', 400, 10)],
            song: [],
            look: [],
          },
        },
      ],
      bestHours: null,
    }
    const { onUseBest } = await show()
    expect(host.textContent).toContain('Headlines')
    expect(host.textContent).toContain('i made $800 a day')
    expect(host.textContent).toContain('★ Best')
    expect(host.textContent).toContain('Worst')
    expect(host.textContent).toContain('Songs are counted from videos made from Nov 1 on')
    await act(async () => button('Use the best hooks')!.click())
    expect(onUseBest).toHaveBeenCalledWith('inflow', true)
  })

  it('Write more like the best shows Claude\'s headlines, each added with a tap', async () => {
    insights = {
      campaigns: [{ id: 'inflow', name: 'Inflow', videos: 20, views: 900, rows: { headline: [row('i made $800 a day', 2100, 9, 'best')], reaction: [], song: [], look: [] } }],
      bestHours: null,
    }
    await show()
    await act(async () => button('Write more like the best')!.click())
    expect(extra.onIdeas).toHaveBeenCalled()
    expect(host.textContent).toContain('POV: you found it')
    await act(async () => button('Add')!.click())
    expect(extra.onAddHeadline).toHaveBeenCalledWith('inflow', 'POV: you found it')
    expect(host.textContent).toContain('Added')
  })

  it('an account that stopped getting views shows with a Pause', async () => {
    insights = { campaigns: [], bestHours: null, trouble: [{ id: 'tt', name: 'Inflow', profile: 'inflow.pay', platform: 'tiktok', recent: 40, usual: 1200, videos: 6 }] }
    await show()
    expect(host.textContent).toContain('Accounts that stopped getting views')
    expect(host.textContent).toContain('@inflow.pay')
    expect(host.textContent).not.toContain('Inflow ·')
    await act(async () => button('Pause')!.click())
    expect(extra.onPauseAccount).toHaveBeenCalledWith('tt', true)
  })

  it('says it is still learning the hours until enough videos are in', async () => {
    insights = { campaigns: [], bestHours: { weights: [], videos: 40, at: new Date().toISOString() } }
    await show()
    expect(host.textContent).toContain('When to post')
    expect(host.textContent).toContain('40 so far')
  })

  it('shows the week of hours once learnt, with a switch', async () => {
    const day = Array.from({ length: 24 }, (_, h) => (h >= 13 && h < 16 ? 2 : 0.85))
    insights = { campaigns: [], bestHours: { weights: Array.from({ length: 7 }, () => day), videos: 400, at: new Date().toISOString() } }
    const { onBestHoursOff } = await show()
    expect(host.querySelectorAll('.heat-cell')).toHaveLength(7 * 24)
    expect(host.textContent).toContain('most at 1 PM - 4 PM')
    await act(async () => button('Turn off')!.click())
    expect(onBestHoursOff).toHaveBeenCalledWith(true)
  })
})

describe('the Analytics tab', () => {
  it("shows a batch campaign's views a video and its trend - and nothing account by account", async () => {
    await show()
    expect(host.textContent).toContain('Inflow')
    expect(host.textContent).toContain('3 a day')
    expect(host.textContent).toContain('1.3K')
    expect(host.textContent).toContain('▲ 39% on last week')
    expect(host.textContent).not.toContain('@inflow.pay')
    expect(host.textContent).not.toContain('followers')
  })

  it('suggests more a day when views are up, and Yes says the new number', async () => {
    const { onAnswer } = await show()
    expect(host.textContent).toContain('Ready for 4 a day?')
    const yes = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Yes, 4 a day') as HTMLButtonElement
    await act(async () => yes.click())
    expect(onAnswer).toHaveBeenCalledWith('inflow', 4)
  })

  it('leaves out a campaign with no batch - his own accounts', async () => {
    storedBank = bank({ running: false })
    await show()
    expect(host.textContent).not.toContain('Inflow')
    expect(host.textContent).toContain('Your batch campaigns show up here')
  })

  it('keeps a batch that was stopped, without suggesting anything', async () => {
    storedBank = bank({ running: false, madeThrough: '2026-10-20' })
    await show()
    expect(host.textContent).toContain('Inflow')
    expect(host.textContent).toContain('Stopped')
    expect(host.textContent).not.toContain('Ready for')
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
