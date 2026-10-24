// Music added to a post: a post made by hand keeps the time he picked, and
// the old version comes out once the new one is on the server - not before,
// unless it is due too soon to wait.

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./addMusic', () => ({ addMusicTo: vi.fn(async () => ({ blob: new Blob(['with music']) })) }))
vi.mock('./outbox', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  localVideo: vi.fn(async () => new Blob(['video'])),
  queueSend: vi.fn(async () => 'queued'),
  forgetSend: vi.fn(async () => {}),
}))
vi.mock('./posting', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  postingHere: () => ({ profile: { id: 'p1' }, sendHere: true }),
  postAction: vi.fn(async () => ({})),
}))

import { sendWithMusic } from './musicAfterSend'
import { queueSend } from './outbox'
import { postAction, type ServerPost } from './posting'

const post = (fields: Partial<ServerPost>): ServerPost =>
  ({
    id: 'old',
    key: 'post-k',
    campaignId: 'lock',
    campaignName: 'Lock in',
    status: 'scheduled',
    caption: 'this app turned my habits into card packs',
    title: null,
    headline: '',
    fileName: 'clip.mp4',
    postAt: new Date(Date.now() + 24 * 3600_000).toISOString(),
    byHand: true,
    ...fields,
  }) as unknown as ServerPost

describe('music added to a post', () => {
  beforeEach(() => {
    vi.mocked(queueSend).mockClear()
    vi.mocked(postAction).mockClear()
  })

  it('made by hand: keeps the time he picked; the old one comes out once the new one arrives', async () => {
    const old = post({})
    const said = await sendWithMusic({ post: old, campaign: undefined, music: { audio: new Blob(['song']), level: 'normal' } })
    const sent = vi.mocked(queueSend).mock.calls[0][0]
    expect(sent.key).toBe('post-k~2')
    expect(sent.meta.byHand).toEqual({ at: old.postAt, caption: old.caption, about: '' })
    expect(sent.replaces).toBe('post-k')
    expect(postAction).not.toHaveBeenCalled()
    expect(said).toMatch(/old one comes out as soon as it arrives/)
  })

  it('due within a quarter of an hour: the old one comes out now, as before', async () => {
    const old = post({ postAt: new Date(Date.now() + 5 * 60_000).toISOString(), byHand: false })
    await sendWithMusic({ post: old, campaign: undefined, music: { audio: new Blob(['song']), level: 'normal' } })
    const sent = vi.mocked(queueSend).mock.calls[0][0]
    expect(sent.replaces).toBeUndefined()
    expect(sent.meta.byHand).toBeUndefined()
    expect(postAction).toHaveBeenCalledWith('reject', 'old')
  })
})
