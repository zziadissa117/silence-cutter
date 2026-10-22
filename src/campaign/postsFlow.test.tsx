// The Posts screen's flow: approved posts wait with the scheduled ones, and
// everything still going up is one line - only a video he has to act on gets
// a row of its own.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Sending } from './outbox'
import type { ServerPost } from './posting'

const future = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString()
const post = (id: string, status: string, h: number, extra: Partial<ServerPost> = {}) =>
  ({
    id,
    key: id,
    campaignId: 'zi',
    campaignName: 'Loveable zi',
    status,
    postAt: future(h),
    accounts: [{ id: 'ig', name: 'Michaelangelo', platform: 'instagram', profile: 'traderzi2' }],
    links: {},
    caption: 'A caption',
    batch: null,
    ...extra,
  }) as unknown as ServerPost

const posts = [
  post('approved-wed', 'approved', 6 * 24, {
    error: "Approved - Postiz didn't take it yet, so it tries again by itself. Buffer posts it a few hours before its time if Postiz still can't. (Postiz said: Application not found)",
  }),
  post('sched', 'scheduled', 30),
  post('cap', 'writing', 0),
]

const entry = (key: string, name: string, extra: object = {}) => ({
  key,
  profileId: 'p1',
  campaign: { id: 'zi', name: 'Loveable zi', posting: {} },
  meta: { transcript: '', headline: '', duration: 20, fileName: name },
  size: 1,
  where: 'opfs',
  state: 'sending',
  tries: 0,
  addedAt: 1,
  ...extra,
})
const outgoing = [
  { entry: entry('a', 'IMG_1.mp4'), progress: 0.45, now: true },
  // Failed a while ago for want of signal: only waiting its turn now.
  { entry: entry('b', 'IMG_2.mp4', { error: 'No connection. It goes when there is signal.', tries: 3 }), progress: 0, now: false },
  { entry: entry('c', 'IMG_3.mp4', { error: "This video's copy is gone from the phone - make it again to send it.", stuck: true }), progress: 0, now: false },
] as unknown as Sending[]

const postAction = vi.fn(async (action: string, id: string) => ({ ...posts.find((p) => p.id === id)!, status: action === 'unschedule' ? 'waiting' : 'approved' }))

vi.mock('./store', async (original) => {
  const real = await original<Record<string, unknown>>()
  return Object.fromEntries(Object.keys(real).map((key) => [key, typeof real[key] === 'function' ? vi.fn() : real[key]]))
})
vi.mock('./outbox', () => ({
  copyKind: vi.fn(async () => null),
  forgetSend: vi.fn(),
  kick: vi.fn(),
  localVideo: vi.fn(async () => null),
  sending: () => outgoing,
  tidySends: vi.fn(),
  watchSending: () => () => {},
}))
vi.mock('./posting', async (original) => ({
  ...(await original<typeof import('./posting')>()),
  lastPosts: () => posts,
  listPosts: vi.fn(async () => posts),
  postingHere: () => null,
  postAction: (action: string, id: string) => postAction(action, id),
}))

import { PostsView } from './PostsView'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLElement
let root: Root

beforeEach(async () => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root.render(<PostsView campaigns={[]} onBack={() => {}} editable={{}} onEditAgain={() => {}} />))
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const section = (title: string) => {
  const heading = [...host.querySelectorAll('.list-title')].find((t) => t.textContent?.startsWith(title))
  return heading?.nextElementSibling as HTMLElement | undefined
}

describe('the Posts screen', () => {
  it('lists an approved post with the scheduled ones, with its time and a way to take it back', () => {
    expect(host.querySelector('.list-title')?.parentElement?.textContent).not.toContain('Going to Postiz')
    const scheduled = section('Scheduled')!
    expect(host.textContent).toContain('Scheduled · 2')
    expect(scheduled.textContent).toContain('Approved · @traderzi2')
    expect(scheduled.textContent).toContain("Postiz didn't take it yet")
    expect([...scheduled.querySelectorAll('button')].filter((b) => b.textContent === 'Take back')).toHaveLength(2)
  })

  it('shows everything going up as one line - the rest only waiting their turn, not "No connection"', () => {
    const onTheWay = section('On the way')!
    expect(onTheWay.textContent).toContain('2 videos going up')
    expect(onTheWay.textContent).toContain('Now IMG_1.mp4 · 45% · 1 waiting their turn')
    expect(onTheWay.textContent).toContain('Claude is writing a caption')
    expect(onTheWay.textContent).not.toContain('No connection')
  })

  it('gives a video he has to act on its own row, with what is wrong and his two ways out', () => {
    const onTheWay = section('On the way')!
    expect(onTheWay.textContent).toContain("IMG_3.mp4: This video's copy is gone from the phone")
    expect([...onTheWay.querySelectorAll('button')].map((b) => b.textContent)).toEqual(expect.arrayContaining(['Try again', 'Stop sending']))
  })

  it('opens the line to show each one', async () => {
    const onTheWay = section('On the way')!
    await act(async () => (onTheWay.querySelector('button[aria-expanded="false"]') as HTMLButtonElement).click())
    expect(onTheWay.textContent).toContain('IMG_2.mp4')
    expect(onTheWay.textContent).toContain('Waiting its turn')
    expect(onTheWay.textContent).toContain('45%')
  })
})
