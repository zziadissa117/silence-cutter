// A new version's old post comes out only once the new version is on the
// server (Edit again, music added) - and not at all if it went out meanwhile.

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { SendEntry } from './store'

let rows: SendEntry[] = []

vi.mock('./store', () => ({
  loadSends: vi.fn(async () => rows.map((r) => ({ ...r }))),
  updateSend: vi.fn(async (key: string, fields: Partial<SendEntry>) => {
    rows = rows.map((r) => (r.key === key ? { ...r, ...fields } : r))
  }),
  loadSendVideo: vi.fn(async () => new Blob(['video'])),
  saveSend: vi.fn(),
  saveSendVideo: vi.fn(),
  deleteSend: vi.fn(async (key: string) => void (rows = rows.filter((r) => r.key !== key))),
}))

let oldStatus = 'scheduled'
vi.mock('./posting', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  // The server has it all already: sent at once.
  startSend: vi.fn(async () => ({ id: 'new', partBytes: 1, uploads: [], status: 'waiting' })),
  finishSend: vi.fn(),
  putPart: vi.fn(),
  listPosts: vi.fn(async () => [{ id: 'old', key: 'old-key', status: oldStatus, postAt: new Date(Date.now() + 86400_000).toISOString() }]),
  postAction: vi.fn(async () => ({})),
}))

import { kick } from './outbox'
import { postAction } from './posting'

const entry = (): SendEntry =>
  ({
    key: 'old-key~2',
    replaces: 'old-key',
    profileId: 'p1',
    campaign: { id: 'lock', name: 'Lock in', posting: {} },
    meta: { transcript: '', headline: '', duration: 0, fileName: 'clip.mp4' },
    size: 5,
    where: 'idb',
    state: 'sending',
    tries: 0,
    addedAt: 1,
  }) as unknown as SendEntry

const settle = () => new Promise((resolve) => setTimeout(resolve, 30))

describe('a new version of a post', () => {
  beforeEach(() => {
    vi.mocked(postAction).mockClear()
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
  })

  it('takes the old one out once it is on the server', async () => {
    oldStatus = 'scheduled'
    rows = [entry()]
    kick()
    await settle()
    expect(postAction).toHaveBeenCalledWith('reject', 'old')
    expect(rows.find((r) => r.key === 'old-key~2')?.replaces).toBeUndefined()
  })

  it('leaves one that went out meanwhile', async () => {
    oldStatus = 'posted'
    rows = [entry()]
    kick()
    await settle()
    expect(postAction).not.toHaveBeenCalled()
  })
})
