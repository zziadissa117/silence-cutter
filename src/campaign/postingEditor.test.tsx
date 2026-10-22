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
    expect((host.querySelector('[aria-label="Earliest random time"]') as HTMLInputElement).value).toBe('11:00')
    expect(host.textContent).not.toContain("posts the moment it's ready")
  })

  it('saves random times inside a window, and no times of his own', async () => {
    const onSave = show(local({ accounts: ['tt'], times: ['18:00'] }))
    act(() => button('Random times').click())
    expect(host.textContent).toContain('A different random time each day')
    await act(async () => button('Save posting').click())
    expect(onSave).toHaveBeenCalledTimes(1)
    const place = (onSave.mock.calls[0] as unknown[])[1] as CampaignPlace
    expect(place).toEqual({ accounts: ['tt'], times: [], window: { from: '11:00', to: '18:00', perDay: 3 } })
  })

  it('keeps his night times like any other', () => {
    show(local({ accounts: ['tt'], times: ['03:43', '13:42'] }))
    expect(host.textContent).not.toMatch(/skipped/)
    expect(host.querySelector('[aria-label="Remove 3:43 AM"]')?.className).toBe('active')
  })

  it('uses the whole window, and says when it runs past midnight', () => {
    show(local({ accounts: ['tt'], window: { from: '10:00', to: '22:00', perDay: 3 } }))
    expect(host.textContent).not.toMatch(/of it is used/)
    act(() => {
      const to = host.querySelector('[aria-label="Latest random time"]') as HTMLInputElement
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(to, '02:00')
      to.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(host.textContent).toMatch(/It runs past midnight, to 2(:00)? AM/)
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
  const redoBox = () => [...host.querySelectorAll('label.toggle')].find((l) => l.textContent?.includes('Add the hashtags to posts already made'))?.querySelector('input') as HTMLInputElement | undefined

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
    expect((onSave.mock.calls[0] as unknown[])[3]).toBe('hashtags')
    expect(host.textContent).not.toContain('Rewrite them with the new rules instead')
  })

  it("doesn't show with nothing made", () => {
    seen([])
    show(local({ accounts: ['tt'] }))
    expect(redoBox()).toBeUndefined()
  })
})

describe('the Instagram location', () => {
  const withInstagram = (place: Partial<CampaignPlace>, instagramPlace?: { id: string; name: string }): LocalPosting => {
    const posting = local(place)
    posting.profile.accounts.push({ id: 'ig', name: 'Michaelangelo', platform: 'instagram', profile: 'traderzi2', picture: '', disabled: false })
    if (instagramPlace) posting.profile.settings.instagramPlace = instagramPlace
    return posting
  }
  const type = (input: HTMLInputElement, value: string) =>
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })

  it('is only asked for a campaign posting to Instagram', () => {
    show(local({ accounts: ['tt'] }))
    expect(host.textContent).not.toContain('Instagram location')
    act(() => root.unmount())
    root = createRoot(host)
    show(withInstagram({ accounts: ['ig'] }, { id: '110970792260960', name: 'Los Angeles California' }))
    expect(host.textContent).toContain('Same as every campaign: Los Angeles California')
  })

  it("gives a campaign its own place from a pasted link, saved with its posting - and kept when saved again", async () => {
    const onSave = show(withInstagram({ accounts: ['ig'] }))
    await type(host.querySelector('input[aria-label^="Instagram location"]') as HTMLInputElement, 'https://www.facebook.com/pages/New-York-New-York/108424279189115')
    await act(async () => button('Set').click())
    expect(host.textContent).toContain("New York New York · tagged on this campaign's Instagram posts")
    await act(async () => button('Save posting').click())
    const saved = (onSave.mock.calls[0] as unknown[])[1] as CampaignPlace
    expect(saved.instagramPlace).toEqual({ id: '108424279189115', name: 'New York New York' })
  })

  it('says so when nothing can be read from what was pasted', async () => {
    show(withInstagram({ accounts: ['ig'] }))
    await type(host.querySelector('input[aria-label^="Instagram location"]') as HTMLInputElement, 'facebook.com/LosAngeles')
    await act(async () => button('Set').click())
    expect(host.textContent).toContain('No place could be read from that.')
  })
})
