// Stopping posts against whichever posting function is live: the new one
// stops them all in one call; one from before that answers "Unknown action",
// and then each post is rejected on its own - the same Reject as on each
// post - so a stop works before the server is updated.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./store', async (original) => {
  const real = await original<Record<string, unknown>>()
  return Object.fromEntries(Object.keys(real).map((key) => [key, typeof real[key] === 'function' ? vi.fn() : real[key]]))
})
vi.mock('./cloud', async (original) => ({
  ...(await original<typeof import('./cloud')>()),
  currentSession: () => ({ token: 't' }),
}))

import { batchTimesOn, onFixedTimes, placeTimesOn, stopPostsNow, switchToRandom, type Profile, type ServerPost } from './posting'

const post = (id: string, postAt: string) => ({ id, campaignId: 'c', campaignName: 'Polsia', status: 'scheduled', postAt }) as unknown as ServerPost

let calls: { action: string; id?: string; ids?: string[]; campaignId?: string }[] = []

function server(answer: (body: { action: string; id?: string; ids?: string[]; campaignId?: string }) => { status: number; json: unknown }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body))
      calls.push(body)
      const { status, json } = answer(body)
      return new Response(JSON.stringify(json), { status })
    }),
  )
}

beforeEach(() => {
  calls = []
  localStorage.setItem('cutter.posting', JSON.stringify({ sendHere: true, profile: { id: 'p1', accounts: [], settings: {}, timezone: 'UTC' } }))
})
afterEach(() => vi.unstubAllGlobals())

describe('stopPostsNow', () => {
  const posts = [post('late', '2026-10-20T10:00:00Z'), post('soon', '2026-10-10T03:04:00Z'), post('mid', '2026-10-15T10:00:00Z')]

  it('stops them all in one call on a server that can', async () => {
    server(() => ({ status: 200, json: { stopped: 3, unposting: 3 } }))
    expect(await stopPostsNow(posts)).toEqual({ stopped: 3, unposting: 3, failed: [] })
    expect(calls.map((c) => c.action)).toEqual(['stop-posts'])
  })

  it("rejects each one, soonest first, on a server from before - and reports the ones that wouldn't", async () => {
    server((body) =>
      body.action === 'stop-posts'
        ? { status: 400, json: { error: 'Unknown action.' } }
        : body.id === 'mid'
          ? { status: 502, json: { error: 'Postiz had a problem (502).', later: true } }
          : { status: 200, json: { post: { id: body.id, status: 'rejected' } } },
    )
    const progress: number[] = []
    const outcome = await stopPostsNow(posts, (done) => progress.push(done))
    expect(calls[0].action).toBe('stop-posts')
    const rejects = calls.slice(1)
    expect(rejects.every((c) => c.action === 'reject')).toBe(true)
    // Started soonest first, three at a time.
    expect(rejects.map((c) => c.id)).toEqual(['soon', 'mid', 'late'])
    expect(outcome.stopped).toBe(2)
    expect(outcome.failed.map((f) => [f.post.id, f.reason])).toEqual([['mid', 'Postiz had a problem (502).']])
    expect(progress[progress.length - 1]).toBe(3)
  })

  it('does not fall back on any other failure', async () => {
    server(() => ({ status: 401, json: { error: 'signed-out' } }))
    await expect(stopPostsNow(posts)).rejects.toThrow(/Signed out/)
    expect(calls).toHaveLength(1)
  })
})

describe('random times for every campaign', () => {
  const profile = {
    id: 'p1',
    accounts: [],
    timezone: 'UTC',
    hasAnthropic: false,
    vapidPublic: null,
    settings: {
      campaigns: {
        own: { accounts: ['tt'], times: ['18:00'] },
        hadWindow: { accounts: ['ig'], times: ['09:00'], window: { from: '12:00', to: '20:00', perDay: 2 } },
        random: { accounts: ['yt'], times: [] },
      },
    },
  } as Profile
  const campaigns = [
    { id: 'own', name: 'Inflow' },
    { id: 'hadWindow', name: 'Vertus' },
    { id: 'random', name: 'Polsia' },
    { id: 'unset', name: 'New' },
  ]

  it('a campaign with no times of its own gets three random ones a day, between 10 AM and 10 PM', () => {
    const times = placeTimesOn({ accounts: [], times: [] }, 'unset', '2026-10-10')
    expect(times).toHaveLength(3)
    for (const time of times) expect(time >= '10:00' && time <= '22:00').toBe(true)
  })

  it('switches only the ones on his own times, keeping a window one already had', async () => {
    expect(onFixedTimes(profile, campaigns).map((c) => c.name)).toEqual(['Inflow', 'Vertus'])
    server(() => ({ status: 200, json: profile }))
    await switchToRandom(profile, campaigns)
    expect(calls).toEqual([
      expect.objectContaining({ action: 'save-campaign', campaignId: 'own', accounts: ['tt'], times: [], window: { from: '10:00', to: '22:00', perDay: 3 } }),
      expect.objectContaining({ action: 'save-campaign', campaignId: 'hadWindow', accounts: ['ig'], times: [], window: { from: '12:00', to: '20:00', perDay: 2 } }),
    ])
  })

  it('names the campaign that could not be switched', async () => {
    server((body) => (body.campaignId === 'hadWindow' ? { status: 502, json: { error: 'Postiz had a problem (502).' } } : { status: 200, json: profile }))
    await expect(switchToRandom(profile, campaigns)).rejects.toThrow(/^Vertus kept its own times/)
  })
})

describe('batchTimesOn', () => {
  const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))

  it('draws as many as he picks from a random campaign\'s window, a different set each day', () => {
    const place = { accounts: [], times: [], window: { from: '10:00', to: '22:00', perDay: 3 } }
    for (let n = 1; n <= 6; n++) {
      const times = batchTimesOn(place, 'inflow', '2026-10-12', n)
      expect(times).toHaveLength(n)
      for (const t of times) expect(t >= '10:00' && t <= '22:00').toBe(true)
      for (let i = 1; i < times.length; i++) expect(minutes(times[i]) - minutes(times[i - 1])).toBeGreaterThanOrEqual(30)
    }
    const many = batchTimesOn(place, 'inflow', '2026-10-12', 25)
    expect(many).toHaveLength(25)
    for (const t of many) expect(t >= '10:00' && t <= '22:00').toBe(true)
    for (let i = 1; i < many.length; i++) expect(minutes(many[i]) - minutes(many[i - 1])).toBeGreaterThanOrEqual(10)
    expect(batchTimesOn(place, 'inflow', '2026-10-12', 5)).not.toEqual(batchTimesOn(place, 'inflow', '2026-10-13', 5))
  })

  it('keeps his own times and adds random ones, half an hour clear of his, when he wants more', () => {
    const place = { accounts: [], times: ['18:00'] }
    const times = batchTimesOn(place, 'inflow', '2026-10-12', 4)
    expect(times).toHaveLength(4)
    expect(times).toContain('18:00')
    for (const t of times.filter((t) => t !== '18:00')) expect(Math.abs(minutes(t) - minutes('18:00'))).toBeGreaterThanOrEqual(30)
    const lots = batchTimesOn(place, 'inflow', '2026-10-12', 25)
    expect(lots).toHaveLength(25)
    expect(lots).toContain('18:00')
    expect(batchTimesOn({ accounts: [], times: ['09:00', '12:00', '18:00'] }, 'inflow', '2026-10-12', 3)).toEqual(['09:00', '12:00', '18:00'])
  })
})
