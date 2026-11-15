// The demo's pretend server. While the demo runs, every call the app makes to
// the real server (the `cutter` and `postiz` functions, the storage behind
// them) is answered here from the made-up world instead - and nothing is ever
// sent on: a call to the real project that this file doesn't know is turned
// away, never let through. The rest (the app's own files on this computer,
// the speech model's download) goes as usual.
//
// What he does in the demo (approve, reject, a video sent) changes the
// made-up world, kept in this browser's storage so a reload keeps it.

import { FUNCTIONS_URL } from '../config'
import type { Person } from '../campaign/cloud'
import type { Profile, ServerPost } from '../campaign/posting'
import { deadAccounts } from '../../supabase/functions/postiz/deadAccounts.ts'
import { hookInsights } from '../../supabase/functions/postiz/hookInsights.ts'
import { monthDays } from '../../supabase/functions/postiz/month.ts'
import { fakeStoryboard } from '../../supabase/functions/postiz/motion.ts'
import { localDate } from '../../supabase/functions/postiz/slots.ts'
import { mondayOf, trackerWeek } from '../../supabase/functions/postiz/tracker.ts'
import { DEMO_NAME, makeWorld, type World } from './world'

const STATE_KEY = 'cutter.demo.state'
/** Where the pretend server keeps the parts of a video sent to it. */
const PARTS_HOST = 'https://demo-parts.invalid/'

/** The real project, whatever path: never reached from the demo. */
export const isRealServer = (url: string): boolean => /^https:\/\/[a-z0-9]+\.supabase\.co\//i.test(url) || url.startsWith(FUNCTIONS_URL)

type Body = Record<string, unknown>

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

export interface DemoServer {
  answer(url: string, init?: RequestInit): Promise<Response>
  world: World
}

export function loadWorld(videoUrl: (name: string) => string, now = Date.now(), tz = Intl.DateTimeFormat().resolvedOptions().timeZone): World {
  try {
    const raw = localStorage.getItem(STATE_KEY)
    if (raw) return JSON.parse(raw) as World
  } catch {
    // Made again below.
  }
  return makeWorld(now, tz, videoUrl)
}

export function forgetWorld(): void {
  try {
    localStorage.removeItem(STATE_KEY)
  } catch {
    // Nothing kept.
  }
}

export function makeServer(world: World, now: () => number = Date.now): DemoServer {
  const parts = new Map<string, Map<number, Blob>>()
  const save = () => {
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify(world))
    } catch {
      // Too big or blocked: this visit only.
    }
  }
  const tz = () => world.profile.timezone
  const all = () => [...world.history, ...world.posts]
  const find = (id: unknown) => world.posts.find((p) => p.id === id)
  const change = (id: unknown, fields: Partial<ServerPost>) => {
    const p = find(id)
    if (!p) return null
    Object.assign(p, fields)
    save()
    return p
  }

  const profile = (fields?: Partial<Profile['settings']>): Profile => {
    if (fields) {
      world.profile = { ...world.profile, settings: { ...world.profile.settings, ...fields } }
      save()
    }
    return world.profile
  }

  const views = () => {
    const accounts: Record<string, { views: number; followers: number; perVideo: number; at: string; next: string; history: { date: string; perVideo: number }[] }> = {}
    const today = localDate(new Date(now()), tz())
    for (const a of world.profile.accounts) {
      const history: { date: string; perVideo: number }[] = []
      for (let back = 14; back >= 0; back--) {
        const day = localDate(new Date(now() - back * 86_400_000), tz())
        const on = world.history.filter((p) => p.postAt && localDate(new Date(p.postAt), tz()) <= day && p.views?.[a.name] !== undefined).slice(-20)
        const sum = on.reduce((s, p) => s + (p.views?.[a.name] ?? 0), 0)
        if (on.length) history.push({ date: day, perVideo: Math.round(sum / on.length) })
      }
      const last = history[history.length - 1]?.perVideo ?? 0
      accounts[a.id] = { views: last * 30, followers: 1200 + a.id.length * 311, perVideo: last, at: new Date(now() - 2 * 3_600_000).toISOString(), next: today, history }
    }
    const month = monthDays(
      all().map((p) => ({ post_at: p.postAt, status: p.status, views: p.views ?? null })),
      now(),
      tz(),
    )
    return { accounts, month }
  }

  const insights = () => ({
    campaigns: hookInsights(
      world.history.map((p) => ({ campaign_id: p.campaignId, campaign_name: p.campaignName, headline: p.headline, file_name: p.fileName, batch: (p.batch as { look?: string; song?: string } | null) ?? null, views: p.views ?? null, post_at: p.postAt })),
      now(),
    ),
    bestHours: world.profile.bestHours ?? null,
    trouble: deadAccounts(
      world.history.map((p) => ({ post_at: p.postAt, accounts: p.accounts, views: p.views ?? null })),
      now(),
    ),
  })

  const week = (weeks: number) =>
    trackerWeek(
      all().map((p) => ({ post_at: p.postAt, status: p.status, campaign_id: p.campaignId, campaign_name: p.campaignName, batch: p.batch ? { date: p.batch.date } : null })),
      mondayOf(localDate(new Date(now()), tz()), weeks),
      now(),
      tz(),
    )

  /** A post action from the Posts screen. */
  const act = (action: string, body: Body): Response => {
    const p = find(body.id)
    if (!p) return json({ error: 'That post is no longer here.' }, 404)
    switch (action) {
      case 'approve': {
        const fields: Partial<ServerPost> = { status: 'scheduled', ...(typeof body.caption === 'string' ? { caption: body.caption } : {}) }
        if (typeof body.at === 'string') fields.postAt = body.at
        change(p.id, fields)
        // His 3rd yes in a batch approves the rest of it, as on the server.
        let alsoApproved = 0
        if (p.batch) {
          const yes = world.posts.filter((q) => q.batch?.id === p.batch?.id && q.status === 'scheduled').length
          if (yes >= 3) {
            for (const q of world.posts.filter((q) => q.batch?.id === p.batch?.id && q.status === 'waiting')) {
              q.status = 'scheduled'
              alsoApproved++
            }
            save()
          }
        }
        return json({ post: p, alsoApproved })
      }
      case 'ready':
        return json({ post: change(p.id, { status: 'approved', ready: true }) })
      case 'edit':
        return json({ post: change(p.id, { ...(typeof body.caption === 'string' ? { caption: body.caption } : {}), ...(typeof body.at === 'string' ? { postAt: body.at } : {}), ...(body.captions && typeof body.captions === 'object' ? { captions: body.captions as ServerPost['captions'] } : {}) }) })
      case 'reject':
        return json({ post: change(p.id, { status: 'rejected' }) })
      case 'unschedule':
        return json({ post: change(p.id, { status: 'waiting' }) })
      case 'self':
        return json({ post: change(p.id, { status: 'posted', retryAt: null, error: `You posted it yourself to ${p.accounts.map((a) => a.name).join(', ')}.` }) })
      case 'later':
      case 'retry':
      case 'retry-accounts':
        return json({ post: change(p.id, { status: 'scheduled', retryAt: null, error: null, postAt: new Date(now() + 45 * 60_000).toISOString() }) })
      default:
        return json({ error: `Not in the demo: ${action}` }, 400)
    }
  }

  const postiz = async (action: string, body: Body): Promise<Response> => {
    switch (action) {
      case 'connect':
      case 'profile':
      case 'accounts':
        return json(profile())
      case 'save-campaign': {
        const { campaignId, ...place } = body
        delete place.action
        delete place.token
        delete place.profile
        return json(profile({ campaigns: { ...world.profile.settings.campaigns, [String(campaignId)]: place as never } }))
      }
      case 'save-place':
        return json(profile({ instagramPlace: (body.place as never) ?? undefined }))
      case 'save-limits':
        return json(profile({ limits: body.limits as never }))
      case 'best-hours':
        world.profile.bestHours = world.profile.bestHours ? { ...world.profile.bestHours, off: Boolean(body.off) } : null
        save()
        return json(profile())
      case 'backup':
        return json({ ...profile(), backup: null })
      case 'posts':
        return json({ posts: world.posts })
      case 'views':
        return json(views())
      case 'week':
        return json(week(Number(body.weeks ?? 0)))
      case 'insights':
        return json(insights())
      case 'approve':
      case 'ready':
      case 'edit':
      case 'reject':
      case 'unschedule':
      case 'self':
      case 'later':
      case 'retry':
      case 'retry-accounts':
        return act(action, body)
      case 'stop-posts': {
        const ids = new Set((body.ids as string[]) ?? [])
        let stopped = 0
        for (const p of world.posts) {
          if (!ids.has(p.id) || p.status === 'posted') continue
          p.status = 'rejected'
          stopped++
        }
        save()
        return json({ stopped, unposting: 0 })
      }
      case 'stop-campaign': {
        let stopped = 0
        for (const p of world.posts) {
          if (p.campaignId !== body.campaignId || !['waiting', 'approved', 'scheduled'].includes(p.status)) continue
          p.status = 'rejected'
          stopped++
        }
        save()
        return json({ stopped, unposting: 0 })
      }
      case 'attach-accounts':
        return json({ added: 0, scheduled: 0, left: 0 })
      case 'recaption':
        return json({ rewriting: 0, tooSoon: 0 })
      case 'respread-batches':
        return json({ moved: 0, failed: 0, left: 0 })
      case 'end-campaign':
        return json(body.confirm ? { stopped: 0, removing: 0, profile: profile() } : { plan: { remove: [], keep: [], gone: 0 }, stopping: 0, connected: world.profile.accounts.length })
      case 'recheck-captions': {
        const phrases = ((body.phrases as string[]) ?? []).map((t) => t.replace(/\bmoon ?brew\b/gi, 'Moonbrew').replace(/\bfit ?pocket\b/gi, 'FitPocket'))
        const before = (body.phrases as string[]) ?? []
        const changed = phrases.flatMap((t, i) => (t !== before[i] ? [i] : []))
        const unsure = phrases.flatMap((t, i) => (/\d/.test(t) && !changed.includes(i) ? [i] : []))
        return json({ phrases, changed, unsure, costCents: 0.6 })
      }
      case 'write-caption':
        return json({ caption: 'This changed my whole morning routine ☕️ #morningroutine #moonbrewpartner', error: null })
      case 'video-headline': {
        const words = String(body.words ?? '').split(/\s+/).slice(0, 6).join(' ')
        return json({ headline: words || 'This app fixed my mornings' })
      }
      case 'headline-ideas':
        return json({ headlines: ['My coffee app texts me now', 'I tried the 6 AM coffee rule', 'This is why I stopped buying lattes'] })
      case 'read-note':
        return json({ plan: /tomorrow/i.test(String(body.note)) ? { perDay: null, startDate: localDate(new Date(now() + 86_400_000), tz()), days: null } : null, caption: '' })
      case 'trial-headlines':
        return json({ headlines: ['Wait for the end', 'I did not expect this', 'POV: you finally tried it', 'Why is nobody talking about this'] })
      case 'trial-reword':
        return json({ rewordings: (body.rewordings as string[]) ?? [], checked: 0 })
      case 'start': {
        const key = String(body.key)
        const campaign = body.campaign as { id: string; name: string; posting: ServerPost['approval'] extends string ? { approval: ServerPost['approval']; caption: ServerPost['captionBy'] } : never }
        const meta = (body.meta ?? {}) as { headline?: string; fileName?: string; duration?: number; batch?: ServerPost['batch'] }
        const existing = world.posts.find((p) => p.key === key)
        if (!existing) {
          world.posts.unshift({
            id: `demo-sent-${key}`,
            key,
            campaignId: campaign.id,
            campaignName: campaign.name,
            approval: campaign.posting?.approval ?? 'me',
            captionBy: campaign.posting?.caption ?? 'claude',
            remind: false,
            status: 'uploading',
            fileName: meta.fileName ?? null,
            headline: meta.headline ?? null,
            caption: null,
            title: null,
            postAt: meta.batch ? new Date(now() + 26 * 3_600_000).toISOString() : null,
            accounts: (world.profile.settings.campaigns?.[campaign.id]?.accounts ?? []).map((id) => {
              const a = world.profile.accounts.find((x) => x.id === id)!
              return { id: a.id, name: a.name, platform: a.platform, profile: a.profile }
            }),
            videoUrl: null,
            links: {},
            error: null,
            retryAt: null,
            createdAt: new Date(now()).toISOString(),
            duration: meta.duration ?? null,
            batch: meta.batch ?? null,
          })
          save()
        }
        const size = Number(body.size ?? 0)
        const partBytes = 5 * 1024 * 1024
        const count = Math.max(1, Math.ceil(size / partBytes))
        return json({ id: `demo-sent-${key}`, partBytes, uploads: Array.from({ length: count }, (_, part) => ({ part, url: `${PARTS_HOST}${encodeURIComponent(key)}/${part}` })), status: 'uploading' })
      }
      case 'sent': {
        const key = String(body.key)
        const got = parts.get(key)
        const p = world.posts.find((q) => q.key === key)
        if (p) {
          const video = got ? new Blob([...got.entries()].sort((a, b) => a[0] - b[0]).map(([, b]) => b), { type: 'video/mp4' }) : null
          Object.assign(p, {
            status: p.approval === 'direct' ? 'scheduled' : 'waiting',
            caption: 'Made with the Cutter in demo mode ✨ #demo',
            videoUrl: video ? URL.createObjectURL(video) : null,
          })
          save()
        }
        return json({ id: p?.id ?? key, status: p?.status ?? 'waiting' })
      }
      case 'push':
      case 'unpush':
        return json({})
      case 'motion-plan': {
        // The server's own made-up plan (its tests' fake), over his words.
        const words = Array.isArray(body.words) ? body.words.length : 0
        const format = body.format === 'glass' ? 'glass' : 'board'
        const reply = Array.isArray(body.chat) && body.chat.length > 0 ? 'Done - in the demo the plan stays the same.' : ''
        return json({ status: 'done', storyboard: fakeStoryboard(words, format), reply, costCents: 2 })
      }
      case 'motion-result':
      case 'trial-read':
        return json({ error: 'Demo mode: Claude is not connected here.' }, 400)
      default:
        return json({ error: `Demo mode: "${action}" is not part of the demo.` }, 400)
    }
  }

  const cutter = async (action: string, body: Body): Promise<Response> => {
    switch (action) {
      case 'login':
      case 'accept-invite':
        return json({ token: 'demo-token', name: DEMO_NAME })
      case 'pull':
        return json({ items: [], until: new Date(now()).toISOString() })
      case 'push':
      case 'report':
      case 'server-ping':
        return json({})
      case 'upload-urls':
        return json({ uploads: [] })
      case 'download-urls':
      case 'song-urls':
      case 'warmup-urls':
        return json({ urls: {} })
      case 'whoami':
        return json({ space: 'demo-space', name: DEMO_NAME })
      case 'people':
        return json({ people: world.people })
      case 'invite': {
        const name = String(body.name ?? '').trim().toLowerCase()
        if (!/^[a-z0-9]{3,30}$/.test(name)) return json({ error: 'Pick a login name: 3 to 30 letters or digits, no spaces.' }, 400)
        world.people.push({ name, status: 'invited', until: new Date(now() + 48 * 3_600_000).toISOString(), since: new Date(now()).toISOString(), ...(body.only === 'trial' ? { only: 'trial' as const } : {}) })
        save()
        return json({ code: 'demo-invite-code', until: new Date(now() + 48 * 3_600_000).toISOString() })
      }
      case 'pause':
      case 'trial':
      case 'partner':
      case 'remove-device': {
        const person = world.people.find((p) => p.name === body.name)
        if (person) {
          if (action === 'pause') person.status = body.paused ? 'paused' : 'active'
          if (action === 'trial') person.trial = Boolean(body.on)
          if (action === 'partner') person.partner = Boolean(body.on)
          if (action === 'remove-device') person.devices = (person.devices ?? []).filter((d) => d.id !== body.device)
          save()
        }
        return json({ people: world.people as Person[] })
      }
      case 'songs':
        return json({ songs: world.songs })
      case 'song-upload':
      case 'warmup-upload':
        return json({ url: null })
      case 'add-song': {
        const song = { ...(body.song as World['songs'][number]), addedAt: now() }
        world.songs = [...world.songs.filter((s) => s.id !== song.id), song]
        save()
        return json({ song })
      }
      case 'rename-song':
        world.songs = world.songs.map((s) => (s.id === body.id ? { ...s, name: String(body.name) } : s))
        save()
        return json({})
      case 'remove-song':
        world.songs = world.songs.filter((s) => s.id !== body.id)
        save()
        return json({})
      case 'warmups':
        return json(world.warmups)
      case 'warmup-save': {
        const idea = { ...(body.idea as World['warmups']['ideas'][number]), by: '', byName: DEMO_NAME, status: 'approved' as const, addedAt: now() }
        world.warmups.ideas = [...world.warmups.ideas.filter((i) => i.id !== idea.id), idea]
        save()
        return json({ idea })
      }
      case 'warmup-approve':
        world.warmups.ideas = body.approve ? world.warmups.ideas.map((i) => (i.id === body.id ? { ...i, status: 'approved' } : i)) : world.warmups.ideas.filter((i) => i.id !== body.id)
        save()
        return json({})
      case 'warmup-remove':
        world.warmups.ideas = world.warmups.ideas.filter((i) => i.id !== body.id)
        save()
        return json({})
      case 'warmcat-add': {
        const category = { id: `cat-${now()}`, name: String(body.name), status: 'approved' as const, by: '', addedAt: now() }
        world.warmups.categories.push(category)
        save()
        return json({ category })
      }
      case 'warmcat-approve':
        world.warmups.categories = body.approve ? world.warmups.categories.map((c) => (c.id === body.id ? { ...c, status: 'approved' } : c)) : world.warmups.categories.filter((c) => c.id !== body.id)
        save()
        return json({})
      default:
        return json({ error: `Demo mode: "${action}" is not part of the demo.` }, 400)
    }
  }

  return {
    world,
    async answer(url, init) {
      if (url.startsWith(PARTS_HOST)) {
        const [key, part] = url.slice(PARTS_HOST.length).split('/')
        const form = init?.body instanceof FormData ? init.body : null
        const blob = form ? [...form.values()].find((v): v is File => v instanceof Blob) : null
        if (blob) {
          const kept = parts.get(decodeURIComponent(key)) ?? new Map<number, Blob>()
          kept.set(Number(part), blob)
          parts.set(decodeURIComponent(key), kept)
        }
        return json({ Key: url })
      }
      if (!isRealServer(url)) return json({ error: 'not the demo server' }, 404)
      let body: Body = {}
      try {
        body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Body) : {}
      } catch {
        body = {}
      }
      const action = String(body.action ?? '')
      if (url.startsWith(`${FUNCTIONS_URL}/postiz`)) return postiz(action, body)
      if (url.startsWith(`${FUNCTIONS_URL}/cutter`)) return cutter(action, body)
      // Storage, or anything else of the real project: never reached.
      return json({ error: 'Demo mode: the real server is never called.' }, 403)
    },
  }
}

/** Puts the pretend server in front of fetch: the real project is never
 *  reached while it is in place. Returns how to take it away (tests). */
export function installServer(server: DemoServer, target: { fetch: typeof fetch } = window): () => void {
  const real = target.fetch.bind(target)
  const fake: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.startsWith(PARTS_HOST) || isRealServer(url)) return server.answer(url, init)
    return real(input, init)
  }
  target.fetch = fake
  return () => {
    target.fetch = real
  }
}
