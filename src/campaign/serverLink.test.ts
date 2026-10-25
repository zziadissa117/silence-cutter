import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { BankFile, BatchBank } from './batch'

const banks = new Map<string, BatchBank>()
vi.mock('./store', () => ({
  loadBatchBank: vi.fn(async (id: string) => structuredClone(banks.get(id) ?? null)),
  saveBatchBank: vi.fn(async (bank: BatchBank) => void banks.set(bank.campaignId, structuredClone(bank))),
  loadBankFile: vi.fn(async (file: BankFile) => new File([new Uint8Array(file.size)], file.name, { type: file.type })),
}))
vi.mock('./cloud', () => ({ currentSession: () => ({ name: 'me', token: 'tok' }) }))
vi.mock('./posting', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  postingHere: () => ({ profile: { id: 'prof1', accounts: [], settings: {}, timezone: 'UTC' }, sendHere: true }),
  listPosts: vi.fn(async () => []),
}))

import { emptyBank } from './batch'
import type { Job } from './jobs'
import { bringBack, linkBatches, roomProblem, setServerUrl } from './serverLink'

/** The server, as server/main.mjs answers. */
function fakeServer() {
  const files = new Map<string, number>()
  const inbox = new Map<string, BatchBank>()
  const calls: string[] = []
  const page: { banks: Record<string, BatchBank>; at: string } = { banks: {}, at: new Date().toISOString() }
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const { pathname, searchParams } = new URL(url)
    const method = init?.method ?? 'GET'
    calls.push(`${method} ${pathname}`)
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
    if (pathname === '/connect') return json({ ok: true, version: 'v', freeGB: 10 })
    if (pathname === '/status') return json({ version: 'v', chrome: 'running', freeGB: 10, page })
    if (pathname === '/files' && method === 'GET') return json({ files: Object.fromEntries([...files].map(([id, size]) => [id, { size }])) })
    if (pathname.startsWith('/files/')) {
      const [, , id, n] = pathname.split('/')
      if (Number(n) === Number(searchParams.get('total')) - 1) files.set(id, Number(searchParams.get('size')))
      return json({ done: true })
    }
    if (pathname.startsWith('/banks/') && method === 'PUT') {
      const { bank } = JSON.parse(String(init?.body)) as { bank: BatchBank }
      inbox.set(bank.campaignId, bank)
      return json({ ok: true })
    }
    if (pathname.startsWith('/banks/')) return json({ ok: true })
    return json({ error: 'Unknown.' }, 404)
  })
  return { files, inbox, calls, page, fetchMock }
}

const file = (id: string, size = 10): BankFile => ({ id, name: `${id}.mov`, type: 'video/quicktime', size, fp: `fp-${id}` })
const job = (id: string, status: Job['status']): Job =>
  ({ id, campaignId: 'c1', status, name: 'r1 + p1.mp4', headlineText: 'Hook', batch: { id: 'b', date: '2026-10-21', time: '12:00', size: 2 } }) as unknown as Job

describe('linkBatches (every batch to the Cutter server)', () => {
  let server: ReturnType<typeof fakeServer>
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 20, 9, 0))
    banks.clear()
    server = fakeServer()
    vi.stubGlobal('fetch', server.fetchMock)
    setServerUrl('https://cutter.example')
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    setServerUrl(null)
  })

  it('hands a batch over: its clips first, then the bank, the queued videos left to the server', async () => {
    banks.set('c1', { ...emptyBank('c1', 'a1'), reactions: [file('r1')], products: [file('p1')], music: [file('m1')], running: true, perDay: 2 })
    const removed: string[] = []
    const jobs = [job('j1', 'queued'), job('j2', 'working')]
    await linkBatches({ campaignIds: ['c1'], jobs: () => jobs, removeJob: (id) => removed.push(id) })

    expect([...server.files.keys()].sort()).toEqual(['m1', 'p1', 'r1'])
    const sent = server.inbox.get('c1')!
    expect(sent.where).toBe('server')
    expect(sent.movedAt).toBeTruthy()
    expect(removed).toEqual(['j1'])
    // The video still being made here counts; the queued one is the server's to make.
    expect(sent.filled?.['2026-10-21']).toBe(1)
    expect(banks.get('c1')!.where).toBe('server')
    // Files before the bank, always.
    const firstBank = server.calls.findIndex((c) => c.startsWith('PUT /banks'))
    expect(server.calls.slice(0, firstBank).filter((c) => c.startsWith('PUT /files'))).toHaveLength(3)
  })

  it('sends a change he makes, once, with any new clip; reads back what the server made', async () => {
    banks.set('c1', { ...emptyBank('c1', 'a1'), reactions: [file('r1')], products: [file('p1')], running: true })
    const ctx = { campaignIds: ['c1'], jobs: () => [], removeJob: () => {} }
    await linkBatches(ctx)
    const putsAfterFirst = server.calls.filter((c) => c.startsWith('PUT /banks')).length
    await linkBatches(ctx)
    expect(server.calls.filter((c) => c.startsWith('PUT /banks')).length).toBe(putsAfterFirst)

    // The server made some; he added a reaction and raised the number.
    const mine = banks.get('c1')!
    server.page.banks.c1 = { ...mine, made: ['r1|p1|h:|'], filled: { '2026-10-20': 1 }, used: { r1: 1, p1: 1 } }
    banks.set('c1', { ...mine, perDay: 5, reactions: [...mine.reactions, file('r2')] })
    await linkBatches(ctx)
    const here = banks.get('c1')!
    expect(here.made).toEqual(['r1|p1|h:|'])
    expect(here.perDay).toBe(5)
    expect(server.files.has('r2')).toBe(true)
    expect(server.inbox.get('c1')!.perDay).toBe(5)
  })

  it("still asks how the server is doing while clips are going up", async () => {
    banks.set('c1', { ...emptyBank('c1', 'a1'), reactions: [file('r1')], products: [file('p1')], running: true })
    // The clip upload hangs until let go: a long round of sending.
    let letGo = () => {}
    const held = new Promise<void>((resolve) => (letGo = resolve))
    const plain = server.fetchMock.getMockImplementation()!
    let sending = false
    server.fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (new URL(url).pathname.startsWith('/files/')) {
        sending = true
        await held
      }
      return plain(url, init)
    })
    const ctx = { campaignIds: ['c1'], jobs: () => [], removeJob: () => {} }
    const first = linkBatches(ctx)
    try {
      await vi.waitFor(() => expect(sending).toBe(true))
      const asked = server.calls.filter((c) => c === 'GET /status').length
      void linkBatches(ctx)
      await vi.waitFor(() => expect(server.calls.filter((c) => c === 'GET /status').length).toBe(asked + 1))
    } finally {
      letGo()
      await first
    }
  })

  it('leaves the engine its own batches', async () => {
    banks.set('c1', { ...emptyBank('c1', 'a1'), layout: 'engine', reactions: [file('r1')], running: true })
    await linkBatches({ campaignIds: ['c1'], jobs: () => [], removeJob: () => {} })
    expect(server.inbox.size).toBe(0)
    expect(banks.get('c1')!.where).toBeUndefined()
  })

  it('brings a batch back to the phone, its days counted again', async () => {
    banks.set('c1', { ...emptyBank('c1', 'a1'), reactions: [file('r1')], products: [file('p1')], running: true })
    await linkBatches({ campaignIds: ['c1'], jobs: () => [], removeJob: () => {} })
    await bringBack('c1', { jobs: () => [], removeJob: () => {} })
    const here = banks.get('c1')!
    expect(here.where).toBeUndefined()
    expect(here.running).toBe(true)
    expect(server.calls).toContain('POST /banks/c1/back-to-phone')
  })
})

describe("the server's room", () => {
  it("says a free Railway plan is too small, and a disk nearly full; nothing when it's fine", () => {
    // His friend's first server, 2026-10-25: full in its first minutes.
    expect(roomProblem({ freeGB: 0, diskGB: 0.5, memoryGB: 0.5 })).toContain("Railway's free plan")
    expect(roomProblem({ freeGB: 3, diskGB: 5, memoryGB: 0.5 })).toContain('Hobby plan')
    expect(roomProblem({ freeGB: 0.3, diskGB: 5, memoryGB: 8 })).toContain('almost full')
    expect(roomProblem({ freeGB: 4.2, diskGB: 5, memoryGB: 8 })).toBeNull()
    // An older server says only what is free.
    expect(roomProblem({ freeGB: 4.2 })).toBeNull()
    expect(roomProblem(null)).toBeNull()
  })
})
