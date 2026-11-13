// The Posts screen with big batches: one list by time, the next first (his
// ask, 2026-11-11), the first 15 and the rest on a tap, a filter by campaign,
// and at the bottom only what went out in the last few hours.

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
  scheduled('one', 'inflow', 'Inflow', undefined, 2.5),
  { ...scheduled('half', 'wron', 'Wron', undefined, -3), status: 'posted', error: 'Not posted to Jake (Instagram).' } as ServerPost,
  { ...scheduled('just', 'wron', 'Wron', undefined, -1), status: 'posted' } as ServerPost,
  { ...scheduled('old', 'wron', 'Wron', undefined, -5), status: 'posted' } as ServerPost,
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

const upNext = () => [...host.querySelectorAll('.day-block .post')] as HTMLElement[]
const titled = (title: string) => [...host.querySelectorAll('.list-title')].find((t) => t.textContent?.startsWith(title))?.nextElementSibling as HTMLElement | undefined
const button = (name: string, within: ParentNode = host) => [...within.querySelectorAll('button')].filter((b) => b.textContent === name)
const showAll = async () => act(async () => button('Show all 35')[0].click())

describe('Up next: everything still to go, by its time', () => {
  it('starts with the next one to go out, whatever its campaign or state', () => {
    const times = upNext().map((row) => row.querySelector('.post-time')!.textContent)
    expect(upNext()[0].textContent).toContain('Polsia')
    expect(upNext()[1].textContent).toContain('Polsia')
    expect(upNext()[2].textContent).toContain('Inflow')
    // Waiting for him, sitting at its own time among the scheduled ones.
    expect(upNext().findIndex((row) => row.textContent?.includes('Vertus'))).toBeGreaterThan(2)
    expect(times.length).toBe(15)
  })

  it('shows the first 15, the rest on a tap', async () => {
    expect(host.textContent).toContain('Show all 35')
    await showAll()
    expect(upNext()).toHaveLength(35)
    // Day by day, like a calendar.
    expect(host.querySelectorAll('.day-block .day-title').length).toBeGreaterThanOrEqual(2)
  })

  it('says where each stands', () => {
    const chips = upNext().map((row) => row.querySelector('.state-chip')!.textContent)
    expect(chips).toContain('Scheduled')
    expect(chips).toContain('To approve')
    expect(chips).toContain('Tap Post')
  })

  it('shows one campaign at a time, and remembers it', async () => {
    const filter = host.querySelector('select.posts-filter') as HTMLSelectElement
    expect([...filter.options].map((o) => o.textContent)).toContain('All campaigns · 38')
    const pick = async (value: string) => {
      filter.value = value
      await act(async () => filter.dispatchEvent(new Event('change', { bubbles: true })))
    }
    await pick('inflow')
    expect(upNext()).toHaveLength(1)
    expect(localStorage.getItem('cutter.posts.show')).toBe('inflow')
    await pick('')
    expect(upNext()).toHaveLength(15)
  })
})

describe('a new batch to approve', () => {
  it('shows its first 3 open with their video, and the top button approves everything waiting', async () => {
    await showAll()
    const nova = upNext().filter((row) => row.textContent?.includes('Nova'))
    expect(nova).toHaveLength(5)
    expect(nova.map((row) => button('Hide video', row).length)).toEqual([1, 1, 1, 0, 0])
    expect(host.textContent).toContain('the rest of it goes by itself')
    postAction.mockClear()
    await act(async () => button('Approve all 6')[0].click())
    expect(postAction.mock.calls.filter((c) => c[0] === 'approve').map((c) => c[1]).sort()).toEqual(['n0', 'n1', 'n2', 'n3', 'n4', 'w1'])
  })
})

describe('approve, post later', () => {
  it('sits next to Approve and holds the post instead of sending it', async () => {
    expect(button('Approve').length).toBeGreaterThanOrEqual(1)
    await act(async () => button('Approve, post later')[0].click())
    expect(postAction).toHaveBeenCalledWith('ready', 'w1')
  })

  it('has Post now beside Approve: approved with a time of now', async () => {
    const before = Date.now()
    await act(async () => button('Post now')[0].click())
    expect(postAction).toHaveBeenCalledWith('approve', 'w1')
    expect(Date.parse((sentFields as { at: string }).at)).toBeGreaterThanOrEqual(before)
  })

  it('keeps a held post at its time, with Post instead of Approve', () => {
    expect(button('Post')).toHaveLength(1)
    expect(host.textContent).toContain('it waits here until you tap Post')
  })
})

describe('redo captions', () => {
  const openPolsia = async () => {
    const row = upNext()[0]
    await act(async () => (row.querySelector('.post-head') as HTMLButtonElement).click())
    return upNext()[0]
  }

  it('adds the missing hashtags to the whole batch in one tap, after he says yes', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const row = await openPolsia()
    await act(async () => button('Add missing hashtags to this batch', row)[0].click())
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Add #polsia to these 27 Polsia posts? Captions stay as they are'))
    expect(redoCaptions).toHaveBeenCalledWith('polsia', expect.objectContaining({ hashtags: ['#polsia'] }), [...Array.from({ length: 25 }, (_, i) => `b${i}`), 'c0', 'c1'], 'hashtags')
    expect(host.textContent).toContain('Adding #polsia to 27 Polsia posts - captions stay as they are')
  })

  it('can still rewrite them, as a second choice', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const row = await openPolsia()
    await act(async () => button("Rewrite this batch's captions", row)[0].click())
    expect(redoCaptions).toHaveBeenLastCalledWith('polsia', expect.anything(), expect.any(Array), 'rewrite')
  })
})

describe('what went out', () => {
  it('shows only the last few hours', () => {
    const posted = titled('Just posted')!
    expect(posted.querySelectorAll('.post')).toHaveLength(1)
    expect(posted.textContent).toContain('Posted')
  })

  it('keeps a video that missed one of its accounts up top, and posts again to only the missing ones in one tap', async () => {
    const missed = titled("Didn't go out")!
    expect(missed.textContent).toContain('Not posted to Jake (Instagram).')
    const again = button('Post again to the missing ones', missed)
    expect(again).toHaveLength(1)
    await act(async () => again[0].click())
    expect(postAction).toHaveBeenCalledWith('retry-accounts', 'half')
  })
})

describe('Edit again (his ask, 2026-11-13: "I need to have the option for that at all times")', () => {
  it('sits beside Watch on a post waiting for him, with no time running out, and opens the video', async () => {
    const onEditAgain = vi.fn()
    // The store is stubbed in this file: its post key -> video lookup made real.
    const store = await import('./store')
    vi.mocked(store.jobOfPostKey).mockImplementation((key: string) => key.split('~')[0])
    // Made a day ago: long past the old two hours.
    await act(async () =>
      root.render(<PostsView campaigns={[]} onBack={() => {}} editable={{ w1: Date.now() - 24 * 3_600_000 }} onEditAgain={onEditAgain} />),
    )
    const post = upNext().find((p) => p.querySelector('button') && button('Edit again', p).length > 0)!
    expect(post).toBeDefined()
    // Not tucked away under More options.
    expect(button('Edit again', post)[0].closest('details')).toBeNull()
    await act(async () => button('Edit again', post)[0].click())
    expect(onEditAgain).toHaveBeenCalledWith('w1')
  })
})
