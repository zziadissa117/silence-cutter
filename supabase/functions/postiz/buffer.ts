// Buffer, as a backup for Postiz: the same video, caption and time, on the
// same Instagram accounts, when Postiz can't post it ("If ever Postiz fails to
// post anything, then we have a good backup that can post for us").
//
// Buffer's API is one GraphQL endpoint, a personal API key as a Bearer token
// (Buffer, Settings, API). Each Buffer account has its own key and channels;
// a channel is matched to a Postiz account by its username, so nothing is
// mapped by hand. Buffer has no upload: it fetches the video from a public
// HTTPS link - the server's own signed link (serveVideo), or Postiz's copy.
//
// Free plan: 3 channels and 10 scheduled posts per channel. So posts are
// handed over at most a few hours before their time (HAND_AHEAD_MS), earliest
// first, never more than BUFFER_QUEUE waiting in a channel at once - an
// account posting 25 a day gets its next 10, topped up as each goes out.

export const BUFFER_API = 'https://api.buffer.com'

/** How long before its time a post Postiz holds is handed to Buffer. */
export const HAND_AHEAD_MS = 6 * 60 * 60 * 1000
/** The most posts waiting in one Buffer channel at once: the free plan's limit. */
export const BUFFER_QUEUE = 10
/** A post Postiz should have posted this recently still goes, through Buffer.
 *  Kept short: Postiz's own scheduler can still post while its API is down,
 *  so an older one may already be out - better missed than posted twice. */
export const MISSED_MS = 2 * 60 * 60 * 1000
/** Missed posts go out this far apart, so an account never gets them all at once. */
export const MISSED_GAP_MS = 30 * 60 * 1000

export interface BufferChannel {
  /** Which of his Buffer keys holds it (an index into the sealed list). */
  key: number
  id: string
  name: string
  displayName: string
  service: string
}

/** One account of a post, sent through Buffer. */
export interface BufferRef {
  postId: string
  channelId: string
  at: string
  status?: string
  link?: string
}

export class BufferError extends Error {
  /** The key itself was refused. */
  auth: boolean
  /** Worth trying again later (rate limit, Buffer down). */
  later: boolean
  constructor(message: string, auth = false, later = false) {
    super(message)
    this.auth = auth
    this.later = later
  }
}

type Fetcher = (url: string, init: RequestInit) => Promise<Response>

/** One GraphQL call: its `data`, or a BufferError saying what went wrong. */
export async function bufferCall<T>(key: string, query: string, variables: Record<string, unknown> = {}, fetcher: Fetcher = fetch): Promise<T> {
  let response: Response
  try {
    response = await fetcher(BUFFER_API, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(60_000),
    })
  } catch (error) {
    throw new BufferError(`Buffer could not be reached (${error instanceof Error ? error.message : String(error)}).`, false, true)
  }
  const text = await response.text()
  let json: { data?: T; errors?: { message?: string; extensions?: { code?: string } }[] } | null = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  const first = json?.errors?.[0]
  const code = first?.extensions?.code ?? ''
  if (response.status === 401 || code === 'UNAUTHORIZED' || code === 'UNAUTHENTICATED') {
    throw new BufferError("Buffer didn't accept the key - make a new one in Buffer (Settings, API) and paste it again.", true)
  }
  if (response.status === 403 || code === 'FORBIDDEN') {
    throw new BufferError("Buffer says this key can't do that - check the key's access in Buffer (Settings, API).", true)
  }
  if (response.status === 429 || code === 'RATE_LIMIT_EXCEEDED') throw new BufferError('Buffer says too many requests right now.', false, true)
  if (response.status >= 500) throw new BufferError(`Buffer had a problem (${response.status}).`, false, true)
  if (first) throw new BufferError(`Buffer said: ${first.message ?? code ?? 'an error'}`)
  if (!response.ok || !json?.data) throw new BufferError(`Buffer said: ${text.slice(0, 200) || response.status}`)
  return json.data
}

/** Every channel a key holds, across its organizations. */
export async function listChannels(key: string, keyIndex: number, fetcher: Fetcher = fetch): Promise<BufferChannel[]> {
  const account = await bufferCall<{ account: { organizations: { id: string }[] } }>(key, 'query { account { organizations { id } } }', {}, fetcher)
  const channels: BufferChannel[] = []
  for (const org of account.account?.organizations ?? []) {
    const data = await bufferCall<{ channels: { id: string; name?: string; displayName?: string; service: string }[] }>(
      key,
      'query Channels($input: ChannelsInput!) { channels(input: $input) { id name displayName service } }',
      { input: { organizationId: org.id } },
      fetcher,
    )
    for (const c of data.channels ?? []) {
      channels.push({ key: keyIndex, id: String(c.id), name: String(c.name ?? ''), displayName: String(c.displayName ?? ''), service: String(c.service ?? '') })
    }
  }
  return channels
}

/** "@TraderZi2 " -> "traderzi2": how a username is compared. */
export function handleOf(text: string): string {
  return text.trim().replace(/^@/, '').toLowerCase()
}

const isInstagram = (platform: string) => platform.startsWith('instagram')

/** Postiz account id -> the Buffer channel posting for it: an Instagram
 *  account and an Instagram channel with the same username. */
export function matchChannels(
  accounts: readonly { id: string; platform: string; profile: string; disabled?: boolean }[],
  channels: readonly BufferChannel[],
): Record<string, BufferChannel> {
  const matched: Record<string, BufferChannel> = {}
  for (const account of accounts) {
    if (!isInstagram(account.platform) || !account.profile) continue
    const handle = handleOf(account.profile)
    const channel = channels.find((c) => c.service === 'instagram' && (handleOf(c.name) === handle || handleOf(c.displayName) === handle))
    if (channel) matched[account.id] = channel
  }
  return matched
}

/** What createPost is given: the caption, the video, its time (or now), and
 *  Instagram's own settings - shown on the feed, as Postiz posts it. */
export function postInput({
  channel,
  caption,
  videoUrl,
  dueAt,
  instagramType = 'reel',
}: {
  channel: Pick<BufferChannel, 'id' | 'service'>
  caption: string
  videoUrl: string
  /** Null: straight away. */
  dueAt: number | null
  instagramType?: 'reel' | 'post'
}): Record<string, unknown> {
  return {
    channelId: channel.id,
    text: caption,
    schedulingType: 'automatic',
    mode: dueAt === null ? 'shareNow' : 'customScheduled',
    ...(dueAt === null ? {} : { dueAt: new Date(dueAt).toISOString() }),
    assets: [{ video: { url: videoUrl } }],
    ...(channel.service === 'instagram' ? { metadata: { instagram: { type: instagramType, shouldShareToFeed: true } } } : {}),
  }
}

const CREATE = `mutation CreatePost($input: CreatePostInput!) {
  createPost(input: $input) {
    ... on PostActionSuccess { post { id status dueAt } }
    ... on MutationError { message }
  }
}`

/** Creates the post in Buffer. Instagram's type is tried as a Reel, then as
 *  a post, should Buffer turn the first down. */
export async function createPost(
  key: string,
  input: Parameters<typeof postInput>[0],
  fetcher: Fetcher = fetch,
): Promise<{ id: string; status: string }> {
  let said = ''
  for (const instagramType of input.channel.service === 'instagram' ? (['reel', 'post'] as const) : (['reel'] as const)) {
    const data = await bufferCall<{ createPost: { post?: { id: string; status?: string }; message?: string } }>(
      key,
      CREATE,
      { input: postInput({ ...input, instagramType }) },
      fetcher,
    )
    const post = data.createPost?.post
    if (post?.id) return { id: String(post.id), status: String(post.status ?? 'scheduled') }
    said = data.createPost?.message ?? 'no post came back'
    if (!/type|metadata|reel/i.test(said)) break
  }
  throw new BufferError(`Buffer said: ${said}`)
}

/** Where a post is in Buffer: scheduled, sending, sent, error. */
export async function readPost(key: string, id: string, fetcher: Fetcher = fetch): Promise<{ status: string; link: string | null }> {
  const data = await bufferCall<{ post: { id: string; status?: string; externalLink?: string | null } | null }>(
    key,
    'query Post($input: PostInput!) { post(input: $input) { id status externalLink } }',
    { input: { id } },
    fetcher,
  )
  if (!data.post) throw new BufferError('Buffer no longer has this post.')
  return { status: String(data.post.status ?? 'unknown'), link: data.post.externalLink ?? null }
}

/** Takes a post out of Buffer, so it doesn't go. One already gone is fine. */
export async function deletePost(key: string, id: string, fetcher: Fetcher = fetch): Promise<void> {
  const data = await bufferCall<{ deletePost: { id?: string; message?: string } }>(
    key,
    'mutation DeletePost($input: DeletePostInput!) { deletePost(input: $input) { ... on DeletePostSuccess { id } ... on MutationError { message } } }',
    { input: { id } },
    fetcher,
  )
  const said = data.deletePost?.message
  if (said && !/not found|no post/i.test(said)) throw new BufferError(`Buffer said: ${said}`)
}

/** Of posts Postiz holds, the ones to hand to Buffer now and when each goes:
 *  due within HAND_AHEAD_MS at its own time; missed in the last MISSED_MS
 *  from a few minutes on, MISSED_GAP_MS apart, oldest first. */
export function handOverPlan<T extends { id: string; post_at: string | null }>(posts: readonly T[], now: number): { post: T; dueAt: number }[] {
  const timed = posts.filter((p) => p.post_at !== null).map((p) => ({ post: p, at: new Date(p.post_at!).getTime() }))
  const soon = now + 3 * 60 * 1000
  const missed = timed.filter((t) => t.at < soon && t.at >= now - MISSED_MS).sort((a, b) => a.at - b.at)
  const coming = timed.filter((t) => t.at >= soon && t.at <= now + HAND_AHEAD_MS).sort((a, b) => a.at - b.at)
  return [
    ...missed.map((t, i) => ({ post: t.post, dueAt: now + 5 * 60 * 1000 + i * MISSED_GAP_MS })),
    ...coming.map((t) => ({ post: t.post, dueAt: t.at })),
  ]
}

/** How many more posts each channel can take now: BUFFER_QUEUE less the ones
 *  already waiting there (sent through Buffer, not yet sent or failed). */
export function roomLeft(
  posts: readonly { buffer_ids: Record<string, BufferRef> | null }[],
  channels: readonly Pick<BufferChannel, 'id'>[],
): Map<string, number> {
  const waiting = new Map<string, number>()
  for (const post of posts) {
    for (const ref of Object.values(post.buffer_ids ?? {})) {
      if (ref.status !== 'sent' && ref.status !== 'error') waiting.set(ref.channelId, (waiting.get(ref.channelId) ?? 0) + 1)
    }
  }
  return new Map(channels.map((c) => [c.id, Math.max(0, BUFFER_QUEUE - (waiting.get(c.id) ?? 0))]))
}

/** Buffer turning a post down because the channel is full (the plan's limit),
 *  not because of the post: it goes in once one is out. */
export function isFull(message: string): boolean {
  return /limit|queue is full|upgrade|maximum|too many (scheduled )?posts/i.test(message)
}
