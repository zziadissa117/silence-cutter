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

import { batchTimesOn, onFixedTimes, placeTimesOn, stackTimesOn, takenTimes, stopPostsNow, switchToRandom, type Profile, type ServerPost } from './posting'

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

  it('a campaign with no times of its own gets three random ones a day, between 11 AM and 6 PM', () => {
    const times = placeTimesOn({ accounts: [], times: [] }, 'unset', '2026-10-10')
    expect(times).toHaveLength(3)
    for (const time of times) expect(time >= '11:00' && time <= '18:00').toBe(true)
  })

  it('shows the times the server will use: every one of his own, night ones too', () => {
    expect(placeTimesOn({ accounts: [], times: ['03:43', '13:42', '20:44'] }, 'lovable', '2026-10-10')).toEqual(['03:43', '13:42', '20:44'])
    expect(placeTimesOn({ accounts: [], times: ['01:25', '02:25'] }, 'reaction', '2026-10-10')).toEqual(['01:25', '02:25'])
  })

  it('switches only the ones on his own times, keeping a window one already had', async () => {
    expect(onFixedTimes(profile, campaigns).map((c) => c.name)).toEqual(['Inflow', 'Vertus'])
    server(() => ({ status: 200, json: profile }))
    await switchToRandom(profile, campaigns)
    expect(calls).toEqual([
      expect.objectContaining({ action: 'save-campaign', campaignId: 'own', accounts: ['tt'], times: [], window: { from: '11:00', to: '18:00', perDay: 3 } }),
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
      // The whole window he set, not cut to the middle of the day.
      for (const t of times) expect(t >= '10:00' && t <= '21:50').toBe(true)
      for (let i = 1; i < times.length; i++) expect(minutes(times[i]) - minutes(times[i - 1])).toBeGreaterThanOrEqual(30)
    }
    const many = batchTimesOn(place, 'inflow', '2026-10-12', 25)
    expect(many).toHaveLength(25)
    for (const t of many) expect(t >= '10:00' && t <= '21:50').toBe(true)
    for (let i = 1; i < many.length; i++) expect(minutes(many[i]) - minutes(many[i - 1])).toBeGreaterThanOrEqual(10)
    expect(batchTimesOn(place, 'inflow', '2026-10-12', 5)).not.toEqual(batchTimesOn(place, 'inflow', '2026-10-13', 5))
    // No most a day: as many as he wants, closer the more there are.
    const more = batchTimesOn(place, 'inflow', '2026-10-12', 60)
    expect(more).toHaveLength(60)
    expect(new Set(more).size).toBe(60)
    expect(batchTimesOn({ accounts: [], times: ['18:00'] }, 'inflow', '2026-10-12', 35)).toHaveLength(35)
  })

  it('makes 125 a day on one account in a whole-day window, and keeps 30 minutes apart while that fits', () => {
    const allDay = { accounts: [], times: [], window: { from: '01:00', to: '01:00', perDay: 3 } }
    const lots = batchTimesOn(allDay, 'lovable', '2026-10-22', 125)
    expect(lots).toHaveLength(125)
    expect(new Set(lots).size).toBe(125)
    for (let i = 1; i < lots.length; i++) expect(minutes(lots[i]) - minutes(lots[i - 1])).toBeGreaterThanOrEqual(8)
    const fewer = batchTimesOn(allDay, 'lovable', '2026-10-22', 35)
    expect(fewer).toHaveLength(35)
    for (let i = 1; i < fewer.length; i++) expect(minutes(fewer[i]) - minutes(fewer[i - 1])).toBeGreaterThanOrEqual(30)
    // 1 AM to 11:59 PM, the way it was set: its night hours used too.
    const night = batchTimesOn({ accounts: [], times: [], window: { from: '01:00', to: '23:59', perDay: 3 } }, 'lovable', '2026-10-22', 40)
    expect(night.some((t) => t < '11:00' || t > '18:00')).toBe(true)
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
    expect(batchTimesOn({ accounts: [], times: ['12:00', '15:00', '18:00'] }, 'inflow', '2026-10-12', 3)).toEqual(['12:00', '15:00', '18:00'])
    // His 9 AM is his: kept.
    expect(batchTimesOn({ accounts: [], times: ['09:00', '12:00', '18:00'] }, 'inflow', '2026-10-12', 3)).toEqual(['09:00', '12:00', '18:00'])
  })
})

describe('batch times that move from day to day', () => {
  const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
  const days = Array.from({ length: 10 }, (_, i) => `2026-10-${String(i + 10).padStart(2, '0')}`)

  it('puts a time added to his own in the open part of the day, not right after the first', () => {
    const place = { accounts: [], times: ['11:00', '18:00'] }
    const extras = days.map((d) => batchTimesOn(place, 'c', d, 3).find((t) => t !== '11:00' && t !== '18:00')!)
    for (const t of extras) expect(minutes(t)).toBeGreaterThanOrEqual(minutes('11:30'))
    // Somewhere different on different days - not always just after 11.
    expect(new Set(extras).size).toBeGreaterThan(5)
    expect(extras.filter((t) => minutes(t) < minutes('12:00')).length).toBeLessThan(5)
  })

  it('does not sit on the same grid every day when the day is full', () => {
    const place = { accounts: [], times: [], window: { from: '11:00', to: '18:00', perDay: 3 } }
    const a = batchTimesOn(place, 'c', days[0], 24)
    const b = batchTimesOn(place, 'c', days[1], 24)
    expect(a).toHaveLength(24)
    for (let i = 1; i < a.length; i++) expect(minutes(a[i]) - minutes(a[i - 1])).toBeGreaterThanOrEqual(10)
    // Most of the day's times differ by more than a couple of minutes.
    expect(a.filter((t, i) => Math.abs(minutes(t) - minutes(b[i])) > 2).length).toBeGreaterThan(12)
    const gaps = a.slice(1).map((t, i) => minutes(t) - minutes(a[i]))
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeGreaterThan(5)
  })

  it('spreads more videos over a day that has some already, instead of the first free minutes', () => {
    const times = stackTimesOn({ accounts: [], times: [] }, 'c', days[0], 2, ['11:00', '17:40'])
    expect(times).toHaveLength(2)
    expect(minutes(times[1]) - minutes(times[0])).toBeGreaterThan(60)
  })
})

describe('a batch stacked on one running', () => {
  const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
  const place = { accounts: [], times: [] }

  it('picks as many more as he asks, in the day, 20 minutes clear of the ones already there', () => {
    const taken = ['12:00', '14:30', '17:00']
    for (let n = 1; n <= 5; n++) {
      const times = stackTimesOn(place, 'inflow', '2026-10-14', n, taken)
      expect(times).toHaveLength(n)
      for (const t of times) {
        expect(t >= '11:00' && t <= '18:00').toBe(true)
        for (const o of taken) expect(Math.abs(minutes(t) - minutes(o))).toBeGreaterThanOrEqual(20)
      }
    }
  })

  it('closes up, never under 10 minutes, on a crowded day', () => {
    const taken = Array.from({ length: 14 }, (_, i) => `${String(11 + Math.floor((i * 30) / 60)).padStart(2, '0')}:${String((i * 30) % 60).padStart(2, '0')}`)
    const times = stackTimesOn(place, 'inflow', '2026-10-14', 4, taken)
    expect(times.length).toBeGreaterThan(0)
    for (const t of times) for (const o of taken) expect(Math.abs(minutes(t) - minutes(o))).toBeGreaterThanOrEqual(10)
  })

  it('reads the times taken from the campaign\'s live posts, by day', () => {
    const at = (h: number, m: number) => new Date(2026, 9, 14, h, m).toISOString()
    const posts = [
      { campaignId: 'inflow', status: 'scheduled', postAt: at(12, 0) },
      { campaignId: 'inflow', status: 'rejected', postAt: at(13, 0) },
      { campaignId: 'other', status: 'scheduled', postAt: at(15, 0) },
      { campaignId: 'inflow', status: 'waiting', postAt: at(16, 45) },
    ] as unknown as ServerPost[]
    expect(takenTimes(posts, 'inflow').get('2026-10-14')).toEqual(['12:00', '16:45'])
  })
})
