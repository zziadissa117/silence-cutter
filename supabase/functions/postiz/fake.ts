// A pretend Postiz and a pretend Claude, for testing the whole posting path
// - phone upload, parts joined back, caption, times, approve, posted,
// reminders - without a real account ever being touched.
//
// A profile is a test one when its Postiz key starts "test-fake-postiz:";
// its Anthropic key "test-fake-claude" writes a canned caption. The
// pretend Postiz really fetches the video from the link it is given, and
// checks it is an MP4 of the size it should be, so a broken join fails here
// the way it would fail at Postiz. Its posts publish themselves once their
// time has passed.

export const FAKE_POSTIZ = 'test-fake-postiz:'
export const FAKE_CLAUDE = 'test-fake-claude'

export const isFakePostiz = (key: string) => key.startsWith(FAKE_POSTIZ)

// Loosely typed on purpose: this file only needs a few table calls.
// deno-lint-ignore no-explicit-any
type Db = any

const ACCOUNTS = [
  { id: 'fake-tiktok', name: 'fake.tiktok', identifier: 'tiktok', profile: 'fake.tiktok', picture: '', disabled: false },
  { id: 'fake-instagram', name: 'fake.instagram', identifier: 'instagram-standalone', profile: 'fake.instagram', picture: '', disabled: false },
  { id: 'fake-youtube', name: 'Fake YouTube', identifier: 'youtube', profile: 'fakeyoutube', picture: '', disabled: false },
  { id: 'fake-facebook', name: 'Fake Page', identifier: 'facebook', profile: 'fakepage', picture: '', disabled: false },
  { id: 'fake-tiktok-business', name: 'fake.business', identifier: 'tiktok-business', profile: 'fake.business', picture: '', disabled: false },
]

export class FakeError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** Answers a Postiz API call the way Postiz would. */
export async function fakePostiz(db: Db, key: string, method: string, path: string, body: unknown): Promise<unknown> {
  const owner = key
  if (method === 'GET' && path === '/integrations') return ACCOUNTS

  if (method === 'POST' && path === '/upload-from-url') {
    const url = (body as { url?: string })?.url
    if (!url) throw new FakeError(400, 'url must be a URL address')
    const response = await fetch(url)
    if (!response.ok) throw new FakeError(400, `Could not download the file (${response.status})`)
    const bytes = new Uint8Array(await response.arrayBuffer())
    const declared = Number(response.headers.get('content-length'))
    const box = new TextDecoder().decode(bytes.slice(4, 8))
    if (box !== 'ftyp') throw new FakeError(400, 'The file is not an MP4')
    if (declared && declared !== bytes.length) throw new FakeError(400, `Got ${bytes.length} bytes of ${declared}`)
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) => b.toString(16).padStart(2, '0')).join('')
    const { data } = await db
      .from('cutter_fake_postiz')
      .insert({ owner, kind: 'media', data: { size: bytes.length, sha256: digest } })
      .select('id')
      .single()
    return { id: data.id, name: 'video.mp4', path: `https://fake-uploads.postiz.test/${data.id}.mp4` }
  }

  if (method === 'POST' && path === '/posts') {
    const request = body as {
      type: string
      date: string
      posts: { integration: { id: string }; value: { content: string; image: { id: string; path: string }[] }[]; settings: Record<string, unknown> }[]
    }
    if (!['now', 'schedule', 'draft'].includes(request.type)) throw new FakeError(400, 'type must be one of now, schedule, draft')
    if (!request.date || Number.isNaN(Date.parse(request.date))) throw new FakeError(400, 'date must be a valid ISO 8601 date string')
    if (!Array.isArray(request.posts) || request.posts.length === 0) throw new FakeError(400, 'posts should not be empty')
    const group = crypto.randomUUID()
    const created: { postId: string; integration: string }[] = []
    for (const post of request.posts) {
      const account = ACCOUNTS.find((a) => a.id === post.integration?.id)
      if (!account) throw new FakeError(400, `Integration ${post.integration?.id} not found`)
      if (post.settings?.__type !== account.identifier) throw new FakeError(400, `settings.__type must be ${account.identifier}`)
      if (account.identifier.startsWith('tiktok') && (post.settings.brand_content_toggle !== false || post.settings.brand_organic_toggle !== false)) {
        throw new FakeError(400, 'A test post was marked as branded content')
      }
      if (account.identifier === 'youtube') {
        const title = String(post.settings.title ?? '')
        if (title.length < 2 || title.length > 100) throw new FakeError(400, 'title must be between 2 and 100 characters')
      }
      const content = post.value?.[0]?.content ?? ''
      if (!content.trim()) throw new FakeError(400, 'content should not be empty')
      if (!post.value?.[0]?.image?.[0]?.path) throw new FakeError(400, 'A video is needed')
      const date = request.type === 'now' ? new Date().toISOString() : request.date
      const { data } = await db
        .from('cutter_fake_postiz')
        .insert({
          owner,
          kind: 'post',
          data: { group, content, date, type: request.type, integration: account.id, name: account.name, identifier: account.identifier, settings: post.settings },
        })
        .select('id')
        .single()
      created.push({ postId: data.id, integration: account.id })
    }
    return created
  }

  if (method === 'GET' && path.startsWith('/posts?')) {
    const query = new URLSearchParams(path.slice('/posts?'.length))
    const from = Date.parse(query.get('startDate') ?? '')
    const to = Date.parse(query.get('endDate') ?? '')
    const { data } = await db.from('cutter_fake_postiz').select('id, data').eq('owner', owner).eq('kind', 'post')
    const posts = (data ?? [])
      .filter((row: { data: { date: string } }) => {
        const at = Date.parse(row.data.date)
        return at >= from && at <= to
      })
      .map((row: { id: string; data: { date: string; content: string; integration: string; name: string; identifier: string; type: string } }) => {
        const due = Date.parse(row.data.date) <= Date.now()
        return {
          id: row.id,
          content: row.data.content,
          publishDate: row.data.date,
          state: row.data.type === 'draft' ? 'DRAFT' : due ? 'PUBLISHED' : 'QUEUE',
          releaseURL: due ? `https://fake.social.test/${row.data.identifier}/${row.id}` : undefined,
          integration: { id: row.data.integration, providerIdentifier: row.data.identifier, name: row.data.name },
        }
      })
    return { posts }
  }

  const removing = path.match(/^\/posts\/([0-9a-f-]{36})$/)
  if (method === 'DELETE' && removing) {
    const { data } = await db.from('cutter_fake_postiz').select('data').eq('id', removing[1]).maybeSingle()
    if (data) {
      const { data: rows } = await db.from('cutter_fake_postiz').select('id, data').eq('owner', owner).eq('kind', 'post')
      const inGroup = (rows ?? []).filter((r: { data: { group: string } }) => r.data.group === data.data.group).map((r: { id: string }) => r.id)
      await db.from('cutter_fake_postiz').delete().in('id', inGroup)
    }
    return { id: removing[1] }
  }

  throw new FakeError(404, `The pretend Postiz has no ${method} ${path}`)
}

/** A caption like one Claude would write - with "#ad" in it, so the tests
 *  see it taken out. */
export function fakeCaption(transcript: string, headline: string): { caption: string; title: string } {
  const words = transcript.split(/\s+/).filter(Boolean).slice(0, 10).join(' ')
  return {
    caption: `${words || headline || 'New video'} 👀\n\n#testing #cutter #ad`,
    title: headline || words || 'Test video',
  }
}
