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

import { stopPostsNow, type ServerPost } from './posting'

const post = (id: string, postAt: string) => ({ id, campaignId: 'c', campaignName: 'Polsia', status: 'scheduled', postAt }) as unknown as ServerPost

let calls: { action: string; id?: string; ids?: string[] }[] = []

function server(answer: (body: { action: string; id?: string; ids?: string[] }) => { status: number; json: unknown }) {
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
