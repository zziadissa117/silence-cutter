// Stopping posts in bulk from the Posts screen: a whole campaign in one tap,
// or posts one by one - and only what was ticked goes to the server.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./store', async (original) => {
  const real = await original<Record<string, unknown>>()
  return Object.fromEntries(Object.keys(real).map((key) => [key, typeof real[key] === 'function' ? vi.fn() : real[key]]))
})

// The real stopPostsNow, over a mocked server: `call` is reached through
// fetch, so the server's answers are faked there.
const stopPosts = vi.fn(async (ids: string[]) => ({ stopped: ids.length, unposting: 1 }))
const rejected: string[] = []
let oldServer = false
vi.mock('./posting', async (original) => {
  const real = await original<typeof import('./posting')>()
  return {
    ...real,
    stopPostsNow: async (posts: import('./posting').ServerPost[], onProgress?: (d: number, t: number) => void) => {
      if (!oldServer) {
        const out = await stopPosts(posts.map((p) => p.id))
        return { ...out, failed: [] }
      }
      // The old server's path: one reject each, the way stopPostsNow falls back.
      const failed: { post: import('./posting').ServerPost; reason: string }[] = []
      let done = 0
      for (const p of posts) {
        if (p.id === 'c') failed.push({ post: p, reason: 'Postiz had a problem (502).' })
        else rejected.push(p.id)
        onProgress?.(++done, posts.length)
      }
      return { stopped: posts.length - failed.length, unposting: 0, failed }
    },
  }
})

import { stoppable, type ServerPost } from './posting'
import { StopPicker } from './StopPicker'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  stopPosts.mockClear()
  rejected.length = 0
  oldServer = false
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const later = new Date(Date.now() + 3_600_000).toISOString()
const earlier = new Date(Date.now() - 3_600_000).toISOString()
const post = (id: string, campaignId: string, status: string, postAt: string | null = later) =>
  ({ id, campaignId, campaignName: campaignId === 'c1' ? 'Inflow' : 'Vertus', status, postAt, fileName: null }) as unknown as ServerPost

const posts = [
  post('a', 'c1', 'scheduled'),
  post('b', 'c1', 'waiting', null),
  post('c', 'c2', 'scheduled'),
  post('d', 'c1', 'posted', earlier),
  post('e', 'c1', 'scheduled', earlier),
  post('f', 'c2', 'failed'),
]

const button = (text: RegExp) => [...host.querySelectorAll('button')].find((b) => text.test(b.textContent ?? '')) as HTMLButtonElement

describe('which posts can be stopped', () => {
  it('leaves out what has gone out, failed, or whose time has passed', () => {
    expect(stoppable(posts).map((p) => p.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('the stop picker', () => {
  it("ticks one campaign's posts in one tap and stops only those", async () => {
    const onDone = vi.fn()
    act(() => root.render(<StopPicker posts={stoppable(posts)} onDone={onDone} onCancel={() => {}} />))
    act(() => button(/^Inflow 2$/).click())
    expect(button(/^Stop 2 posts$/)).toBeTruthy()
    await act(async () => button(/^Stop 2 posts$/).click())
    expect(stopPosts).toHaveBeenCalledWith(['a', 'b'])
    expect(onDone).toHaveBeenCalledWith(expect.stringContaining('Stopped 2 posts.'))
  })

  it('All ticks everything that can be stopped; a second tap clears it', () => {
    act(() => root.render(<StopPicker posts={stoppable(posts)} onDone={() => {}} onCancel={() => {}} />))
    act(() => button(/^All 3$/).click())
    expect(button(/^Stop 3 posts$/)).toBeTruthy()
    act(() => button(/^All 3$/).click())
    expect(button(/Tick posts to stop/).disabled).toBe(true)
  })
})

describe('when some posts will not stop', () => {
  it('says so at the top, keeps only those ticked, and stops the rest', async () => {
    oldServer = true
    const onDone = vi.fn()
    act(() => root.render(<StopPicker posts={stoppable(posts)} onDone={onDone} onCancel={() => {}} />))
    act(() => button(/^All 3$/).click())
    await act(async () => button(/^Stop 3 posts$/).click())
    expect(rejected).toEqual(['a', 'b'])
    expect(onDone).not.toHaveBeenCalled()
    const alert = host.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain("1 didn't stop")
    // The alert is the first thing in the picker, above the list.
    expect(host.querySelector('.stop-picker')?.firstElementChild).toBe(alert)
    expect(button(/^Stop 1 post$/)).toBeTruthy()
    expect(host.textContent).toContain("Didn't stop: Postiz had a problem (502).")
  })
})

