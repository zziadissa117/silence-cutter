// The send queue: what went wrong is kept with each video, and only what
// can't pass by itself (its copy gone) is marked for him to act on - a lost
// signal is only a wait.

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { SendEntry } from './store'

let rows: SendEntry[] = []
const updates: { key: string; fields: Partial<SendEntry> }[] = []

vi.mock('./store', () => ({
  loadSends: vi.fn(async () => rows.map((r) => ({ ...r }))),
  updateSend: vi.fn(async (key: string, fields: Partial<SendEntry>) => {
    updates.push({ key, fields })
    rows = rows.map((r) => (r.key === key ? { ...r, ...fields } : r))
  }),
  loadSendVideo: vi.fn(async () => new Blob(['video'])),
  saveSend: vi.fn(),
  saveSendVideo: vi.fn(),
  deleteSend: vi.fn(),
}))

vi.mock('./posting', async (original) => {
  const real = await original<typeof import('./posting')>()
  return {
    ...real,
    startSend: vi.fn(async () => {
      throw new real.PostingError('No connection. It goes when there is signal.', true)
    }),
    finishSend: vi.fn(),
    putPart: vi.fn(),
  }
})

import { kick, sending, watchSending } from './outbox'

const entry = (key: string, where: SendEntry['where']): SendEntry =>
  ({
    key,
    profileId: 'p1',
    campaign: { id: 'zi', name: 'Loveable zi', posting: {} },
    meta: { transcript: '', headline: '', duration: 20, fileName: `${key}.mp4` },
    size: 5,
    where,
    state: 'sending',
    tries: 0,
    addedAt: 1,
  }) as unknown as SendEntry

beforeEach(() => {
  updates.length = 0
})

describe('the send queue', () => {
  it('marks only a video whose copy is gone as his to act on; one with no signal just waits', async () => {
    // "lost" says its copy is in private files, which this browser hasn't got.
    rows = [entry('signal', 'idb'), entry('lost', 'opfs')]
    const seen: boolean[] = []
    const stop = watchSending(() => seen.push(sending().some((s) => s.now)))
    kick()
    await vi.waitFor(() => expect(updates.map((u) => u.key)).toEqual(['signal', 'lost']))
    stop()
    expect(updates[0].fields).toMatchObject({ error: 'No connection. It goes when there is signal.', stuck: false, tries: 1 })
    expect(updates[1].fields).toMatchObject({ stuck: true })
    // Each was "going up now" while it was tried, and nothing is after.
    expect(seen).toContain(true)
    await vi.waitFor(() => expect(sending().every((s) => !s.now)).toBe(true))
  })
})
