// New post: a video already sent for the campaign is skipped and named -
// and Add anyway posts it again, as a post of its own.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./outbox', () => ({
  fingerprintsFor: vi.fn(async () => new Set(['fp-sent.mp4'])),
  isQueued: vi.fn(async () => false),
  queueSend: vi.fn(async () => 'queued'),
}))
vi.mock('./fingerprint', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  fingerprint: vi.fn(async (file: File) => `fp-${file.name}`),
}))
vi.mock('./filming', () => ({ filmingOf: vi.fn(async () => ({ seconds: 3 })) }))
vi.mock('./stills', () => ({ stillsOf: vi.fn(async () => []) }))
vi.mock('./toMp4', () => ({ asMp4: vi.fn(async (file: File) => ({ file, storedAs: null })) }))
vi.mock('./posting', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  writeCaptionFor: vi.fn(async () => 'A caption'),
}))

import { queueSend } from './outbox'
import type { Campaign } from './look'
import { NewPost } from './NewPost'
import type { Profile } from './posting'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const campaign = { id: 'inflow', name: 'Inflow', angles: [] } as unknown as Campaign
const profile = {
  id: 'p1',
  accounts: [{ id: 'tt', name: 'inflow', platform: 'tiktok', profile: 'inflow', picture: '', disabled: false }],
  settings: { campaigns: { inflow: { accounts: ['tt'], times: [] } } },
  timezone: 'America/Toronto',
} as unknown as Profile

let host: HTMLElement
let root: Root

beforeEach(() => {
  localStorage.clear()
  vi.mocked(queueSend).mockClear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const button = (text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(text)) as HTMLButtonElement | undefined
const wait = () => act(() => new Promise((resolve) => setTimeout(resolve, 50)))

describe('a video already sent', () => {
  it('is skipped and named, and Add anyway posts it again with a key of its own', async () => {
    await act(async () => root.render(<NewPost campaigns={[campaign]} profile={profile} onDone={() => {}} onCancel={() => {}} />))
    const input = host.querySelector('input[aria-label="Choose the videos"]') as HTMLInputElement
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'sent.mp4', { type: 'video/mp4' })] })
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
    await wait()
    expect(host.textContent).toContain('sent.mp4')
    expect(host.querySelector('ol[aria-label="Videos to post"]')).toBeNull()

    await act(async () => button('Add it anyway - post again')!.click())
    await wait()
    expect(host.querySelector('ol[aria-label="Videos to post"]')?.textContent).toContain('sent.mp4')
    expect(button('Add it anyway')).toBeUndefined()

    const post = [...host.querySelectorAll('button.btn.primary')].find((b) => b.textContent === 'Post now') as HTMLButtonElement
    await act(async () => post.click())
    await wait()
    expect(queueSend).toHaveBeenCalledTimes(1)
    const sent = vi.mocked(queueSend).mock.calls[0][0] as { key: string; fp: string }
    expect(sent.fp).toBe('fp-sent.mp4')
    expect(sent.key).toMatch(/~again-\d+$/)
  })
})
