// The demo's made-up world, as the server would hold it: one creator ("Sam"),
// three made-up brands, five made-up accounts and about a month and a half of
// posts with views. Nothing here comes from a real login: every name, number
// and caption is invented, and the same `now` always makes the same world.

import type { Person } from '../campaign/cloud'
import type { PostizAccount, Profile, ServerPost } from '../campaign/posting'
import type { WarmupList } from '../campaign/warmups'
import { addDays, localDate, zoned } from '../../supabase/functions/postiz/slots.ts'

export const DEMO_NAME = 'Sam'

export const ACCOUNTS: PostizAccount[] = [
  { id: 'acc-tt-1', name: 'Sam makes things', platform: 'tiktok', profile: 'sam.makes.things', picture: '', disabled: false },
  { id: 'acc-ig-1', name: 'Sam tries apps', platform: 'instagram', profile: 'sam.tries.apps', picture: '', disabled: false },
  { id: 'acc-yt-1', name: 'Sam Demo', platform: 'youtube', profile: '', picture: '', disabled: false },
  { id: 'acc-tt-2', name: 'Sam after dark', platform: 'tiktok', profile: 'sam.after.dark', picture: '', disabled: false },
  { id: 'acc-ig-2', name: 'Sam daily', platform: 'instagram', profile: 'samdaily.demo', picture: '', disabled: false },
]

export const CAMPAIGN_IDS = { moonbrew: 'demo-moonbrew', fitpocket: 'demo-fitpocket', notely: 'demo-notely' } as const

const PLACES: Record<string, string[]> = {
  [CAMPAIGN_IDS.moonbrew]: ['acc-tt-1', 'acc-ig-1', 'acc-yt-1'],
  [CAMPAIGN_IDS.fitpocket]: ['acc-tt-2', 'acc-ig-2'],
}

const NAMES: Record<string, string> = {
  [CAMPAIGN_IDS.moonbrew]: 'Moonbrew',
  [CAMPAIGN_IDS.fitpocket]: 'FitPocket',
  [CAMPAIGN_IDS.notely]: 'Notely',
}

export const MOONBREW_HEADLINES = [
  'This app fixed my mornings',
  'POV: your coffee knows your schedule',
  'I stopped wasting $6 a day',
  'Nobody talks about this coffee app',
  'The coffee hack I wish I knew sooner',
]
export const FITPOCKET_HEADLINES = ['10 minutes a day, 40 days in', 'The workout app that plans my week', 'POV: you finally kept a streak']

const SONGS = ['song-sunny', 'song-night']
const REACTIONS = ['react-1', 'react-2', 'react-3']
const LOOKS = ['outline', 'box', 'snap'] as const

const CAPTIONS = [
  'My mornings are actually calm now ☕️ #coffee #morningroutine #moonbrewpartner',
  'Didn’t think an app could change how I drink coffee… #coffeetok #moonbrewpartner',
  'Saved so much this month, not even kidding #moneytips #moonbrewpartner',
  'Day 40 of not skipping a workout 💪 #fitness #fitpocketpartner',
  'Ten minutes. That’s it. #homeworkout #fitpocketpartner',
]

/** A seeded random number generator, so the world is the same each time. */
function seeded(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

export interface World {
  profile: Profile
  /** What the Posts screen lists: the last two days and everything to come. */
  posts: ServerPost[]
  /** Every post, back 45 days, for the numbers. */
  history: ServerPost[]
  people: Person[]
  warmups: WarmupList
  songs: { id: string; name: string; type: string; size: number; sha: string; addedAt: number; sfx?: true }[]
}

const iso = (ms: number) => new Date(ms).toISOString()

function accountsOf(campaignId: string) {
  return (PLACES[campaignId] ?? []).map((id) => {
    const a = ACCOUNTS.find((x) => x.id === id)!
    return { id: a.id, name: a.name, platform: a.platform, profile: a.profile }
  })
}

function post(fields: Partial<ServerPost> & Pick<ServerPost, 'id' | 'campaignId' | 'status'>): ServerPost {
  return {
    key: fields.id,
    campaignName: NAMES[fields.campaignId] ?? 'Demo',
    approval: 'me',
    captionBy: 'claude',
    remind: false,
    fileName: null,
    headline: null,
    caption: null,
    title: null,
    postAt: null,
    accounts: accountsOf(fields.campaignId),
    videoUrl: null,
    links: {},
    error: null,
    retryAt: null,
    createdAt: iso(Date.now() - 3_600_000),
    duration: 14,
    ...fields,
  }
}

/** Views a video by hour: the evening does best, the night worst. */
function hourBoost(hour: number): number {
  if (hour >= 18 && hour <= 22) return 1.8
  if (hour >= 11 && hour <= 14) return 1.3
  if (hour < 7) return 0.5
  return 1
}

function linksFor(p: ServerPost): Record<string, string> {
  const out: Record<string, string> = {}
  for (const a of p.accounts) out[a.name] = `https://example.com/demo/${a.platform}/${p.id}`
  return out
}

export function makeWorld(now: number, tz: string, videoUrl: (name: string) => string): World {
  const rand = seeded(20261115)
  const today = localDate(new Date(now), tz)
  const at = (date: string, time: string) => zoned(date, time, tz).getTime()

  // About a month and a half of batch videos that went out, with views.
  const history: ServerPost[] = []
  for (let back = 45; back >= 1; back--) {
    const date = addDays(today, -back)
    for (const campaignId of [CAMPAIGN_IDS.moonbrew, CAMPAIGN_IDS.fitpocket]) {
      const perDay = campaignId === CAMPAIGN_IDS.moonbrew ? 4 : 3
      for (let n = 0; n < perDay; n++) {
        const hour = 9 + Math.floor((n * 13) / perDay) + Math.floor(rand() * 3)
        const time = `${String(hour % 24).padStart(2, '0')}:${String(Math.floor(rand() * 60)).padStart(2, '0')}`
        const postAt = at(date, time)
        const headlines = campaignId === CAMPAIGN_IDS.moonbrew ? MOONBREW_HEADLINES : FITPOCKET_HEADLINES
        const h = Math.floor(rand() * headlines.length)
        const r = Math.floor(rand() * REACTIONS.length)
        const s = Math.floor(rand() * SONGS.length)
        const look = LOOKS[Math.floor(rand() * LOOKS.length)]
        // The best headline and reaction get more views; the account gone
        // cold (acc-ig-2) gets almost none in the last week.
        const base = 600 + rand() * 900
        const lift = (h === 0 ? 2.1 : h === 2 ? 1.5 : 1) * (r === 1 ? 1.4 : 1) * (s === 0 ? 1.15 : 1) * hourBoost(hour)
        const growth = 1 + (45 - back) / 60
        const failed = rand() < 0.03
        const accounts = accountsOf(campaignId)
        const views: Record<string, number> = {}
        if (!failed && back >= 1) {
          for (const a of accounts) {
            const cold = a.id === 'acc-ig-2' && back <= 7
            views[a.name] = Math.round(cold ? 20 + rand() * 40 : base * lift * growth * (0.7 + rand() * 0.6))
          }
        }
        const id = `demo-hist-${campaignId}-${date}-${n}`
        history.push(
          post({
            id,
            campaignId,
            status: failed ? 'failed' : 'posted',
            postAt: iso(postAt),
            createdAt: iso(postAt - 20 * 3_600_000),
            headline: headlines[h],
            caption: CAPTIONS[(h + n) % CAPTIONS.length],
            fileName: `${REACTIONS[r]} + product-${(n % 3) + 1}.mp4`,
            batch: { id: `demo-batch-${campaignId}`, date, time, size: perDay, look, source: undefined, format: campaignId === CAMPAIGN_IDS.moonbrew && n % 2 ? 'fmt-talk' : 'fmt-react' },
            views: failed ? null : views,
            error: failed ? 'TikTok refused the video: try again later.' : null,
          }),
        )
        const last = history[history.length - 1]
        last.batch = { ...last.batch!, song: SONGS[s] } as ServerPost['batch'] & { song: string }
        if (!failed) last.links = linksFor(last)
      }
    }
  }

  // The last two days and what is to come: what the Posts screen lists.
  const posts: ServerPost[] = []
  const tomorrow = addDays(today, 1)
  const hourNow = Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(new Date(now)))
  const later = (h: number) => `${String(Math.min(23, hourNow + h)).padStart(2, '0')}:${h % 2 ? '15' : '40'}`

  // Just posted, with views and links.
  for (const [i, minutes] of [[0, 50], [1, 140]] as const) {
    const p = post({
      id: `demo-posted-${i}`,
      campaignId: CAMPAIGN_IDS.moonbrew,
      status: 'posted',
      postAt: iso(now - minutes * 60_000),
      headline: MOONBREW_HEADLINES[i],
      caption: CAPTIONS[i],
      fileName: `react-${i + 1} + product-1.mp4`,
      batch: { id: 'demo-batch-moonbrew', date: today, time: '09:00', size: 4, look: 'outline', format: 'fmt-react' },
      views: { 'Sam makes things': 312 + i * 90, 'Sam tries apps': 128, 'Sam Demo': 41 },
      videoUrl: videoUrl(i ? 'react-2' : 'react-1'),
    })
    p.links = linksFor(p)
    posts.push(p)
  }
  // Scheduled for later today, one going again after a miss.
  posts.push(
    post({ id: 'demo-sched-0', campaignId: CAMPAIGN_IDS.moonbrew, status: 'scheduled', postAt: iso(at(today, later(1))), headline: MOONBREW_HEADLINES[2], caption: CAPTIONS[2], fileName: 'react-3 + product-2.mp4', batch: { id: 'demo-batch-moonbrew', date: today, time: later(1), size: 4, look: 'box', format: 'fmt-react' }, videoUrl: videoUrl('react-3') }),
    post({ id: 'demo-sched-1', campaignId: CAMPAIGN_IDS.fitpocket, status: 'scheduled', postAt: iso(at(today, later(2))), headline: FITPOCKET_HEADLINES[0], caption: CAPTIONS[3], fileName: 'react-2 + product-3.mp4', batch: { id: 'demo-batch-fitpocket', date: today, time: later(2), size: 3, look: 'outline', format: 'fmt-react' }, videoUrl: videoUrl('react-2') }),
    post({
      id: 'demo-again-0',
      campaignId: CAMPAIGN_IDS.moonbrew,
      status: 'posted',
      postAt: iso(now - 5 * 3_600_000),
      retryAt: iso(at(today, later(3))),
      headline: MOONBREW_HEADLINES[3],
      caption: CAPTIONS[1],
      fileName: 'react-1 + product-3.mp4',
      batch: { id: 'demo-batch-moonbrew', date: today, time: '07:30', size: 4, look: 'snap', format: 'fmt-react' },
      error: `YouTube's daily upload limit was reached. Not posted to Sam Demo. Posting again ${later(3)}.`,
      videoUrl: videoUrl('react-1'),
    }),
  )
  // The day after tomorrow: the batch's four, approved already.
  const after = addDays(today, 2)
  for (let i = 0; i < 4; i++) {
    const time = ['10:20', '13:45', '18:30', '22:05'][i]
    posts.push(
      post({ id: `demo-approved-${i}`, campaignId: CAMPAIGN_IDS.moonbrew, status: i ? 'scheduled' : 'approved', postAt: iso(at(after, time)), headline: MOONBREW_HEADLINES[(i + 4) % 5], caption: CAPTIONS[i % 3], fileName: `react-${(i % 3) + 1} + product-1.mp4`, batch: { id: 'demo-batch-moonbrew', date: after, time, size: 4, look: LOOKS[i % 3], format: 'fmt-react' }, videoUrl: videoUrl(`react-${(i % 3) + 1}`) }),
    )
  }
  // To approve: a batch for tomorrow, a hand-made one and a brand one.
  for (let i = 0; i < 4; i++) {
    const time = ['12:05', '15:40', '19:10', '21:35'][i]
    posts.push(
      post({
        id: `demo-wait-${i}`,
        campaignId: CAMPAIGN_IDS.moonbrew,
        status: 'waiting',
        postAt: iso(at(tomorrow, time)),
        headline: MOONBREW_HEADLINES[i],
        caption: CAPTIONS[i % 3],
        fileName: i % 2 ? `talk hook-${(i % 2) + 1} + product-1.mp4` : `react-${i + 1} + product-${i + 1}.mp4`,
        batch: { id: 'demo-batch-moonbrew-next', date: tomorrow, time, size: 4, look: LOOKS[i % 3], format: i % 2 ? 'fmt-talk' : 'fmt-react' },
        videoUrl: videoUrl(i % 2 ? 'hook-1' : `react-${i + 1}`),
        createdAt: iso(now - (30 - i) * 60_000),
      }),
    )
  }
  posts.push(
    post({ id: 'demo-wait-brand', campaignId: CAMPAIGN_IDS.fitpocket, status: 'waiting', approval: 'brand', postAt: iso(at(tomorrow, '18:00')), headline: FITPOCKET_HEADLINES[1], caption: CAPTIONS[4], fileName: 'Sam - plan my week.mp4', videoUrl: videoUrl('talk-fitpocket'), duration: 17 }),
  )
  // Didn't go out, won't go again by itself.
  const missed = post({
    id: 'demo-missed-0',
    campaignId: CAMPAIGN_IDS.fitpocket,
    status: 'failed',
    postAt: iso(now - 20 * 3_600_000),
    headline: FITPOCKET_HEADLINES[2],
    caption: CAPTIONS[3],
    fileName: 'react-3 + product-2.mp4',
    batch: { id: 'demo-batch-fitpocket', date: addDays(today, -1), time: '16:10', size: 3, look: 'outline', format: 'fmt-react' },
    error: 'Instagram refused the video twice. Not posted to Sam daily.',
    videoUrl: videoUrl('react-3'),
  })
  posts.push(missed)

  const weights = Array.from({ length: 7 }, (_, day) => Array.from({ length: 24 }, (_, hour) => Math.round(hourBoost(hour) * (day === 0 || day === 6 ? 1.1 : 1) * 10) / 10))

  const profile: Profile = {
    id: 'demo-profile',
    accounts: ACCOUNTS,
    settings: {
      campaigns: {
        [CAMPAIGN_IDS.moonbrew]: { accounts: PLACES[CAMPAIGN_IDS.moonbrew], times: [], window: { from: '09:00', to: '23:00', perDay: 4 } },
        [CAMPAIGN_IDS.fitpocket]: { accounts: PLACES[CAMPAIGN_IDS.fitpocket], times: ['12:30', '18:00', '20:30'] },
      },
      limits: { platforms: { youtube: { perDay: 3 } } },
    },
    timezone: tz,
    hasAnthropic: true,
    trialReels: true,
    vapidPublic: null,
    backup: null,
    bestHours: { weights, videos: history.length, at: iso(now - 6 * 3_600_000) },
  }

  const people: Person[] = [
    {
      name: 'jordan',
      status: 'active',
      until: null,
      since: iso(now - 20 * 86_400_000),
      devices: [{ id: 'dev-1', name: 'iPhone · Home Screen app', firstSeen: iso(now - 20 * 86_400_000), lastSeen: iso(now - 25 * 60_000) }],
      trial: false,
      partner: true,
    },
    { name: 'riley', status: 'invited', until: iso(now + 30 * 3_600_000), since: iso(now - 18 * 3_600_000) },
  ]

  const warmups: WarmupList = {
    owner: true,
    partner: false,
    categories: [
      { id: 'training', name: 'Training', status: 'approved', by: '', addedAt: 1 },
      { id: 'ai', name: 'AI', status: 'approved', by: '', addedAt: 2 },
      { id: 'food', name: 'Food', status: 'waiting', by: 'jordan', addedAt: now - 3_600_000 },
    ],
    ideas: [
      { id: 'w-1', title: 'Point at the text', category: 'training', script: 'Phone on the table, look at it, point up when the text comes in.', headline: 'POV: you started training', headlineStyle: 'outline', seconds: 7, sound: null, example: { link: 'https://www.tiktok.com/@demo/video/1' }, by: '', byName: 'Sam', status: 'approved', addedAt: now - 9 * 86_400_000 },
      { id: 'w-2', title: 'Slow nod', category: 'ai', script: 'Look into the camera, nod slowly twice, smile on the second.', headline: 'When the AI finally gets it', headlineStyle: 'box', seconds: 6, sound: null, example: null, by: '', byName: 'Sam', status: 'approved', addedAt: now - 6 * 86_400_000 },
      { id: 'w-3', title: 'Coffee sip', category: 'training', script: 'Sip, look away, look back at the camera.', headline: 'Me after 5 AM gym', headlineStyle: 'snap', seconds: 7, sound: null, example: null, by: 'jordan', byName: 'jordan', status: 'approved', addedAt: now - 4 * 86_400_000 },
      { id: 'w-4', title: 'Fridge open', category: 'food', script: 'Open the fridge, stare at it, close it slowly.', headline: 'Meal prep Sunday be like', headlineStyle: 'outline', seconds: 5, sound: null, example: null, by: 'jordan', byName: 'jordan', status: 'waiting', addedAt: now - 2 * 3_600_000 },
    ],
  }

  return { profile, posts, history, people, warmups, songs: [] }
}
