// The Posts screen with big batches: folded into one row each, and a filter
// by campaign so one campaign's posts don't fill the page.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ServerPost } from './posting'

const future = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString()
const scheduled = (id: string, campaignId: string, name: string, batch?: string, h = 1) =>
  ({
    id,
    key: id,
    campaignId,
    campaignName: name,
    status: 'scheduled',
    postAt: future(h),
    accounts: [],
    links: {},
    caption: '',
    batch: batch ? { id: batch, date: '2099-01-01', time: '10:00', size: 25 } : null,
  }) as unknown as ServerPost

const waitingPost = (id: string, ready = false) =>
  ({ ...scheduled(id, 'vertus', 'Vertus', undefined, 3), status: 'waiting', caption: 'A caption', approval: 'you', ready }) as unknown as ServerPost

const redoCaptions = vi.fn(async (_campaignId: string, _posting: unknown, ids?: string[]) => ({ rewriting: ids?.length ?? 0, tooSoon: 0 }))
const postAction = vi.fn(async (action: string, id: string) => ({ ...waitingPost(id), ready: action === 'ready' }))

const posts = [
  waitingPost('w1'),
  waitingPost('r1', true),
  ...Array.from({ length: 25 }, (_, i) => scheduled(`b${i}`, 'polsia', 'Polsia', 'big', i + 1)),
  scheduled('one', 'inflow', 'Inflow', undefined, 2),
]

vi.mock('./store', async (original) => {
  const real = await original<Record<string, unknown>>()
  return Object.fromEntries(Object.keys(real).map((key) => [key, typeof real[key] === 'function' ? vi.fn() : real[key]]))
})
vi.mock('./outbox', () => ({
  copyKind: vi.fn(async () => null),
  forgetSend: vi.fn(),
  kick: vi.fn(),
  localVideo: vi.fn(async () => null),
  sending: () => [],
  tidySends: vi.fn(),
  watchSending: () => () => {},
}))
vi.mock('./posting', async (original) => ({
  ...(await original<typeof import('./posting')>()),
  lastPosts: () => posts,
  listPosts: vi.fn(async () => posts),
  postingHere: () => null,
  postAction: (action: string, id: string) => postAction(action, id),
  redoCaptions: (campaignId: string, posting: unknown, ids?: string[]) => redoCaptions(campaignId, posting, ids),
}))

import { PostsView } from './PostsView'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLElement
let root: Root

beforeEach(async () => {
  localStorage.clear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root.render(<PostsView campaigns={[{ id: 'polsia', name: 'Polsia', posting: { caption: 'claude', rules: '', hashtags: ['#polsia'], approval: 'me', remind: false } } as never]} onBack={() => {}} editable={{}} onEditAgain={() => {}} />))
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const scheduledRows = () => [...host.querySelectorAll('.list-title')].find((t) => t.textContent?.startsWith('Scheduled'))!.nextElementSibling!.children
const rows = scheduledRows
const chip = (name: string) => [...host.querySelectorAll('.posts-filter button')].find((b) => b.textContent === name) as HTMLButtonElement

describe('scheduled posts', () => {
  it('folds a batch of 25 into one row he can open', async () => {
    expect(rows()).toHaveLength(2)
    expect(host.textContent).toContain('Polsia · 25 videos')
    await act(async () => (host.querySelector('.batch-row .post-head') as HTMLButtonElement).click())
    expect(host.querySelectorAll('.batch-inside > li')).toHaveLength(25)
  })

  it('shows one campaign at a time, and remembers it', async () => {
    await act(async () => chip('Inflow 1').click())
    expect(rows()).toHaveLength(1)
    expect(host.textContent).not.toContain('Polsia · 25 videos')
    expect(localStorage.getItem('cutter.posts.show')).toBe('inflow')
    await act(async () => chip('All 28').click())
    expect(rows()).toHaveLength(2)
  })
})

describe('approve, post later', () => {
  const button = (name: string) => [...host.querySelectorAll('button')].filter((b) => b.textContent === name)

  it('sits next to Approve and holds the post instead of sending it', async () => {
    expect(button('Approve')).toHaveLength(1)
    await act(async () => button('Approve, post later')[0].click())
    expect(postAction).toHaveBeenCalledWith('ready', 'w1')
    expect(host.textContent).toContain('Ready to post · 2')
  })

  it('keeps a held post under Ready to post, with Post instead of Approve', () => {
    expect(host.textContent).toContain('Ready to post · 1')
    expect(button('Post')).toHaveLength(1)
    expect(host.textContent).toContain('it waits here until you tap Post')
  })
})

describe('redo captions', () => {
  it("writes a batch's captions again with the campaign's rules, after he says yes", async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const redo = [...host.querySelectorAll('.batch-row button')].find((b) => b.textContent === 'Redo captions') as HTMLButtonElement
    await act(async () => redo.click())
    expect(redoCaptions).toHaveBeenCalledWith('polsia', expect.objectContaining({ hashtags: ['#polsia'] }), Array.from({ length: 25 }, (_, i) => `b${i}`))
    expect(host.textContent).toContain('Rewriting 25 Polsia captions with the new rules')
  })
})
