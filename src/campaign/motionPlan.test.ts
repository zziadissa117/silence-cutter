// Motion graphics on the server: Claude works in the background (longer
// than one request may last - his first try came back 504), and the phone
// asks how it is getting on until it is done.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./store', async (original) => {
  const real = await original<Record<string, unknown>>()
  return Object.fromEntries(Object.keys(real).map((key) => [key, typeof real[key] === 'function' ? vi.fn() : real[key]]))
})
vi.mock('./cloud', async (original) => ({
  ...(await original<typeof import('./cloud')>()),
  currentSession: () => ({ token: 't' }),
}))

import { motionPlan } from './posting'

const board = { hook: null, scenes: [], end: null }
let calls: { action: string; job?: string }[] = []

function server(answers: ((body: { action: string; job?: string }) => { status: number; json: unknown } | 'offline')[]) {
  let n = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body))
      calls.push(body)
      const answer = answers[Math.min(n++, answers.length - 1)](body)
      if (answer === 'offline') throw new TypeError('Load failed')
      return new Response(JSON.stringify(answer.json), { status: answer.status })
    }),
  )
}

const ask = { job: 'm1-abc123', words: ['a', 'b', 'c'], times: [0, 1, 2], ask: '' }
const quick = { everyMs: 0, wait: async () => {} }

beforeEach(() => {
  calls = []
  localStorage.setItem('cutter.posting', JSON.stringify({ sendHere: true, profile: { id: 'p1', accounts: [], settings: {}, timezone: 'UTC' } }))
})
afterEach(() => vi.unstubAllGlobals())

describe('motionPlan', () => {
  it('starts the job, then asks after it until Claude is done', async () => {
    server([
      () => ({ status: 200, json: { job: 'm1-abc123', status: 'working' } }),
      () => ({ status: 200, json: { status: 'working' } }),
      () => ({ status: 200, json: { status: 'done', storyboard: board, reply: 'ok', costCents: 4 } }),
    ])
    expect(await motionPlan(ask, quick)).toEqual({ storyboard: board, reply: 'ok', costCents: 4 })
    expect(calls.map((c) => c.action)).toEqual(['motion-plan', 'motion-result', 'motion-result'])
    expect(calls[1].job).toBe('m1-abc123')
  })

  it('says why when Claude failed', async () => {
    server([() => ({ status: 200, json: { status: 'working' } }), () => ({ status: 200, json: { status: 'failed', error: 'Claude is busy right now.' } })])
    await expect(motionPlan(ask, quick)).rejects.toThrow('Claude is busy right now.')
  })

  it('keeps asking through a dropped connection', async () => {
    vi.stubGlobal('navigator', { onLine: true })
    server([
      () => ({ status: 200, json: { status: 'working' } }),
      () => 'offline',
      () => 'offline',
      () => ({ status: 200, json: { status: 'done', storyboard: board } }),
    ])
    expect((await motionPlan(ask, quick)).storyboard).toEqual(board)
  })

  it('takes the storyboard straight away from a server from before jobs', async () => {
    server([() => ({ status: 200, json: { storyboard: board, reply: '', costCents: 1 } })])
    expect((await motionPlan(ask, quick)).costCents).toBe(1)
    expect(calls).toHaveLength(1)
  })
})
