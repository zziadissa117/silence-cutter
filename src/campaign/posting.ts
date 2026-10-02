// Posting finished videos to Postiz, from the phone's side: this person's
// posting profile, and the calls to the postiz function that does the
// posting (supabase/functions/postiz). Postiz itself is never called from
// here - it refuses web pages, and the keys stay on the server.
//
// Each person posts to their own Postiz. He and his friend share one login
// and the same campaigns, but the accounts a campaign posts to and the times
// it posts at are each person's own, kept in their profile on the server.
// The phone keeps only which profile is its own, and whether it sends.

import { PUBLISHABLE_KEY, currentSession } from './cloud'
import type { Campaign, CampaignPosting } from './look'

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

/** Where and when one campaign posts, for one person. */
export interface CampaignPlace {
  accounts: string[]
  times: string[]
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
  settings: { campaigns?: Record<string, CampaignPlace>; limits?: Limits }
  timezone: string
  hasAnthropic: boolean
  vapidPublic: string | null
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
  postAt: string | null
  /** `held`: paused or at its day's limit - not scheduled yet, and goes out by itself when free. */
  accounts: { id: string; name: string; platform: string; held?: 'paused' | 'cap' }[]
  /** Postiz's own copy of the video, for when this phone has none. */
  videoUrl: string | null
  links: Record<string, string>
  error: string | null
  retryAt: string | null
  createdAt: string
  /** Made by hand from New post. */
  byHand?: boolean
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
  let response: Response
  try {
    response = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: PUBLISHABLE_KEY },
      body: JSON.stringify({ action, token: session.token, ...body }),
    })
  } catch {
    throw new PostingError('No connection. It goes when there is signal.', true)
  }
  const json = (await response.json().catch(() => ({}))) as T & { error?: string; later?: boolean }
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

export async function refreshProfile(): Promise<Profile> {
  return remember(await call<Profile>('profile', { profile: profileId() }))
}

export async function refreshAccounts(): Promise<Profile> {
  return remember(await call<Profile>('accounts', { profile: profileId() }))
}

export async function saveCampaignPlace(campaignId: string, place: CampaignPlace): Promise<Profile> {
  return remember(await call<Profile>('save-campaign', { profile: profileId(), campaignId, ...place }))
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
  return { accounts: place?.accounts ?? [], times: place?.times ?? [] }
}

/** Whether this phone sends this campaign's finished videos to Postiz. */
export function sendsFrom(campaign: Campaign, local: LocalPosting | null = postingHere()): boolean {
  return Boolean(local?.sendHere) && placeFor(local!.profile, campaign.id).accounts.length > 0
}

// --- Posts ------------------------------------------------------------------

const POSTS_KEY = 'cutter.posts'

/** The posts as last seen, for opening the screen with no signal. */
export function lastPosts(): ServerPost[] {
  try {
    return JSON.parse(localStorage.getItem(POSTS_KEY) ?? '[]') as ServerPost[]
  } catch {
    return []
  }
}

export async function listPosts(): Promise<ServerPost[]> {
  const { posts } = await call<{ posts: ServerPost[] }>('posts', { profile: profileId() })
  try {
    localStorage.setItem(POSTS_KEY, JSON.stringify(posts))
  } catch {
    // Just won't be there offline.
  }
  return posts
}

export type PostAction = 'edit' | 'approve' | 'reject' | 'unschedule' | 'retry'

export async function postAction(
  action: PostAction,
  id: string,
  fields: { caption?: string; title?: string; at?: string } = {},
): Promise<ServerPost> {
  const { post } = await call<{ post: ServerPost }>(action, { profile: profileId(), id, ...fields })
  return post
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

/** "fake.tiktok (TikTok)" - which account, on what. */
export function accountLabel(account: { name: string; platform: string }): string {
  return `${account.name} · ${platformName(account.platform)}`
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
