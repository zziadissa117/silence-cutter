// The Posts screen with big batches (his ask, 2026-11-13): what waits for his
// yes always on top; then a block per day - Today and Tomorrow open, later
// days one line each; the platforms' marks instead of usernames; a filter by
// campaign; only what went out in the last few hours; and what didn't go out
// at the bottom, with his two ways - post it himself, or let the Cutter.

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
    accounts: [{ id: 'tt1', name: 'Kari', platform: 'tiktok-business', profile: 'kari.ugc' }, { id: 'yt1', name: 'Kari YT', platform: 'youtube' }],
    links: {},
    caption: '',
    batch: batch ? { id: batch, date: '2099-01-01', time: '10:00', size: 25 } : null,
  }) as unknown as ServerPost

const waitingPost = (id: string, ready = false) =>
  ({ ...scheduled(id, 'vertus', 'Vertus', undefined, 3), status: 'waiting', caption: 'A caption', approval: 'you', ready }) as unknown as ServerPost

const redoCaptions = vi.fn(async (_campaignId: string, _posting: unknown, ids?: string[], _mode?: string) => ({ rewriting: ids?.length ?? 0, tooSoon: 0 }))
const postAction = vi.fn(async (action: string, id: string): Promise<ServerPost> => {
  const post = posts.find((p) => p.id === id)!
  if (action === 'self') return { ...post, status: 'posted', retryAt: null, error: 'You posted it yourself to Kari YT.' }
  if (action === 'later') return { ...post, retryAt: future(2) }
  if (action === 'retry-accounts') return post
  return { ...waitingPost(id), ready: action === 'ready' }
})
/** What the last post action carried besides its action and post. */
let sentFields: unknown

const posts = [
  waitingPost('w1'),
  waitingPost('r1', true),
  ...Array.from({ length: 25 }, (_, i) => scheduled(`b${i}`, 'polsia', 'Polsia', 'big', i + 1)),
  ...Array.from({ length: 2 }, (_, i) => scheduled(`c${i}`, 'polsia', 'Polsia', 'small', 30 + i)),
  ...Array.from({ length: 5 }, (_, i) => ({ ...scheduled(`n${i}`, 'nova', 'Nova', 'new', 40 + i), status: 'waiting', caption: 'A caption', approval: 'you' }) as unknown as ServerPost),
  scheduled('one', 'inflow', 'Inflow', undefined, 2.5),
  { ...scheduled('half', 'wron', 'Wron', undefined, -3), status: 'posted', error: 'Not posted to Kari YT.' } as ServerPost,
  { ...scheduled('again', 'vaza', 'VAZA', undefined, -2), status: 'error', error: "Postiz couldn't publish it to @kari.ugc. Posting again Fri 3:40 PM.", retryAt: future(1.5) } as ServerPost,
  scheduled('far', 'inflow', 'Inflow', undefined, 24 * 4),
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
  history.replaceState(null, '', '/campaign.html#posts')
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
const toApprove = () => [...host.querySelectorAll('.to-approve .post')] as HTMLElement[]
const group = (name: string) =>
  [...host.querySelectorAll('.post-group')].find((g) => g.querySelector('.group-name')?.textContent === name) as HTMLElement | undefined
const button = (name: string, within: ParentNode = host) => [...within.querySelectorAll('button')].filter((b) => b.textContent === name)
const openAllDays = async () => {
  for (const head of [...host.querySelectorAll('.day-block > .group-head[aria-expanded="false"]')] as HTMLButtonElement[]) {
    await act(async () => head.click())
  }
}

describe('To approve: always on top', () => {
  it('comes first on the screen, every post waiting for him, the soonest first', () => {
    const first = host.querySelector('.post-group')!
    expect(first.classList.contains('to-approve')).toBe(true)
    expect(toApprove().map((row) => row.querySelector('.post-title')!.textContent)).toEqual(['Vertus', 'Vertus', 'Nova', 'Nova', 'Nova', 'Nova', 'Nova'])
    expect(first.querySelector('.group-count')!.textContent).toBe('7')
    // None of them among the days below.
    expect(upNext().some((row) => row.textContent?.includes('Vertus') || row.textContent?.includes('Nova'))).toBe(false)
  })

  it('says where each stands', () => {
    const chips = toApprove().map((row) => row.querySelector('.state-chip')!.textContent)
    expect(chips).toContain('To approve')
    expect(chips).toContain('Tap Post')
  })
})

describe('then a block per day', () => {
  it('starts with the next one to go out, Today and Tomorrow open, later days one line he opens', async () => {
    expect(upNext()[0].textContent).toContain('Polsia')
    const heads = [...host.querySelectorAll('.day-block > .group-head')] as HTMLButtonElement[]
    expect(heads.length).toBeGreaterThanOrEqual(3)
    expect(heads[0].getAttribute('aria-expanded')).toBe('true')
    // Four days ahead: by the weekday's name, folded, with how many.
    const far = heads[heads.length - 1]
    expect(far.getAttribute('aria-expanded')).toBe('false')
    expect(far.querySelector('.group-name')!.textContent).toBe(new Date(Date.now() + 96 * 3_600_000).toLocaleDateString(undefined, { weekday: 'long' }))
    expect(far.querySelector('.group-count')!.textContent).toBe('1')
    await openAllDays()
    // 25 + 2 Polsia, Inflow twice, and the post going again.
    expect(upNext()).toHaveLength(30)
  })

  it('shows the platforms as their marks, the usernames once a post is opened', async () => {
    const row = upNext()[0]
    const marks = row.querySelector('.pmarks')!
    expect(marks.querySelectorAll('.pmark-slot')).toHaveLength(2)
    expect(marks.querySelector('.pmark.tiktok')).not.toBeNull()
    expect(marks.querySelector('.pmark.youtube')).not.toBeNull()
    expect(marks.getAttribute('aria-label')).toContain('@kari.ugc')
    expect(row.querySelector('.post-line')!.textContent).not.toContain('@kari.ugc')
    await act(async () => (row.querySelector('.post-head') as HTMLButtonElement).click())
    expect(upNext()[0].querySelector('.post-accounts')!.textContent).toContain('@kari.ugc')
  })

  it('lists a post that didn\'t go out at the time it goes again, not in a banner up top', async () => {
    const row = upNext().find((r) => r.textContent?.includes('VAZA'))!
    expect(row.querySelector('.state-chip')!.textContent).toBe('Posting again')
    expect(row.querySelector('.post-line')!.textContent).toContain("Didn't go out on")
    // Only the account that missed.
    expect(row.querySelectorAll('.post-line .pmark-slot')).toHaveLength(1)
    expect(host.querySelector('.post-group')!.textContent).not.toContain("Didn't go out")
    // One line in the list; opened, his two ways.
    expect(button('Post it myself', row)).toHaveLength(0)
    await act(async () => (row.querySelector('.post-head') as HTMLButtonElement).click())
    await act(async () => button('Post it myself', row)[0].click())
    expect(postAction).toHaveBeenCalledWith('self', 'again')
  })

  it('shows one campaign at a time, and remembers it', async () => {
    const filter = host.querySelector('select.posts-filter') as HTMLSelectElement
    expect([...filter.options].map((o) => o.textContent)).toContain('All campaigns · 40')
    const pick = async (value: string) => {
      filter.value = value
      await act(async () => filter.dispatchEvent(new Event('change', { bubbles: true })))
    }
    await pick('inflow')
    await openAllDays()
    expect(upNext()).toHaveLength(2)
    expect(toApprove()).toHaveLength(0)
    expect(localStorage.getItem('cutter.posts.show')).toBe('inflow')
  })
})

describe('a new batch to approve', () => {
  it('shows its first 3 open with their video, and the button approves everything waiting', async () => {
    const nova = toApprove().filter((row) => row.textContent?.includes('Nova'))
    expect(nova).toHaveLength(5)
    expect(nova.map((row) => button('Hide video', row).length)).toEqual([1, 1, 1, 0, 0])
    expect(host.textContent).toContain('the rest of it goes by itself')
    postAction.mockClear()
    await act(async () => button('Approve all 6', group('To approve'))[0].click())
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
    const posted = group('Just posted')!
    expect(posted.querySelectorAll('.post')).toHaveLength(1)
    expect(posted.textContent).toContain('Posted')
  })

  it("keeps what didn't go out and won't go again by itself at the bottom, folded, with his two ways", async () => {
    const groups = [...host.querySelectorAll('.post-group')]
    const missed = group("Didn't go out")!
    expect(groups[groups.length - 1]).toBe(missed)
    expect(missed.querySelectorAll('.post')).toHaveLength(0)
    await act(async () => (missed.querySelector('.group-head') as HTMLButtonElement).click())
    expect(missed.querySelectorAll('.post')).toHaveLength(1)
    await act(async () => (missed.querySelector('.post .post-head') as HTMLButtonElement).click())
    await act(async () => button('Post again now', missed)[0].click())
    expect(postAction).toHaveBeenCalledWith('retry-accounts', 'half')
    await act(async () => button('Let the Cutter post it', missed)[0].click())
    expect(postAction).toHaveBeenCalledWith('later', 'half')
  })
})

describe('the notification about a post that didn\'t go out', () => {
  it('opens that post on top, to post it himself or let the Cutter post it', async () => {
    act(() => root.unmount())
    history.replaceState(null, '', '/campaign.html#posts/missed/again')
    root = createRoot(host)
    await act(async () => root.render(<PostsView campaigns={[]} onBack={() => {}} editable={{}} onEditAgain={() => {}} />))
    const sheet = host.querySelector('.missed-sheet') as HTMLElement
    expect(sheet.textContent).toContain('VAZA')
    expect(sheet.textContent).toContain('Or post it yourself now?')
    postAction.mockClear()
    await act(async () => button('Post it myself', sheet)[0].click())
    expect(postAction).toHaveBeenCalledWith('self', 'again')
    expect(sheet.textContent).toContain("The Cutter won't post it again")
    await act(async () => button('Close', sheet)[0].click())
    expect(host.querySelector('.missed-sheet')).toBeNull()
    expect(window.location.hash).toBe('#posts')
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
    const post = toApprove().find((p) => button('Edit again', p).length > 0)!
    expect(post).toBeDefined()
    // Not tucked away under More options.
    expect(button('Edit again', post)[0].closest('details')).toBeNull()
    await act(async () => button('Edit again', post)[0].click())
    expect(onEditAgain).toHaveBeenCalledWith('w1')
  })
})
