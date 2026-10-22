import { describe, expect, it } from 'vitest'

import {
  BUFFER_QUEUE,
  BufferError,
  HAND_AHEAD_MS,
  MISSED_GAP_MS,
  bufferCall,
  createPost,
  handOverPlan,
  handleOf,
  isFull,
  listChannels,
  matchChannels,
  postInput,
  roomLeft,
  type BufferChannel,
} from './buffer.ts'

/** A stand-in for api.buffer.com: answers each query in turn. */
function fakeBuffer(answers: { status?: number; body: unknown }[]) {
  const asked: { query: string; variables: Record<string, unknown>; auth: string }[] = []
  const fetcher = async (_url: string, init: RequestInit) => {
    const sent = JSON.parse(String(init.body)) as { query: string; variables: Record<string, unknown> }
    asked.push({ ...sent, auth: String((init.headers as Record<string, string>).Authorization) })
    const answer = answers.shift() ?? { body: { data: null } }
    return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200 })
  }
  return { fetcher, asked }
}

const traderzi: BufferChannel = { key: 0, id: 'ch-ig', name: 'traderzi2', displayName: 'Trader Zi', service: 'instagram' }

describe('matching Buffer channels to Postiz accounts', () => {
  it('matches an Instagram account by its username, whatever the case or @', () => {
    expect(handleOf(' @TraderZi2 ')).toBe('traderzi2')
    const accounts = [
      { id: 'a1', platform: 'instagram-standalone', profile: 'TraderZi2', name: 'Michaelangelo' },
      { id: 'a2', platform: 'instagram-standalone', profile: 'someoneelse', name: 'Jake' },
      { id: 'a3', platform: 'tiktok-business', profile: 'traderzi2', name: 'TikTok' },
    ]
    const tiktok: BufferChannel = { ...traderzi, id: 'ch-tt', service: 'tiktok' }
    expect(matchChannels(accounts, [tiktok, traderzi])).toEqual({ a1: traderzi })
  })
})

describe('the post Buffer is given', () => {
  it('at its own time, the video by link, shown on the Instagram feed', () => {
    const at = Date.UTC(2026, 9, 22, 15, 20)
    expect(postInput({ channel: traderzi, caption: 'Hi #lovable', videoUrl: 'https://x/v.mp4', dueAt: at })).toEqual({
      channelId: 'ch-ig',
      text: 'Hi #lovable',
      schedulingType: 'automatic',
      mode: 'customScheduled',
      dueAt: '2026-10-22T15:20:00.000Z',
      assets: [{ video: { url: 'https://x/v.mp4' } }],
      metadata: { instagram: { type: 'reel', shouldShareToFeed: true } },
    })
  })

  it('straight away when it has no time', () => {
    const input = postInput({ channel: traderzi, caption: 'Hi', videoUrl: 'https://x/v.mp4', dueAt: null })
    expect(input.mode).toBe('shareNow')
    expect(input).not.toHaveProperty('dueAt')
  })
})

describe('talking to Buffer', () => {
  it('lists every channel of every organization a key holds, with the key', async () => {
    const { fetcher, asked } = fakeBuffer([
      { body: { data: { account: { organizations: [{ id: 'org1' }] } } } },
      { body: { data: { channels: [{ id: 'ch-ig', name: 'traderzi2', displayName: 'Trader Zi', service: 'instagram' }] } } },
    ])
    expect(await listChannels('k1', 2, fetcher)).toEqual([{ ...traderzi, key: 2 }])
    expect(asked[0].auth).toBe('Bearer k1')
    expect(asked[1].variables).toEqual({ input: { organizationId: 'org1' } })
  })

  it('says plainly when the key is refused, and when to try later', async () => {
    const refused = fakeBuffer([{ body: { errors: [{ message: 'nope', extensions: { code: 'UNAUTHORIZED' } }] } }])
    await expect(bufferCall('bad', 'query { account { id } }', {}, refused.fetcher)).rejects.toMatchObject({ auth: true })
    const busy = fakeBuffer([{ status: 429, body: {} }])
    await expect(bufferCall('k', 'query { account { id } }', {}, busy.fetcher)).rejects.toMatchObject({ later: true })
  })

  it('creates the post, and tries Instagram as a post when Buffer turns the Reel down', async () => {
    const { fetcher, asked } = fakeBuffer([
      { body: { data: { createPost: { message: 'Invalid instagram type' } } } },
      { body: { data: { createPost: { post: { id: 'bp1', status: 'scheduled' } } } } },
    ])
    const made = await createPost('k', { channel: traderzi, caption: 'Hi', videoUrl: 'https://x/v.mp4', dueAt: Date.now() + 60_000 }, fetcher)
    expect(made).toEqual({ id: 'bp1', status: 'scheduled' })
    const types = asked.map((a) => ((a.variables.input as { metadata: { instagram: { type: string } } }).metadata.instagram.type))
    expect(types).toEqual(['reel', 'post'])
  })

  it("passes on what Buffer said when it won't take the post", async () => {
    const { fetcher } = fakeBuffer([{ body: { data: { createPost: { message: 'Video could not be downloaded' } } } }])
    await expect(createPost('k', { channel: traderzi, caption: 'Hi', videoUrl: 'https://x/v.mp4', dueAt: null }, fetcher)).rejects.toThrow(
      new BufferError('Buffer said: Video could not be downloaded'),
    )
  })
})

describe('which posts Postiz holds go to Buffer, and when', () => {
  const now = Date.UTC(2026, 9, 22, 12, 0)
  const at = (minutes: number) => ({ id: `p${minutes}`, post_at: new Date(now + minutes * 60_000).toISOString() })

  it('the coming hours at their own time; missed ones from a few minutes on, apart', () => {
    const plan = handOverPlan([at(-60 * 3), at(-90), at(-30), at(60), at(HAND_AHEAD_MS / 60_000 + 30)], now)
    expect(plan.map((p) => p.post.id)).toEqual(['p-90', 'p-30', 'p60'])
    expect(plan[0].dueAt).toBe(now + 5 * 60_000)
    expect(plan[1].dueAt - plan[0].dueAt).toBe(MISSED_GAP_MS)
    expect(plan[2].dueAt).toBe(now + 60 * 60_000)
  })
})

describe("an account posting 25 a day on Buffer's free plan (10 waiting at once)", () => {
  const now = Date.UTC(2026, 9, 22, 15, 0)

  it('hands over the earliest first', () => {
    const at = (minutes: number) => ({ id: `p${minutes}`, post_at: new Date(now + minutes * 60_000).toISOString() })
    expect(handOverPlan([at(120), at(17), at(60)], now).map((p) => p.post.id)).toEqual(['p17', 'p60', 'p120'])
  })

  it('counts the room each channel has left: what is still waiting there, not what went out', () => {
    const ref = (channelId: string, status?: string) => ({ postId: 'x', channelId, at: '', status })
    const posts = [
      ...Array.from({ length: 7 }, () => ({ buffer_ids: { a1: ref('ch-jake', 'scheduled') } })),
      { buffer_ids: { a1: ref('ch-jake', 'sent') } },
      { buffer_ids: { a1: ref('ch-jake', 'error') } },
      { buffer_ids: { a2: ref('ch-zi') } },
      { buffer_ids: null },
    ]
    const room = roomLeft(posts, [{ id: 'ch-jake' }, { id: 'ch-zi' }, { id: 'ch-new' }])
    expect(Object.fromEntries(room)).toEqual({ 'ch-jake': BUFFER_QUEUE - 7, 'ch-zi': BUFFER_QUEUE - 1, 'ch-new': BUFFER_QUEUE })
    const crowded = Array.from({ length: 14 }, () => ({ buffer_ids: { a1: ref('ch-jake', 'scheduled') } }))
    expect(roomLeft(crowded, [{ id: 'ch-jake' }]).get('ch-jake')).toBe(0)
  })

  it("tells Buffer's own 'full' apart from a post it turns down", () => {
    expect(isFull("You've reached your queue limit of 10 posts. Upgrade to schedule more.")).toBe(true)
    expect(isFull('Video could not be downloaded')).toBe(false)
  })
})
