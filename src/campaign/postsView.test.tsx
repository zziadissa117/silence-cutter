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

const redoCaptions = vi.fn(async (_campaignId: string, _posting: unknown, ids?: string[], _mode?: string) => ({ rewriting: ids?.length ?? 0, tooSoon: 0 }))
const postAction = vi.fn(async (action: string, id: string) => ({ ...waitingPost(id), ready: action === 'ready' }))
/** What the last post action carried besides its action and post. */
let sentFields: unknown

const posts = [
  waitingPost('w1'),
  waitingPost('r1', true),
  ...Array.from({ length: 25 }, (_, i) => scheduled(`b${i}`, 'polsia', 'Polsia', 'big', i + 1)),
  ...Array.from({ length: 2 }, (_, i) => scheduled(`c${i}`, 'polsia', 'Polsia', 'small', 30 + i)),
  ...Array.from({ length: 5 }, (_, i) => ({ ...scheduled(`n${i}`, 'nova', 'Nova', 'new', 40 + i), status: 'waiting', caption: 'A caption', approval: 'you' }) as unknown as ServerPost),
  scheduled('one', 'inflow', 'Inflow', undefined, 2),
  { ...scheduled('half', 'wron', 'Wron', undefined, -3), status: 'posted', error: 'Not posted to Jake (Instagram).' } as ServerPost,
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
  postAction: (action: string, id: string, fields?: unknown) => {
    sentFields = fields
    return postAction(action, id)
  },
  redoCaptions: (campaignId: string, posting: unknown, ids?: string[], mode?: string) => redoCaptions(campaignId, posting, ids, mode),
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
const polsiaRow = () => [...host.querySelectorAll('.batch-row')].find((r) => r.textContent?.includes('Polsia ·'))!
const chip = (name: string) => [...host.querySelectorAll('.posts-filter button')].find((b) => b.textContent === name) as HTMLButtonElement

describe('scheduled posts', () => {
  it('folds a batch of 25 into one row he can open', async () => {
    expect(rows()).toHaveLength(2)
    expect(host.textContent).toContain('Polsia · 27 videos')
    await act(async () => (polsiaRow().querySelector('.post-head') as HTMLButtonElement).click())
    expect(polsiaRow().querySelectorAll('.batch-inside .day-group .post')).toHaveLength(27)
    // Day by day, like a calendar.
    expect(polsiaRow().querySelectorAll('.batch-inside .day-title').length).toBeGreaterThanOrEqual(1)
  })

  it('folds every batch of a campaign into one row', () => {
    // Polsia's 25 come from one batch and its two more from another.
    expect(host.textContent).not.toContain('Polsia · 2 videos')
  })

  it('shows one campaign at a time, and remembers it', async () => {
    await act(async () => chip('Inflow 1').click())
    expect(rows()).toHaveLength(1)
    expect(host.textContent).not.toContain('Polsia · 27 videos')
    expect(localStorage.getItem('cutter.posts.show')).toBe('inflow')
    await act(async () => chip('All 36').click())
    expect(rows()).toHaveLength(2)
  })
})

describe('a new batch to approve', () => {
  const novaRow = () => [...host.querySelectorAll('.batch-row')].find((r) => r.textContent?.includes('Nova · 5 videos'))!

  it('shows its first 3 open with their video, and approves all 5 in one tap', async () => {
    expect(novaRow().querySelectorAll('.batch-inside > .post')).toHaveLength(3)
    expect(novaRow().textContent).toContain('Show the other 2')
    const all = [...novaRow().querySelectorAll('button')].find((b) => b.textContent === 'Approve all 5') as HTMLButtonElement
    postAction.mockClear()
    await act(async () => all.click())
    expect(postAction.mock.calls.filter((c) => c[0] === 'approve').map((c) => c[1]).sort()).toEqual(['n0', 'n1', 'n2', 'n3', 'n4'])
  })
})

describe('approve, post later', () => {
  const button = (name: string) => [...host.querySelectorAll('button')].filter((b) => b.textContent === name)

  it('sits next to Approve and holds the post instead of sending it', async () => {
    expect(button('Approve').length).toBeGreaterThanOrEqual(1)
    await act(async () => button('Approve, post later')[0].click())
    expect(postAction).toHaveBeenCalledWith('ready', 'w1')
    expect(host.textContent).toContain('Ready to post · 2')
  })

  it('has Post now beside Approve: approved with a time of now', async () => {
    const before = Date.now()
    await act(async () => button('Post now')[0].click())
    expect(postAction).toHaveBeenCalledWith('approve', 'w1')
    expect(Date.parse((sentFields as { at: string }).at)).toBeGreaterThanOrEqual(before)
  })

  it('keeps a held post under Ready to post, with Post instead of Approve', () => {
    expect(host.textContent).toContain('Ready to post · 1')
    expect(button('Post')).toHaveLength(1)
    expect(host.textContent).toContain('it waits here until you tap Post')
  })
})

describe('redo captions', () => {
  it('adds the missing hashtags to the whole batch in one tap, after he says yes', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const add = [...polsiaRow().querySelectorAll('button')].find((b) => b.textContent === 'Add missing hashtags') as HTMLButtonElement
    await act(async () => add.click())
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Add #polsia to these 27 Polsia posts? Captions stay as they are'))
    expect(redoCaptions).toHaveBeenCalledWith('polsia', expect.objectContaining({ hashtags: ['#polsia'] }), [...Array.from({ length: 25 }, (_, i) => `b${i}`), 'c0', 'c1'], 'hashtags')
    expect(host.textContent).toContain('Adding #polsia to 27 Polsia posts - captions stay as they are')
  })

  it('can still rewrite them, as a second choice', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const rewrite = [...polsiaRow().querySelectorAll('button')].find((b) => b.textContent === 'Rewrite captions') as HTMLButtonElement
    await act(async () => rewrite.click())
    expect(redoCaptions).toHaveBeenLastCalledWith('polsia', expect.anything(), expect.any(Array), 'rewrite')
  })
})

describe('the scheduled clock', () => {
  const scheduledList = () => [...host.querySelectorAll('.list-title')].find((t) => t.textContent?.startsWith('Scheduled'))!.nextElementSibling!

  it('marks a scheduled batch and a scheduled post with the blue clock instead of a dot', () => {
    const list = scheduledList()
    expect(list.querySelectorAll('[aria-label="Scheduled"]')).toHaveLength(2)
    expect(list.querySelectorAll(':scope > li > .post-head > .dot')).toHaveLength(0)
    expect(list.querySelector('.post-when.scheduled')).not.toBeNull()
  })

  it('leaves posts that are not waiting for their time without it', () => {
    const waiting = [...host.querySelectorAll('.list-title')].find((t) => t.textContent?.startsWith('To approve'))!.nextElementSibling!
    expect(waiting.querySelectorAll('[aria-label="Scheduled"]')).toHaveLength(0)
  })
})

describe('a video that missed one of its accounts', () => {
  it('says which one, and posts again to only the missing ones in one tap', async () => {
    const button = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Post again to the missing ones')
    expect(host.textContent).toContain('Not posted to Jake (Instagram).')
    expect(button).toBeTruthy()
    await act(async () => button!.click())
    expect(postAction).toHaveBeenCalledWith('retry-accounts', 'half')
  })
})
