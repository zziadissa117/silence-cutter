// Posting times: his own, or random ones inside a window - never silently
// "the moment it's ready".

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./store', async (original) => {
  // The real module needs IndexedDB, which jsdom lacks; every export is a
  // stub, and nothing here reaches the store.
  const real = await original<Record<string, unknown>>()
  return Object.fromEntries(Object.keys(real).map((key) => [key, typeof real[key] === 'function' ? vi.fn() : real[key]]))
})

import type { Campaign } from './look'
import type { CampaignPlace, LocalPosting } from './posting'
import { PostingEditor } from './PostingEditor'

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

const campaign = { id: 'inflow', name: 'Inflow', angles: [], posting: undefined } as unknown as Campaign

function local(place?: Partial<CampaignPlace>): LocalPosting {
  return {
    sendHere: true,
    profile: {
      id: 'p1',
      accounts: [{ id: 'tt', name: 'Inflow', platform: 'tiktok', profile: 'inflow', picture: '', disabled: false }],
      settings: { campaigns: place ? { inflow: { accounts: ['tt'], times: [], ...place } } : {} },
      timezone: 'America/Toronto',
      hasAnthropic: true,
      vapidPublic: null,
    },
  }
}

function show(posting: LocalPosting, onSave = vi.fn(async () => {})) {
  act(() => root.render(<PostingEditor campaign={campaign} local={posting} onSave={onSave} onCancel={() => {}} onSetUp={() => {}} />))
  return onSave
}

const button = (name: string) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === name) as HTMLButtonElement

describe('when a campaign posts', () => {
  it('opens on Random times, with the default window, for a campaign with neither', () => {
    show(local({ accounts: ['tt'] }))
    expect(button('Random times').getAttribute('aria-checked')).toBe('true')
    expect((host.querySelector('[aria-label="Earliest random time"]') as HTMLInputElement).value).toBe('10:00')
    expect(host.textContent).not.toContain("posts the moment it's ready")
  })

  it('saves random times inside a window, and no times of his own', async () => {
    const onSave = show(local({ accounts: ['tt'], times: ['18:00'] }))
    act(() => button('Random times').click())
    expect(host.textContent).toContain('A different random time each day')
    await act(async () => button('Save posting').click())
    expect(onSave).toHaveBeenCalledTimes(1)
    const place = (onSave.mock.calls[0] as unknown[])[1] as CampaignPlace
    expect(place).toEqual({ accounts: ['tt'], times: [], window: { from: '10:00', to: '22:00', perDay: 3 } })
  })

  it('opens on Random for a campaign that already has a window', () => {
    show(local({ accounts: ['tt'], window: { from: '12:00', to: '20:00', perDay: 3 } }))
    expect(button('Random times').getAttribute('aria-checked')).toBe('true')
    expect((host.querySelector('[aria-label="Earliest random time"]') as HTMLInputElement).value).toBe('12:00')
  })

  it('saves his own times without a window', async () => {
    const onSave = show(local({ accounts: ['tt'], times: ['18:00'], window: { from: '12:00', to: '20:00', perDay: 3 } }))
    await act(async () => button('Save posting').click())
    const place = (onSave.mock.calls[0] as unknown[])[1] as CampaignPlace
    expect(place).toEqual({ accounts: ['tt'], times: ['18:00'] })
  })
})

describe('redoing captions already made', () => {
  const later = new Date(Date.now() + 24 * 3_600_000).toISOString()
  const seen = (posts: object[]) => localStorage.setItem('cutter.posts', JSON.stringify(posts))
  const redoBox = () => [...host.querySelectorAll('label.toggle')].find((l) => l.textContent?.includes('Redo the captions already made'))?.querySelector('input') as HTMLInputElement | undefined

  it('offers it unticked when there are posts not out yet, and ticks itself when the hashtags change', async () => {
    seen([{ id: '1', campaignId: 'inflow', status: 'scheduled', postAt: later, accounts: [{ id: 'tt', name: 'Inflow', platform: 'tiktok', profile: 'inflow' }] }])
    const onSave = show(local({ accounts: ['tt'] }))
    expect(redoBox()?.checked).toBe(false)
    const tags = host.querySelector('input[placeholder="e.g. #pumpfunpartner"]') as HTMLInputElement
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(tags, '#newtag')
      tags.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(redoBox()?.checked).toBe(true)
    await act(async () => button('Save posting').click())
    expect((onSave.mock.calls[0] as unknown[])[3]).toBe(true)
  })

  it("doesn't show with nothing made", () => {
    seen([])
    show(local({ accounts: ['tt'] }))
    expect(redoBox()).toBeUndefined()
  })
})
