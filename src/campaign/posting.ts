// Posting finished videos to Postiz, from the phone's side: this person's
// posting profile, and the calls to the postiz function that does the
// posting (supabase/functions/postiz). Postiz itself is never called from
// here - it refuses web pages, and the keys stay on the server.
//
// Each person posts to their own Postiz. He and his friend share one login
// and the same campaigns, but the accounts a campaign posts to and the times
// it posts at are each person's own, kept in their profile on the server.
// The phone keeps only which profile is its own, and whether it sends.

import type { ViewsByAccount } from './analytics'
import { DEFAULT_WINDOW, LEAST_GAP_MINUTES, cleanWindow, evenTimes, windowTimes, type PostingWindow } from '../../supabase/functions/postiz/window.ts'
import { cleanPlace, type Place } from '../../supabase/functions/postiz/place.ts'
import { timesFor, timesOn } from '../../supabase/functions/postiz/slots.ts'
import { PUBLISHABLE_KEY, currentSession } from './cloud'
import type { Campaign, CampaignPosting } from './look'
import { dayTimes, spreadPick } from './batch'

const FUNCTION_URL = 'https://uykuoibqdxmpbbrsmyad.supabase.co/functions/v1/postiz'
const LOCAL_KEY = 'cutter.posting'

export interface PostizAccount {
  id: string
  name: string
  platform: string
  profile: string
  picture: string
  disabled: boolean
}

/** Where and when one campaign posts, for one person. Its own times, or -
 *  with none - a window that gives each day random times inside it
 *  (supabase/functions/postiz/window.ts, shared with the server). Neither:
 *  each video posts as soon as it is ready. */
export interface CampaignPlace {
  accounts: string[]
  times: string[]
  window?: PostingWindow
  /** Its own place for Instagram posts, over the default (place.ts). */
  instagramPlace?: Place
}

/** Pause and posts-a-day, per platform and per account. The server holds a
 *  paused or full account's post back and sends it when it is free - nothing
 *  is dropped (supabase/functions/postiz/limits.ts). */
export interface Limit {
  paused?: boolean
  perDay?: number
}
export interface Limits {
  platforms?: Record<string, Limit>
  accounts?: Record<string, Limit>
}

export interface Profile {
  id: string
  accounts: PostizAccount[]
  settings: {
    campaigns?: Record<string, CampaignPlace>
    limits?: Limits
    /** Campaigns being ended: accounts still to come out of Postiz. */
    ending?: Record<string, { accounts: string[]; at: string }>
    /** What ending each campaign did. */
    ended?: Record<string, EndedResult>
    /** The place every Instagram post is tagged with (place.ts). */
    instagramPlace?: Place
  }
  timezone: string
  hasAnthropic: boolean
  vapidPublic: string | null
  /** Buffer as a backup for Postiz (postiz/buffer.ts); null until a key is pasted. */
  backup?: BackupView | null
}

/** What the phone is told about the Buffer backup - never the keys. */
export interface BackupView {
  keys: number
  /** "Postiz is down": what Postiz holds on backed-up accounts goes through Buffer. */
  active: boolean
  problem: string | null
  checkedAt: string | null
  channels: { name: string; service: string }[]
  /** Postiz account id -> the Buffer channel backing it up. */
  matched: Record<string, string>
}

export type PostStatus = 'uploading' | 'writing' | 'waiting' | 'approved' | 'scheduled' | 'posted' | 'error' | 'rejected' | 'failed'

export interface ServerPost {
  id: string
  /** The phone's own id for the video - the job it was made from. */
  key: string
  campaignId: string
  campaignName: string
  approval: CampaignPosting['approval']
  captionBy: CampaignPosting['caption']
  remind: boolean
  status: PostStatus
  fileName: string | null
  headline: string | null
  caption: string | null
  title: string | null
  /** A caption (and title) written for one account, by account id; the rest use `caption`. */
  captions?: Record<string, { caption?: string; title?: string }>
  /** A repost of a video that already went out. */
  repost?: boolean
  /** He was told to repost it (the platform's own button) in the last few days. */
  repostDue?: boolean
  postAt: string | null
  /** `held`: paused or at its day's limit - not scheduled yet, and goes out by itself when free. */
  accounts: { id: string; name: string; platform: string; profile?: string; held?: 'paused' | 'cap' }[]
  /** Postiz's own copy of the video, for when this phone has none. */
  videoUrl: string | null
  links: Record<string, string>
  /** The account ids it went to through Buffer instead of Postiz. */
  viaBuffer?: string[]
  error: string | null
  retryAt: string | null
  createdAt: string
  /** Made by hand from New post. */
  byHand?: boolean
  /** Approved with "post later": it waits until he taps Post. */
  ready?: boolean
  /** Made from the Batch tab, for this day and time - and with this hook
   *  look, on videos made since looks were carried. */
  batch?: { id: string; date: string; time: string; size: number; look?: 'box' | 'outline' | 'snap' | 'formula' } | null
  /** Its views on each account it went to (by account name), as the server
   *  last read them from Postiz; absent until read. */
  views?: Record<string, number> | null
}

/** This phone's posting: whose profile, and whether it sends its finished
 *  videos. The profile is kept too, so the screens have it offline. */
export interface LocalPosting {
  profile: Profile
  sendHere: boolean
}

export function postingHere(): LocalPosting | null {
  try {
    const raw = localStorage.getItem(LOCAL_KEY)
    return raw ? (JSON.parse(raw) as LocalPosting) : null
  } catch {
    return null
  }
}

export function keepPosting(local: LocalPosting | null): void {
  try {
    if (local) localStorage.setItem(LOCAL_KEY, JSON.stringify(local))
    else localStorage.removeItem(LOCAL_KEY)
  } catch {
    // Storage blocked: posting set up for this visit only.
  }
}

export class PostingError extends Error {
  /** Worth trying again by itself: no signal, or the server busy. */
  later: boolean
  constructor(message: string, later = false) {
    super(message)
    this.later = later
  }
}

async function call<T>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  const session = currentSession()
  if (!session) throw new PostingError('Sign in with the shared login first, in Settings.')
  const ask = () =>
    fetch(FUNCTION_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: PUBLISHABLE_KEY },
      body: JSON.stringify({ action, token: session.token, ...body }),
    })
  let response: Response
  try {
    response = await ask()
  } catch {
    // Safari says the same "Load failed" for no signal and for a moment's
    // blip - or Supabase turning away a burst (its 429 carries no CORS
    // header, so the page can't read it): one more try a moment later
    // before saying there is no connection.
    if (!navigator.onLine) throw new PostingError('No connection. It goes when there is signal.', true)
    await new Promise((resolve) => setTimeout(resolve, 1500))
    try {
      response = await ask()
    } catch {
      throw new PostingError(navigator.onLine ? 'The server didn\'t answer. Trying again by itself.' : 'No connection. It goes when there is signal.', true)
    }
  }
  if (response.status === 429) throw new PostingError('The server is busy for a moment. Trying again by itself.', true)
  let json: T & { error?: string; later?: boolean }
  try {
    json = (await response.json()) as T & { error?: string; later?: boolean }
  } catch {
    // A good status with a body that can't be read: the connection dropped
    // mid-answer. An empty answer here once stood for "no posts" and took
    // the Posts screen down (posts.filter on undefined, 2026-10-22).
    if (response.ok) throw new PostingError('The answer was cut off. Trying again by itself.', true)
    json = {} as T & { error?: string; later?: boolean }
  }
  if (!response.ok) {
    if (json.error === 'no-profile') {
      keepPosting(null)
      throw new PostingError('Posting was disconnected on this phone. Set it up again in Settings.')
    }
    if (json.error === 'signed-out') throw new PostingError('Signed out of the shared login. Sign in again in Settings.')
    throw new PostingError(json.error ?? `The server said ${response.status}.`, json.later ?? response.status >= 500)
  }
  return json
}

function profileId(): string {
  const local = postingHere()
  if (!local) throw new PostingError('Posting is not set up on this phone.')
  return local.profile.id
}

function remember(profile: Profile): Profile {
  const local = postingHere()
  keepPosting({ profile, sendHere: local?.profile.id === profile.id ? local.sendHere : true })
  return profile
}

/** Sets posting up on this phone with this person's keys - or finds their
 *  profile again, if the Postiz key has been used before. */
export async function connect(postizKey: string, anthropicKey: string): Promise<Profile> {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return remember(await call<Profile>('connect', { postizKey, anthropicKey, timezone }))
}

const askProfile = shared(async () => remember(await call<Profile>('profile', { profile: profileId() })), 2000)

export async function refreshProfile(): Promise<Profile> {
  return askProfile()
}

export async function refreshAccounts(): Promise<Profile> {
  return remember(await call<Profile>('accounts', { profile: profileId() }))
}

export async function saveCampaignPlace(campaignId: string, place: CampaignPlace): Promise<Profile> {
  return remember(await call<Profile>('save-campaign', { profile: profileId(), campaignId, ...place }))
}

/** The place every Instagram post is tagged with, or none (place.ts). */
export async function saveInstagramPlace(place: Place | null): Promise<Profile> {
  return remember(await call<Profile>('save-place', { profile: profileId(), place }))
}

/** Of the accounts picked for a campaign, the ones some video already made
 *  for it - waiting, approved, or scheduled and not about to go out - does not
 *  go to, and how many videos are in that position. Read from the last list of
 *  posts the phone saw, so it is a hint for the checkbox, never the decision:
 *  the server decides what each video can still take. */
export function accountsBehind(
  campaignId: string,
  chosen: readonly string[],
  posts: readonly ServerPost[] = lastPosts(),
  now = Date.now(),
): { accounts: string[]; videos: number } {
  const open = posts.filter(
    (p) =>
      p.campaignId === campaignId &&
      (p.status === 'waiting' ||
        p.status === 'approved' ||
        (p.status === 'scheduled' && p.postAt !== null && Date.parse(p.postAt) > now + 2 * 60_000)),
  )
  const missing = new Set<string>()
  let videos = 0
  for (const post of open) {
    const have = new Set(post.accounts.map((a) => a.id))
    const lacking = chosen.filter((id) => !have.has(id))
    if (lacking.length > 0) videos++
    for (const id of lacking) missing.add(id)
  }
  return { accounts: [...missing], videos }
}

export async function saveLimits(limits: Limits): Promise<Profile> {
  return remember(await call<Profile>('save-limits', { profile: profileId(), limits }))
}

/** Buffer as a backup: a key pasted, every key taken out, or "Postiz is down"
 *  switched on or off. The server reads each key's channels again. */
export async function saveBackup(change: { bufferKey?: string; removeKeys?: boolean; active?: boolean }): Promise<Profile> {
  return remember(await call<Profile>('backup', { profile: profileId(), ...change }))
}

export interface AttachResult {
  /** Waiting or approved videos that now include the account. */
  added: number
  /** Scheduled videos that got a post for it at the time they already had. */
  scheduled: number
  /** Gone out already, too close to going out, or busy: left alone. */
  left: number
}

/** Catches the videos already made for a campaign up with accounts linked
 *  after them. The accounts must already be saved on the campaign. */
export async function attachAccounts(campaignId: string, accounts: string[]): Promise<AttachResult> {
  return call<AttachResult>('attach-accounts', { profile: profileId(), campaignId, accounts })
}

/** What happened, in words: "Added to 5 videos waiting and 3 scheduled. 2 had
 *  already gone out - they stay as they were." */
export function attachSummary(result: AttachResult): string {
  const parts: string[] = []
  if (result.added > 0) parts.push(`${result.added} video${result.added === 1 ? '' : 's'} waiting`)
  if (result.scheduled > 0) parts.push(`${result.scheduled} already scheduled`)
  const said = parts.length > 0 ? `Added to ${parts.join(' and ')}.` : 'No videos were waiting for it.'
  const left =
    result.left > 0
      ? ` ${result.left} ${result.left === 1 ? 'has' : 'have'} already gone out or ${result.left === 1 ? 'is' : 'are'} about to - ${result.left === 1 ? 'it stays' : 'they stay'} as ${result.left === 1 ? 'it was' : 'they were'}, and a new post is needed for the new account.`
      : ''
  return said + left
}

export function setSendHere(sendHere: boolean): void {
  const local = postingHere()
  if (local) keepPosting({ ...local, sendHere })
}

export function disconnect(): void {
  keepPosting(null)
}

export function placeFor(profile: Profile | undefined, campaignId: string): CampaignPlace {
  const place = profile?.settings.campaigns?.[campaignId]
  const window = cleanWindow(place?.window)
  const own = cleanPlace(place?.instagramPlace)
  return { accounts: place?.accounts ?? [], times: place?.times ?? [], ...(window ? { window } : {}), ...(own ? { instagramPlace: own } : {}) }
}

/** A campaign's times on one date, as the server will use them (slots.ts
 *  timesFor): its own, else that day's random ones from its window (or the
 *  default window). */
export function placeTimesOn(place: CampaignPlace, campaignId: string, date: string): string[] {
  return timesOn(timesFor(place, campaignId), date)
}

/** His own times, each once, in order - every one of them is used. */
export function ownDayTimes(place: Pick<CampaignPlace, 'times'>): string[] {
  return [...new Set(place.times)].sort()
}

/** How many candidate times a day's extras are picked from - at least twice
 *  as many as wanted. There is no most a day ("there's no limit, it's just +1,
 *  +1, +1"): what the window holds, a minute apart, is all that caps it. */
const candidatesFor = (count: number) => Math.max(50, count * 2)

/** A batch posts around the clock, spread over the whole day - his words
 *  (2026-10-26): "They have to be compressed by a 24-hour period. Always has
 *  to be posting." It used to draw from the campaign's window, which on most
 *  campaigns was the old default, 11 AM - 6 PM: 125 a day would have been
 *  squeezed into seven hours. The window still says when New post's posts go. */
export const BATCH_DAY: PostingWindow = { from: '00:00', to: '00:00', perDay: 1 }

/** A batch's times on one date: `perDay` of them, whatever the campaign's
 *  own count, spread over the whole day (BATCH_DAY) - three a day are hours
 *  apart, 125 a day 8 to 11 minutes. A campaign on his own times keeps them
 *  (an even pick when he wants fewer) and, when he wants more, adds ones
 *  spread over the rest of the day, clear of his. The server takes a batch
 *  video's own time as given. */
export function batchTimesOn(place: CampaignPlace, campaignId: string, date: string, perDay: number): string[] {
  const count = perDay
  const own = ownDayTimes(place)
  if (own.length === 0) return evenTimes(count, campaignId, date)
  if (count <= own.length) return dayTimes(own, count)
  // His times stay; the rest where the day's whole number would sit evenly,
  // farthest from his (stackTimesOn) - each once.
  return [...own, ...stackTimesOn(place, campaignId, date, count - own.length, own)].sort()
}

/** How far a stacked batch's times keep from the ones already taken: half
 *  as much as a window's own spacing, closing up on a full day. */
const STACK_GAP = 20

/** Times for a batch stacked on top of one already running: `perDay` of
 *  them in the day, each clear of every time already
 *  `taken` that day - so 3 a day and 2 more make 5, none on top of another -
 *  and each one `usable` (today: far enough ahead). Closer than STACK_GAP
 *  only when that many don't fit. */
export function stackTimesOn(
  /** The campaign's posting: a batch posts around the clock, whatever it says. */
  _place: CampaignPlace,
  campaignId: string,
  date: string,
  perDay: number,
  taken: readonly string[],
  usable: (time: string) => boolean = () => true,
): string[] {
  const count = perDay
  const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
  const away = (t: string) => Math.min(Infinity, ...taken.map((o) => Math.abs(minutes(o) - minutes(t))))
  // Where the day's whole number would sit evenly (evenTimes), the ones
  // farthest from the times it already has: as even as the day can be
  // without moving what is there (batchRespread in the posting function
  // moves those too).
  const grid = evenTimes(taken.length + count, `${campaignId}|stack`, date).filter((t) => usable(t) && away(t) >= LEAST_GAP_MINUTES)
  const picked = [...grid].sort((a, b) => away(b) - away(a)).slice(0, count)
  if (picked.length >= count) return picked.sort()
  // A crowded day: anything clear of the rest, around the clock (BATCH_DAY).
  const window = BATCH_DAY
  let clear: string[] = []
  for (let gap = STACK_GAP; gap >= LEAST_GAP_MINUTES && clear.length < count; gap--) {
    const far = (t: string) => taken.every((o) => Math.abs(minutes(o) - minutes(t)) >= gap)
    clear = windowTimes({ ...window, perDay: candidatesFor(count + taken.length) }, `${campaignId}|stack`, date, gap).filter((t) => far(t) && usable(t))
  }
  return spreadPick(clear, count, `${campaignId}|${date}|stack`)
}

/** The times a campaign's posts already hold, by day ("2026-10-14" →
 *  ["13:42", …]), on this phone's clock: every post not rejected or failed. */
export function takenTimes(posts: readonly ServerPost[], campaignId: string): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const post of posts) {
    if (post.campaignId !== campaignId || !post.postAt || post.status === 'rejected' || post.status === 'failed') continue
    const at = new Date(post.postAt)
    const date = at.toLocaleDateString('en-CA')
    const time = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
    out.set(date, [...(out.get(date) ?? []), time])
  }
  return out
}

/** The window its random times come from: its own as he set it, or the
 *  default every campaign without fixed times posts by. */
export function windowOf(place: Pick<CampaignPlace, 'window'>): PostingWindow {
  return cleanWindow(place.window) ?? DEFAULT_WINDOW
}

/** The campaigns still on fixed times of his own - the ones "Random times
 *  for every campaign" switches. */
export function onFixedTimes<C extends { id: string }>(profile: Profile, campaigns: readonly C[]): C[] {
  return campaigns.filter((c) => placeFor(profile, c.id).times.length > 0)
}

/** Switches each of them to random times: its own window if it ever had one,
 *  else the default. Accounts stay as they are. One at a time, so a failure
 *  names the campaign and the ones before it stay switched. */
export async function switchToRandom(profile: Profile, campaigns: readonly { id: string; name: string }[]): Promise<void> {
  for (const campaign of onFixedTimes(profile, campaigns)) {
    const place = placeFor(profile, campaign.id)
    try {
      await saveCampaignPlace(campaign.id, {
        accounts: place.accounts,
        times: [],
        window: cleanWindow(place.window) ?? DEFAULT_WINDOW,
        ...(place.instagramPlace ? { instagramPlace: place.instagramPlace } : {}),
      })
    } catch (error) {
      throw new PostingError(`${campaign.name} kept its own times: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

/** "2 a day at random, 11 AM - 6 PM". */
export function windowLabel(window: PostingWindow): string {
  return `${window.perDay} a day at random, ${timeLabel(window.from)} - ${timeLabel(window.to)}`
}

/** Whether this phone sends this campaign's finished videos to Postiz. */
export function sendsFrom(campaign: Campaign, local: LocalPosting | null = postingHere()): boolean {
  return Boolean(local?.sendHere) && placeFor(local!.profile, campaign.id).accounts.length > 0
}

// --- Posts ------------------------------------------------------------------

const POSTS_KEY = 'cutter.posts'

/** The posts as last seen, for opening the screen with no signal. */
/** Whether a post is one he is making again (Edit again) and it hasn't gone
 *  out: it is left out of Posts and its counts until the new version is sent
 *  and replaces it. One that went out stays - it can't be taken back. */
export function isBeingRemade(post: ServerPost, remaking: ReadonlySet<string>, now = Date.now()): boolean {
  if (!remaking.has(post.key)) return false
  if (post.status === 'scheduled') return post.postAt === null || Date.parse(post.postAt) > now
  return post.status === 'waiting' || post.status === 'approved' || post.status === 'writing' || post.status === 'uploading'
}

export function lastPosts(): ServerPost[] {
  try {
    return JSON.parse(localStorage.getItem(POSTS_KEY) ?? '[]') as ServerPost[]
  } catch {
    return []
  }
}

/** One question for many askers: the Posts screen, the Videos screen's
 *  count, the Batch tab and a top-up all ask for the posts, often in the same
 *  moment - every finished video makes each of them look again. A question
 *  already on its way is shared, and an answer from the last few seconds is
 *  used again, so a batch going up never sends Supabase a burst it turns
 *  away (it did: 18 at once, and the videos going up then said "No
 *  connection"). */
export function shared<T>(ask: () => Promise<T>, freshMs = 4000): (fresh?: boolean) => Promise<T> {
  let pending: Promise<T> | null = null
  let last: { at: number; value: T } | null = null
  // `fresh`: asked after a change he made - nothing from before it will do.
  return (fresh = false) => {
    if (!fresh && last && Date.now() - last.at < freshMs) return Promise.resolve(last.value)
    if (!fresh && pending) return pending
    const asking: Promise<T> = ask()
      .then((value) => {
        last = { at: Date.now(), value }
        return value
      })
      .finally(() => {
        if (pending === asking) pending = null
      })
    pending = asking
    return asking
  }
}

const askPosts = shared(async () => {
  const { posts } = await call<{ posts?: ServerPost[] }>('posts', { profile: profileId() })
  if (!Array.isArray(posts)) throw new PostingError('The answer was cut off. Trying again by itself.', true)
  try {
    localStorage.setItem(POSTS_KEY, JSON.stringify(posts))
  } catch {
    // Just won't be there offline.
  }
  return posts
})

/** The posts as the server has them now. `fresh`: after he changed one, so
 *  an answer from a moment ago won't do. */
export async function listPosts(fresh = false): Promise<ServerPost[]> {
  return askPosts(fresh)
}

const VIEWS_KEY = 'cutter.views'

/** Each account's views as the server last read them (analytics.ts), and the
 *  last copy seen, for offline. */
export function lastViews(): ViewsByAccount {
  try {
    return JSON.parse(localStorage.getItem(VIEWS_KEY) ?? '{}') as ViewsByAccount
  } catch {
    return {}
  }
}

export const listViews = shared(async (): Promise<ViewsByAccount> => {
  const { accounts } = await call<{ accounts: ViewsByAccount }>('views', { profile: profileId() })
  try {
    localStorage.setItem(VIEWS_KEY, JSON.stringify(accounts ?? {}))
  } catch {
    // Just won't be there offline.
  }
  return accounts ?? {}
}, 60_000)

export type PostAction = 'edit' | 'approve' | 'ready' | 'reject' | 'unschedule' | 'retry' | 'retry-accounts'

export async function postAction(
  action: PostAction,
  id: string,
  fields: { caption?: string; title?: string; at?: string; captions?: Record<string, { caption?: string; title?: string }> } = {},
): Promise<ServerPost> {
  const { post } = await call<{ post: ServerPost }>(action, { profile: profileId(), id, ...fields })
  return post
}

/** Stops every post of one campaign that has not gone out yet, at once.
 *  The ones Postiz holds are taken out of it in the background over the next
 *  few minutes (`unposting` of them). Other campaigns' posts are not touched. */
export async function stopCampaignPosts(campaignId: string): Promise<{ stopped: number; unposting: number }> {
  return call<{ stopped: number; unposting: number }>('stop-campaign', { profile: profileId(), campaignId })
}

export interface EndedAccount {
  name: string
  platform: string
  profile: string
}

export interface EndedResult {
  at: string
  removed: EndedAccount[]
  kept: (EndedAccount & { why: string })[]
  failed: (EndedAccount & { error: string })[]
}

/** What ending a campaign would do - nothing is changed by asking. */
export interface EndPreview {
  plan: { remove: (EndedAccount & { id: string })[]; keep: (EndedAccount & { id: string; why: string })[]; gone: number }
  /** Its posts not out yet, all stopped. */
  stopping: number
  /** Accounts connected in Postiz now (what the plan's limit counts). */
  connected: number
}

/** `names`: every campaign's name by id, for the reasons it gives. */
export async function previewEndCampaign(campaignId: string, names: Record<string, string>): Promise<EndPreview> {
  return call<EndPreview>('end-campaign', { profile: profileId(), campaignId, names })
}

/** Ends a campaign: its posts stopped, and the accounts he was shown
 *  (`confirm`) unticked at once and deleted from Postiz over the next minutes. */
export async function endCampaign(campaignId: string, names: Record<string, string>, confirm: string[]): Promise<{ stopped: number; removing: number }> {
  const done = await call<{ stopped: number; removing: number; profile: Profile }>('end-campaign', { profile: profileId(), campaignId, names, confirm })
  remember(done.profile)
  return done
}

/** What a redo does: add the campaign's missing hashtags, every word kept
 *  (the default), or have Claude write each caption again. */
export type RedoMode = 'hashtags' | 'rewrite'

/** Redoes the captions of a campaign's posts not out yet with its current
 *  rules and hashtags - all of them, or just `ids` (a batch). Scheduled ones
 *  whose caption changes go back to Postiz at their own time; ones within 15
 *  minutes of going out keep theirs (`tooSoon`). It happens on the server
 *  over the next few minutes. */
export async function redoCaptions(
  campaignId: string,
  posting: CampaignPosting,
  ids?: string[],
  mode: RedoMode = 'hashtags',
): Promise<{ rewriting: number; tooSoon: number }> {
  return call<{ rewriting: number; tooSoon: number }>('recaption', { profile: profileId(), campaignId, posting, mode, ...(ids ? { ids } : {}) })
}

/** "Adding #x to 40 posts…" - what a redo did, in words. */
export function redoSaid(name: string, result: { rewriting: number; tooSoon: number }, mode: RedoMode = 'hashtags', hashtags: string[] = []): string {
  const soon = result.tooSoon > 0 ? ` ${result.tooSoon} going out in the next 15 minutes ${result.tooSoon === 1 ? 'is' : 'are'} left as ${result.tooSoon === 1 ? 'it is' : 'they are'}.` : ''
  if (result.rewriting === 0) return `No ${name} posts to change.${soon}`
  const posts = `${result.rewriting} ${name} post${result.rewriting === 1 ? '' : 's'}`
  return mode === 'rewrite'
    ? `Rewriting the captions of ${posts} with the new rules - a few minutes. Scheduled ones stay at their times.${soon}`
    : `Adding ${hashtags.length > 0 ? hashtags.join(' ') : 'the missing hashtags'} to ${posts} - captions stay as they are, times stay the same.${soon}`
}

/** How many of a campaign's posts a caption redo would reach, from the last
 *  list of posts the phone saw. */
export function notOutYet(campaignId: string, posts: readonly ServerPost[] = lastPosts(), now = Date.now()): number {
  return posts.filter(
    (p) =>
      p.campaignId === campaignId &&
      (p.status === 'waiting' || p.status === 'approved' || (p.status === 'scheduled' && p.postAt !== null && Date.parse(p.postAt) - now >= 15 * 60_000)),
  ).length
}

/** Posts that can still be stopped: not gone out, not failed or posted. A
 *  scheduled one only while its time is ahead (the server's rule too). */
export function stoppable(posts: readonly ServerPost[], now = Date.now()): ServerPost[] {
  return posts.filter(
    (p) =>
      ['uploading', 'writing', 'waiting', 'approved'].includes(p.status) ||
      (p.status === 'scheduled' && (!p.postAt || Date.parse(p.postAt) > now)),
  )
}

/** Stops the posts he ticked on the Posts screen, the same way. */
export async function stopPosts(ids: string[]): Promise<{ stopped: number; unposting: number }> {
  return call<{ stopped: number; unposting: number }>('stop-posts', { profile: profileId(), ids })
}

/** Moves the batch's videos not out yet so each day's are evenly apart over
 *  the whole day (the posting function's respread-batches: one waiting stays
 *  waiting, one scheduled goes back into Postiz at its new time, the same
 *  video) - every campaign, or one. Under a minute a call: called again while
 *  some are left, until none are or a round moves none. */
export async function respreadBatches(campaignId?: string, onProgress?: (moved: number) => void): Promise<{ moved: number; failed: number; left: number }> {
  let moved = 0
  let failed = 0
  let left = 0
  for (let round = 0; round < 40; round++) {
    const done = await call<{ moved: number; failed: number; left: number }>('respread-batches', { profile: profileId(), ...(campaignId ? { campaignId } : {}) })
    moved += done.moved
    failed += done.failed
    left = done.left
    onProgress?.(moved)
    if (done.left === 0 || done.moved === 0) break
  }
  return { moved, failed, left }
}

export interface StopOutcome {
  stopped: number
  /** Still being taken out of Postiz in the background (fast path only). */
  unposting: number
  /** Posts that could not be stopped, with why. */
  failed: { post: ServerPost; reason: string }[]
}

/** How many reject calls go at once on the slow path. */
const STOP_AT_ONCE = 3

/** Stops these posts. Asks the server to do them all at once; a server from
 *  before that (it answers "Unknown action") is asked to reject them one by
 *  one instead - the same Reject as the button on each post, which takes a
 *  scheduled one out of Postiz - three at a time, soonest first, so the next
 *  to go out is stopped first. One that fails does not stop the rest. */
export async function stopPostsNow(posts: ServerPost[], onProgress?: (done: number, total: number) => void): Promise<StopOutcome> {
  if (posts.length === 0) return { stopped: 0, unposting: 0, failed: [] }
  try {
    const { stopped, unposting } = await stopPosts(posts.map((p) => p.id))
    onProgress?.(posts.length, posts.length)
    return { stopped, unposting, failed: [] }
  } catch (error) {
    if (!(error instanceof PostingError) || !/unknown action/i.test(error.message)) throw error
  }
  const queue = [...posts].sort((a, b) => (a.postAt ?? '').localeCompare(b.postAt ?? ''))
  const failed: StopOutcome['failed'] = []
  let stopped = 0
  let done = 0
  onProgress?.(0, posts.length)
  const worker = async () => {
    for (let post = queue.shift(); post; post = queue.shift()) {
      try {
        await postAction('reject', post.id)
        stopped++
      } catch (error) {
        failed.push({ post, reason: error instanceof Error ? error.message : String(error) })
      }
      onProgress?.(++done, posts.length)
    }
  }
  await Promise.all(Array.from({ length: Math.min(STOP_AT_ONCE, posts.length) }, worker))
  return { stopped, unposting: 0, failed }
}

export interface RecheckResult {
  phrases: string[]
  /** Indexes of the phrases Claude changed. */
  changed: number[]
  /** What the check cost, in cents, from the tokens the API reported. */
  costCents: number
  /** Said when Claude's answer could not be used. */
  error?: string
}

/** Claude's second look at a video's burned-in captions: fixes words that were
 *  misheard, using the campaign's names. Costs credits, so only on his tap. */
export async function recheckCaptions(phrases: string[], vocabulary: string[]): Promise<RecheckResult> {
  return call<RecheckResult>('recheck-captions', { profile: profileId(), phrases, vocabulary })
}

/** The caption Claude would write for a video he posts by hand, from the
 *  campaign's rules, stills from the video and anything he says it is
 *  about - for him to read and change before it goes. */
export async function writeCaptionFor(
  campaign: { id: string; name: string; posting: CampaignPosting },
  about: string,
  stills: string[] = [],
): Promise<{ caption: string; error: string | null }> {
  const written = await call<{ caption: string; error: string | null }>('write-caption', { profile: profileId(), campaign, about, stills })
  return { caption: written.caption ?? '', error: written.error ?? null }
}

// --- Sending a video (outbox.ts) --------------------------------------------

export interface Started {
  id: string
  partBytes: number
  uploads: { part: number; url: string }[]
  status: PostStatus
}

export async function startSend(body: {
  profile: string
  key: string
  size: number
  campaign: { id: string; name: string; posting: CampaignPosting }
  meta: Record<string, unknown>
}): Promise<Started> {
  return call<Started>('start', body)
}

export async function finishSend(profile: string, key: string): Promise<{ id: string; status?: PostStatus; missing?: number[] }> {
  return call('sent', { profile, key })
}

/** Puts one part where the server said. */
export async function putPart(url: string, part: Blob): Promise<void> {
  const form = new FormData()
  form.append('cacheControl', '3600')
  form.append('', part)
  let response: Response
  try {
    response = await fetch(url, { method: 'PUT', body: form, headers: { apikey: PUBLISHABLE_KEY, 'x-upsert': 'true' } })
  } catch {
    throw new PostingError('No connection. It goes when there is signal.', true)
  }
  if (!response.ok) throw new PostingError(`A part of the video could not be sent (${response.status}).`, true)
}

// --- Notifications ------------------------------------------------------------

export async function savePushSubscription(subscription: PushSubscriptionJSON): Promise<void> {
  await call('push', { profile: profileId(), subscription })
}

// --- Words --------------------------------------------------------------------

const PLATFORMS: Record<string, string> = {
  tiktok: 'TikTok',
  'tiktok-business': 'TikTok',
  instagram: 'Instagram',
  'instagram-standalone': 'Instagram',
  youtube: 'YouTube',
  facebook: 'Facebook',
  x: 'X',
  threads: 'Threads',
  linkedin: 'LinkedIn',
  'linkedin-page': 'LinkedIn',
}

export function platformName(platform: string): string {
  return PLATFORMS[platform] ?? platform.charAt(0).toUpperCase() + platform.slice(1)
}

/** The account's username without a leading @, or '' when it has none. */
export function handleOf(account: { profile?: string }): string {
  return (account.profile ?? '').trim().replace(/^@+/, '')
}

/** "@kari.ugc · TikTok (Kari)" - the username first, because accounts often
 *  share a name and the username is what tells them apart; the name follows
 *  when it adds anything. With no username it is "Kari · TikTok". */
export function accountLabel(account: { name: string; platform: string; profile?: string }): string {
  const handle = handleOf(account)
  const on = platformName(account.platform)
  if (!handle) return `${account.name} · ${on}`
  const same = handle.toLowerCase() === account.name.trim().replace(/^@+/, '').toLowerCase()
  return `@${handle} · ${on}${same || !account.name.trim() ? '' : ` (${account.name.trim()})`}`
}

/** "Today 6:04 PM", "Tomorrow 9:03 AM", "Mon 9:03 AM" - in the phone's time. */
export function whenLabel(iso: string | null, now = new Date()): string {
  if (!iso) return 'As soon as it goes'
  const at = new Date(iso)
  const time = at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((day(at) - day(now)) / 86_400_000)
  if (days === 0) return `Today ${time}`
  if (days === 1) return `Tomorrow ${time}`
  if (days === -1) return `Yesterday ${time}`
  return `${at.toLocaleDateString(undefined, { weekday: 'short', month: days > 6 || days < -6 ? 'short' : undefined, day: days > 6 || days < -6 ? 'numeric' : undefined })} ${time}`
}

/** "2026-09-28T18:04" for a datetime-local box, in the phone's time - an
 *  hour from now when there is no time yet. */
export function localInput(iso: string | null): string {
  const at = iso ? new Date(iso) : new Date(Date.now() + 60 * 60 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`
}

/** "18:00" as "6 PM", "18:30" as "6:30 PM". */
export function timeLabel(time: string): string {
  const [h, m] = time.split(':').map(Number)
  const hour = h % 12 === 0 ? 12 : h % 12
  return `${hour}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`
}
