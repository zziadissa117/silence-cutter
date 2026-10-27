// Posting the silence cutter's finished campaign videos to Postiz.
//
// A finished video comes up from the phone in parts, gets a caption Claude
// writes from what he says in it (held to the campaign's rules - never an
// ad, the brand's hashtags always in), goes to Postiz, and waits for him on
// the cutter's Posts screen - or, for a campaign that posts straight away,
// is scheduled there and then. The time is the campaign's next free time of
// day in his timezone - or, on a day he uploads late or has more videos than
// times, a place in that evening's even spread until midnight (slots.ts).
//
// Everything that talks to Postiz or Claude happens here, not on the phone:
// Postiz refuses calls from a web page, and the keys stay on the server.
// Each person posts to their own Postiz, so the keys, accounts and times
// belong to a posting profile (found again by pasting the same Postiz key),
// inside the shared login that holds the campaigns.
//
// Nothing a network hiccup can break is left to chance: every step records
// what it did, a post is only ever moved along by one run at a time, and a
// scheduler (pg_cron, every few minutes) picks up whatever is due - a retry
// after Postiz said "too many requests", a post that should have gone out,
// a Pump.fun reminder.
//
// Actions, all POST with a JSON body and the shared login's token:
//   connect        { postizKey, anthropicKey?, timezone? } -> profile
//   profile        { profile }                  -> profile
//   accounts       { profile }                  -> profile (accounts listed again)
//   save-campaign  { profile, campaignId, accounts, times, window? } -> profile
//                  window { from, to, perDay }: random times each day for a campaign with no times of its own (window.ts)
//   save-limits    { profile, limits }          -> profile   (pause / posts-a-day, per platform and per account: limits.ts)
//   attach-accounts { profile, campaignId, accounts } -> { added, scheduled, left }
//                  videos already made for the campaign get an account linked later
//   push           { profile, subscription }    -> { ok }
//   unpush         { endpoint }                 -> { ok }
//   start          { profile, key, campaign, meta, size } -> { id, partBytes, uploads }
//                  meta.batch { id, date, time, size }: its day and time; with meta.scheduled (Formats), no approval
//   sent           { profile, key }             -> { id, status } or { missing }
//   posts          { profile }                  -> { posts }
//   edit / approve / ready { profile, id, caption?, title?, at? } -> { post }   ready: approved, held until he taps Post (approve)
//   reject / unschedule / retry { profile, id } -> { post }
//   recaption      { profile, campaignId, posting, ids?, mode? } -> { rewriting, tooSoon }  missing hashtags added (mode 'hashtags', the default) or captions rewritten ('rewrite'), in the background;
//   stop-campaign  { profile, campaignId }   -> { stopped, unposting }  every post of one campaign not out yet, rejected at once;
//                  the ones Postiz holds are taken out of it in the background (and on each tick)
//   stop-posts     { profile, ids }          -> { stopped, unposting }  the same, for the posts he ticked
//   end-campaign   { profile, campaignId, names, confirm? }  without confirm -> { plan, stopping, connected }: what
//                  would come out of Postiz; with confirm (the account ids he saw) -> { stopped, removing, profile }:
//                  its posts stopped, those accounts unticked, then deleted from Postiz in the background (and on
//                  each tick) once its posts are out of Postiz - the result lands in settings.ended
//   backup         { profile, bufferKey?, removeKeys?, active? } -> profile   Buffer as a backup for Postiz
//                  (buffer.ts): a key pasted, the keys taken out, or "Postiz is down" switched on or off
//   views          { profile }                  -> { accounts: { [accountId]: AccountViews } }  how each account's
//                  videos are doing (views.ts), read from Postiz one account per tick, about once a day each
//   tick           { secret }                   (the scheduler; no token)
//   channels       { cutterCampaignId }         (the planner's server; no token - see bridgeAllowed)
//                  -> { profiles: [{ id, inUse, accounts }] }  which Postiz channels a campaign holds
// and GET /postiz/video/<id>.mp4?e=&s= - the video, for Postiz to fetch.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Anthropic from 'npm:@anthropic-ai/sdk@0.128.0'
import webpush from 'npm:web-push@3.6.7'

import {
  CAPTION_SCHEMA,
  CAPTION_SYSTEM,
  captionRequest,
  finishCaption,
  finishTitle,
  normalTag,
  type PostingRules,
} from './caption.ts'
import { RECHECK_SCHEMA, RECHECK_SYSTEM, acceptFix, costCents } from './recheck.ts'
import { accountName, failedRefs, notPostedNote } from './failed.ts'
import { carryOver, cleanCaptions, cleanRepost, repostDueAt, textFor, variationNote, type AccountText } from './repost.ts'
import { FAKE_CLAUDE, FakeError, fakeCaption, fakePostiz, isFakePostiz } from './fake.ts'
import { approvalFor, batchChoices, batchInfo, batchReady, type BatchInfo } from './batch.ts'
import { handFields } from './hand.ts'
import { lastTimeToday, nextSlot, normalTimes, pickTime, sessionOf, spreadDay, spreadEnd, spreadUntil, timesFor, type OtherPost, type Spread, addDays, localDate, localTime, zoned } from './slots.ts'
import { cleanWindow, type PostingWindow } from './window.ts'
import { planRespread, type RespreadRow } from './respread.ts'
import { cleanPlace, instagramPlace, type Place } from './place.ts'
import { attachMove, summarise, type AttachMove } from './attach.ts'
import { cleanMode, pickRecaption, recaptionMode } from './recaption.ts'
import { cleanLimits, firstDayWithRoom, heldNote, releasable, split, usedOn, type Limits, type PostAccount } from './limits.ts'
import { PENDING_STATUSES, channelReport, endPlan, isPending, splitStop, type EndPost, type Integration, type PendingPost } from './channels.ts'
import { VIEWS_WINDOW_DAYS, dueAt, fillPerVideo, notRead, parseCache, readViews, remember, type ViewsCache } from './views.ts'
import { POST_VIEW_AGES_H, POST_VIEW_MAX_DAYS, accountNameFor, postViewCount, postViewsDue } from './postViews.ts'
import {
  BUFFER_QUEUE,
  HAND_AHEAD_MS,
  MISSED_MS,
  createPost as createBufferPost,
  deletePost as deleteBufferPost,
  handOverPlan,
  isFull,
  listChannels,
  matchChannels,
  readPost as readBufferPost,
  roomLeft,
  type BufferChannel,
  type BufferRef,
} from './buffer.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
/** Where Postiz fetches the video from - the public address, whatever the
 *  runtime calls itself inside. */
const PUBLIC_URL = 'https://uykuoibqdxmpbbrsmyad.supabase.co/functions/v1/postiz'
const APP_URL = 'https://silence-cutter.netlify.app'
const BUCKET = 'postiz-outbox'
const POSTIZ = 'https://api.postiz.com/public/v1'
const MODEL = 'claude-opus-5'

/** Small enough that a dropped connection costs one part, not the video. */
const PART_BYTES = 8 * 1024 * 1024
const MAX_BYTES = 2 * 1024 * 1024 * 1024
/** Tries before a post that keeps failing on its own is left for him. */
const MAX_ATTEMPTS = 6
/** After MAX_ATTEMPTS quick tries, how many half-hourly ones an approved post
 *  gets for a passing problem before it comes back to him: about a day. */
const LATER_GIVE_UP = MAX_ATTEMPTS + 48
const MINUTE = 60_000

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, HEAD, OPTIONS',
}

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** A failure worth saying in plain words; `later` means try again by itself. */
class Problem extends Error {
  later: boolean
  status: number
  constructor(message: string, later = false, status = 400) {
    super(message)
    this.later = later
    this.status = status
  }
}

/** Postiz itself failing - down, refusing, unreachable: where a Buffer
 *  backup takes over (buffer.ts). */
class PostizProblem extends Problem {}

/** Not asked of Postiz at all: this hour's share of its requests is used, or
 *  it said "too many" a moment ago (postizAllowance). Waiting it out is no
 *  failed try - it never counts towards giving up on a post. */
class PostizWait extends PostizProblem {
  /** When Postiz can be asked again. */
  until: number
  /** Only batch videos' share used up: his own posts can still go. */
  batchOnly: boolean
  constructor(until: number, batchOnly = false) {
    super('Postiz says too many requests right now.', true, 429)
    this.until = until
    this.batchOnly = batchOnly
  }
}

// --- The shared login ---------------------------------------------------------
//
// The same token the cutter function hands out (supabase/functions/cutter),
// checked the same way: signed with the service key, naming the login and a
// piece of its password hash.

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromB64url(text: string): Uint8Array {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4)
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))
}

function hex(bytes: ArrayBuffer | Uint8Array): string {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('')
}

async function hmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(SERVICE_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

async function spaceFor(token: unknown): Promise<string | null> {
  if (typeof token !== 'string' || !token.includes('.')) return null
  const [payload, signature] = token.split('.')
  try {
    const valid = await crypto.subtle.verify('HMAC', await hmacKey(), fromB64url(signature), encoder.encode(payload))
    if (!valid) return null
    const { s, p } = JSON.parse(decoder.decode(fromB64url(payload))) as { s: string; p: string }
    const { data } = await db.from('cutter_spaces').select('id, pass_hash').eq('id', s).maybeSingle()
    return data && data.pass_hash.startsWith(p) ? data.id : null
  } catch {
    return null
  }
}

// --- Keys ---------------------------------------------------------------------

async function sha256(text: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', encoder.encode(text)))
}

let sealingKey: Promise<CryptoKey> | null = null
function sealKey(): Promise<CryptoKey> {
  sealingKey ??= crypto.subtle
    .digest('SHA-256', encoder.encode(`${SERVICE_KEY}:cutter-profile-secrets`))
    .then((raw) => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']))
  return sealingKey
}

/** Encrypted, so the keys are unreadable in the table itself. */
async function seal(text: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await sealKey(), encoder.encode(text)))
  const out = new Uint8Array(iv.length + sealed.length)
  out.set(iv)
  out.set(sealed, iv.length)
  return b64url(out)
}

async function unseal(text: string): Promise<string> {
  const bytes = fromB64url(text)
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, await sealKey(), bytes.slice(12))
  return decoder.decode(plain)
}

async function keysFor(profileId: string): Promise<{ postiz: string; anthropic: string | null }> {
  const { data } = await db.from('cutter_profile_secrets').select('*').eq('profile_id', profileId).maybeSingle()
  if (!data) throw new Problem('Your Postiz key is missing - paste it again in Settings, Posting.')
  return { postiz: await unseal(data.postiz_key), anthropic: data.anthropic_key ? await unseal(data.anthropic_key) : null }
}

// --- Postiz -------------------------------------------------------------------

interface Account {
  id: string
  name: string
  platform: string
  profile: string
  picture: string
  disabled: boolean
}

interface Media {
  id: string
  path: string
}

// --- Postiz's hourly allowance ---------------------------------------------------
//
// Postiz lets an account make 30 requests an hour (its docs), and counts the
// ones it turns away too. On 2026-10-26 the scheduler's reads (what went out,
// views) and its own retries, every 5 minutes, kept two accounts at "too many
// requests" for hours, while hundreds of videos waited to be put back in.
// So every request is counted here, per Postiz key, by the hour: reads may use
// only part of it, the rest is kept for putting videos in and taking them out;
// and after Postiz says "too many", nothing is asked of it until the hour is
// out - a refused question would only push that further away.

const POSTIZ_PER_HOUR = 30
/** What reads may use of the hour: the rest is for posting. */
const POSTIZ_READS = 12
/** What batch videos may use of the hour: the rest is kept for his own posts
 *  - "now I can't even post anything anymore" (2026-10-27), with a night's
 *  batch videos going in. */
const POSTIZ_BATCH = 20
type PostizNeed = 'post' | 'read' | 'batch'

/** What a post's Postiz requests count as. */
const needOf = (post: Pick<Post, 'batch'>): PostizNeed => (post.batch ? 'batch' : 'post')
interface PostizUse {
  since: number
  used: number
  busyUntil: number
}

async function useKeyOf(key: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key)))
  return `postiz-use:${Array.from(digest.slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('')}`
}

async function readUse(id: string, now: number): Promise<PostizUse> {
  const { data } = await db.from('cutter_config').select('value').eq('key', id).maybeSingle()
  let use: PostizUse = { since: now, used: 0, busyUntil: 0 }
  try {
    const saved = JSON.parse((data as { value: string } | null)?.value ?? 'null') as Partial<PostizUse> | null
    if (saved) use = { since: Number(saved.since) || now, used: Number(saved.used) || 0, busyUntil: Number(saved.busyUntil) || 0 }
  } catch {
    // Counted afresh.
  }
  return now - use.since >= 60 * MINUTE ? { since: now, used: 0, busyUntil: use.busyUntil } : use
}

async function saveUse(id: string, use: PostizUse): Promise<void> {
  await db.from('cutter_config').upsert({ key: id, value: JSON.stringify(use) }, { onConflict: 'key' })
}

/** Takes one of the hour's requests for `need`, or throws PostizWait. Should
 *  the counting itself fail, Postiz is asked anyway: posting never waits on it. */
async function postizAllowance(key: string, need: PostizNeed): Promise<{ id: string; use: PostizUse } | null> {
  try {
    const id = await useKeyOf(key)
    const now = Date.now()
    const use = await readUse(id, now)
    const busy = now < use.busyUntil
    const most = need === 'read' ? POSTIZ_READS : need === 'batch' ? POSTIZ_BATCH : POSTIZ_PER_HOUR - 2
    if (busy || use.used >= most) {
      // The tick stops asking for this login (failed sets postizBusy). Reads
      // or batch videos running out leaves his own posts their share.
      throw new PostizWait(busy ? use.busyUntil : use.since + 60 * MINUTE, !busy && need === 'batch' && use.used < POSTIZ_PER_HOUR - 2)
    }
    const spent = { ...use, used: use.used + 1 }
    await saveUse(id, spent)
    return { id, use: spent }
  } catch (error) {
    if (error instanceof PostizWait) throw error
    return null
  }
}

async function postiz<T>(key: string, method: string, path: string, body?: unknown, need: PostizNeed = 'post'): Promise<T> {
  if (isFakePostiz(key)) {
    try {
      return (await fakePostiz(db, key, method, path, body)) as T
    } catch (error) {
      if (error instanceof FakeError) postizFailure(error.status, error.message)
      throw error
    }
  }
  const allowance = await postizAllowance(key, need)
  let response: Response
  try {
    response = await fetch(`${POSTIZ}${path}`, {
      method,
      headers: { Authorization: key, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(5 * MINUTE),
    })
  } catch (error) {
    throw new PostizProblem(`Postiz could not be reached (${error instanceof Error ? error.message : String(error)}).`, true)
  }
  const text = await response.text()
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  if (response.ok) return json as T
  if (response.status === 429 && allowance) {
    // Nothing more this hour - at least a quarter of an hour.
    const until = Math.max(Date.now() + 15 * MINUTE, allowance.use.since + 60 * MINUTE)
    await saveUse(allowance.id, { ...allowance.use, used: POSTIZ_PER_HOUR, busyUntil: until }).catch(() => {})
  }
  postizFailure(response.status, postizMessage(json) ?? text.slice(0, 300))
}

/** Until when each login's Postiz has said "too many requests" (it counts by
 *  the hour): nothing more of that login's is tried before then in this run -
 *  every try would only be turned away (tick, respreadBatches). By login: one
 *  whose hour is used up held up every other's posts too (2026-10-26). */
const postizBusy = new Map<string, number>()

/** Whether this login's Postiz is busy for this post: its batch videos wait
 *  while their share is used up, his own posts only once all of it is. */
function postizBusyFor(profileId: string, batch = true): boolean {
  const until = Math.max(postizBusy.get(profileId) ?? 0, batch ? (postizBusy.get(`${profileId}|batch`) ?? 0) : 0)
  return Date.now() < until
}

function postizFailure(status: number, said: string): never {
  if (/unsupported file type/i.test(said)) {
    throw new PostizProblem('Postiz only takes MP4 videos and this one is another format. Remove it and post it again - the app now turns it into an MP4 first.')
  }
  if (status === 401 || status === 403) {
    throw new PostizProblem("Postiz didn't accept your key - paste it again in Settings, Posting.", false, 401)
  }
  if (status === 429) throw new PostizProblem('Postiz says too many requests right now.', true, 429)
  if (status >= 500) throw new PostizProblem(`Postiz had a problem (${status}${said ? `: ${said}` : ''}).`, true, 502)
  throw new PostizProblem(`Postiz said: ${said || status}`, false, 400)
}

function postizMessage(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null
  const message = (json as { message?: unknown }).message
  if (Array.isArray(message)) return message.map(String).join('; ')
  return typeof message === 'string' ? message : null
}

async function listAccounts(key: string): Promise<Account[]> {
  const list = await postiz<Record<string, unknown>[]>(key, 'GET', '/integrations')
  return (Array.isArray(list) ? list : []).map((i) => ({
    id: String(i.id),
    name: String(i.name ?? ''),
    platform: String(i.identifier ?? ''),
    profile: String(i.profile ?? ''),
    picture: String(i.picture ?? ''),
    disabled: Boolean(i.disabled),
  }))
}

/** Each platform's settings. Nothing is ever marked as branded or paid -
 *  his rule, whatever the campaign. */
/** What Postiz is told for one account. `place`: the Instagram place its
 *  posts are tagged with (place.ts) - kept by Postiz, which doesn't hand it
 *  to Instagram yet. */
function settingsFor(platform: string, title: string, place: Place | null = null): Record<string, unknown> {
  switch (platform) {
    // A TikTok Business account takes TikTok's own settings, under its name.
    case 'tiktok':
    case 'tiktok-business':
      return {
        __type: platform,
        privacy_level: 'PUBLIC_TO_EVERYONE',
        duet: true,
        stitch: true,
        comment: true,
        autoAddMusic: 'no',
        brand_content_toggle: false,
        brand_organic_toggle: false,
        video_made_with_ai: false,
        content_posting_method: 'DIRECT_POST',
      }
    case 'youtube':
      return { __type: 'youtube', title, type: 'public', selfDeclaredMadeForKids: 'no', tags: [] }
    case 'instagram':
    case 'instagram-standalone':
      return { __type: platform, post_type: 'post', is_trial_reel: false, collaborators: [], ...(place ? { location_id: place.id } : {}) }
    case 'facebook':
      return { __type: 'facebook', post_type: 'post' }
    default:
      return { __type: platform }
  }
}

// --- Rows ---------------------------------------------------------------------

interface Profile {
  id: string
  space_id: string
  accounts: Account[]
  accounts_at: string | null
  settings: {
    campaigns?: Record<string, { accounts?: string[]; times?: string[]; window?: PostingWindow; instagramPlace?: Place }>
    /** The place every Instagram post is tagged with, unless its campaign has its own (place.ts). */
    instagramPlace?: Place
    limits?: Limits
    /** Campaigns being ended: the accounts still to delete from Postiz. */
    ending?: Record<string, EndingJob>
    /** What ending each campaign did, for its page. */
    ended?: Record<string, EndedResult>
    /** Buffer as a backup (buffer.ts): its channels as last read - never the
     *  keys, which are sealed with the Postiz key. */
    backup?: BackupSettings
  }
  timezone: string
}

interface BackupSettings {
  keys: number
  channels: BufferChannel[]
  /** "Postiz is down": what Postiz holds on backed-up accounts goes through Buffer (handOver). */
  active: boolean
  checkedAt: string
  problem: string | null
}

interface EndingJob {
  accounts: string[]
  names: Record<string, string>
  at: string
  attempts?: number
}

interface EndedAccount {
  name: string
  platform: string
  profile: string
}

interface EndedResult {
  at: string
  removed: EndedAccount[]
  kept: (EndedAccount & { why: string })[]
  failed: (EndedAccount & { error: string })[]
}

interface Post {
  id: string
  profile_id: string
  client_key: string
  campaign_id: string
  campaign_name: string
  rules: PostingRules
  status: string
  parts: number
  size: number
  file_name: string | null
  transcript: string | null
  headline: string | null
  duration: number | null
  caption: string | null
  title: string | null
  slot: string | null
  post_at: string | null
  /** Its time is a place in the day's spread, not one of the campaign's own. */
  spread: Spread | null
  /** Made for the next days: never spread into today. */
  later: boolean
  /** Made by hand from New post: a finished video sent as it is, at the time
   *  he picked or straight away, never approved again and never on one of
   *  the campaign's times. */
  by_hand: boolean
  /** Approved with "post later": waits for him to tap Post. */
  ready_at: string | null
  /** What he said it is about, for its caption. */
  about: string | null
  /** Made in a batch from the Batch tab, for a day and one of its times. */
  batch: BatchInfo | null
  /** He has had the one notification for its batch. */
  batch_told: boolean
  accounts: PostAccount[]
  /** Per-account caption/title overrides, by account id. */
  captions: Record<string, AccountText> | null
  repost_of: string | null
  repost_at: string | null
  reposted_at: string | null
  media: Media | null
  postiz_ids: { postId: string; integration: string }[] | null
  /** The accounts it went to through Buffer instead of Postiz, by account id. */
  buffer_ids: Record<string, BufferRef> | null
  release_urls: Record<string, string> | null
  /** Views by account name, read a few times after it went out (postViews.ts). */
  views: Record<string, number> | null
  views_at: string | null
  creating_at: string | null
  error: string | null
  attempts: number
  retry_at: string | null
  checked_at: string | null
  checks: number
  reminded_at: string | null
  working_at: string | null
  created_at: string
  updated_at: string
}

async function profileFor(spaceId: string, profileId: unknown): Promise<Profile> {
  if (typeof profileId !== 'string' || !/^[0-9a-f-]{36}$/.test(profileId)) throw new Problem('no-profile', false, 404)
  const { data } = await db.from('cutter_profiles').select('*').eq('id', profileId).eq('space_id', spaceId).maybeSingle()
  if (!data) throw new Problem('no-profile', false, 404)
  return data as Profile
}

async function profileView(profile: Profile) {
  const [{ data: secret }, { data: vapid }] = await Promise.all([
    db.from('cutter_profile_secrets').select('anthropic_key').eq('profile_id', profile.id).maybeSingle(),
    db.from('cutter_config').select('value').eq('key', 'vapid_public').maybeSingle(),
  ])
  return {
    id: profile.id,
    accounts: profile.accounts,
    settings: profile.settings,
    timezone: profile.timezone,
    hasAnthropic: Boolean(secret?.anthropic_key),
    vapidPublic: vapid?.value ?? null,
    // Buffer, the backup: its channels and the accounts it backs up - never the keys.
    backup: profile.settings.backup
      ? {
          keys: profile.settings.backup.keys,
          active: profile.settings.backup.active,
          problem: profile.settings.backup.problem,
          checkedAt: profile.settings.backup.checkedAt,
          channels: profile.settings.backup.channels.map((c) => ({ name: c.name || c.displayName, service: c.service })),
          matched: Object.fromEntries(Object.entries(backupFor(profile)).map(([id, c]) => [id, c.name || c.displayName])),
        }
      : null,
  }
}

/** Like update, but only while the post is still in `status` - null when it
 *  moved on meanwhile (he stopped it, took it back). */
async function updateIf(id: string, status: Post['status'], fields: Partial<Post>): Promise<Post | null> {
  const { data, error } = await db
    .from('cutter_posts')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', status)
    .select('*')
    .maybeSingle()
  if (error) throw new Problem(`The post could not be saved (${error.message}).`, true)
  return (data as Post | null) ?? null
}

async function update(id: string, fields: Partial<Post>): Promise<Post> {
  const { data, error } = await db
    .from('cutter_posts')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single()
  if (error || !data) throw new Problem(`The post could not be saved (${error?.message ?? 'gone'}).`, true)
  return data as Post
}

/** What the phone is shown: never the keys, never the parts. */
function postView(post: Post) {
  return {
    id: post.id,
    key: post.client_key,
    campaignId: post.campaign_id,
    campaignName: post.campaign_name,
    approval: post.rules.approval,
    captionBy: post.rules.caption,
    remind: post.rules.remind,
    status: post.status,
    fileName: post.file_name,
    headline: post.headline,
    caption: post.caption,
    title: post.title,
    captions: post.captions ?? {},
    repost: post.repost_of !== null,
    // Told to repost it in the last few days: show "Time to repost".
    repostDue: Boolean(post.reposted_at && post.status === 'posted' && Date.now() - new Date(post.reposted_at).getTime() < 3 * 24 * 60 * 60 * 1000),
    postAt: post.post_at,
    accounts: post.accounts,
    videoUrl: post.media?.path ?? null,
    links: post.release_urls ?? {},
    /** The account ids it went to through Buffer instead of Postiz. */
    viaBuffer: Object.keys(post.buffer_ids ?? {}),
    error: post.error,
    retryAt: post.retry_at,
    createdAt: post.created_at,
    byHand: post.by_hand,
    ready: Boolean(post.ready_at),
    batch: post.batch ? { id: post.batch.id, date: post.batch.date, time: post.batch.time, size: post.batch.size, ...(post.batch.look ? { look: post.batch.look } : {}) } : null,
    ...(post.views ? { views: post.views } : {}),
  }
}

// --- Profiles -------------------------------------------------------------------

async function connect(spaceId: string, body: Record<string, unknown>): Promise<Response> {
  const postizKey = typeof body.postizKey === 'string' ? body.postizKey.trim() : ''
  const anthropicKey = typeof body.anthropicKey === 'string' ? body.anthropicKey.trim() : ''
  const timezone =
    typeof body.timezone === 'string' && body.timezone.length < 64 && isTimezone(body.timezone) ? body.timezone : 'America/Toronto'
  if (!postizKey) throw new Problem('Paste your Postiz API key.')
  let accounts: Account[]
  try {
    accounts = await listAccounts(postizKey)
  } catch (error) {
    if (error instanceof Problem && error.status === 401) {
      throw new Problem("That Postiz key didn't work. In Postiz, open Settings, then Public API, and copy the key again.")
    }
    throw error
  }
  if (anthropicKey) await checkAnthropicKey(anthropicKey)

  const keyHash = await sha256(postizKey)
  const { data: existing } = await db.from('cutter_profiles').select('*').eq('space_id', spaceId).eq('key_hash', keyHash).maybeSingle()
  let profile = existing as Profile | null
  const now = new Date().toISOString()
  if (profile) {
    const { data } = await db
      .from('cutter_profiles')
      .update({ accounts, accounts_at: now, timezone, updated_at: now })
      .eq('id', profile.id)
      .select('*')
      .single()
    profile = data as Profile
  } else {
    if (!anthropicKey) throw new Problem('Paste your Anthropic API key too - Claude writes the captions with it.')
    const { data, error } = await db
      .from('cutter_profiles')
      .insert({ space_id: spaceId, key_hash: keyHash, accounts, accounts_at: now, timezone })
      .select('*')
      .single()
    if (error || !data) throw new Problem('Your posting could not be set up. Try again.', true, 500)
    profile = data as Profile
  }
  const { data: secret } = await db.from('cutter_profile_secrets').select('anthropic_key').eq('profile_id', profile.id).maybeSingle()
  if (!anthropicKey && !secret?.anthropic_key) {
    throw new Problem('Paste your Anthropic API key too - Claude writes the captions with it.')
  }
  const { error } = await db.from('cutter_profile_secrets').upsert({
    profile_id: profile.id,
    postiz_key: await seal(postizKey),
    anthropic_key: anthropicKey ? await seal(anthropicKey) : secret!.anthropic_key,
    updated_at: now,
  })
  if (error) throw new Problem('Your keys could not be saved. Try again.', true, 500)
  return reply(await profileView(profile))
}

function isTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

async function checkAnthropicKey(apiKey: string): Promise<void> {
  if (apiKey === FAKE_CLAUDE) return
  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 30_000 })
  try {
    await client.models.retrieve(MODEL)
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
      throw new Problem("That Anthropic key didn't work. Copy it again from console.anthropic.com, API keys.")
    }
    if (error instanceof Anthropic.NotFoundError) {
      throw new Problem(`That Anthropic key can't use ${MODEL}.`)
    }
    throw new Problem(`Anthropic could not be reached to check the key (${error instanceof Error ? error.message : String(error)}). Try again.`, true)
  }
}

async function refreshAccounts(profile: Profile): Promise<Profile> {
  const { postiz: key } = await keysFor(profile.id)
  const accounts = await listAccounts(key)
  const { data } = await db
    .from('cutter_profiles')
    .update({ accounts, accounts_at: new Date().toISOString() })
    .eq('id', profile.id)
    .select('*')
    .single()
  return data as Profile
}

async function saveCampaign(profile: Profile, body: Record<string, unknown>): Promise<Response> {
  const campaignId = typeof body.campaignId === 'string' ? body.campaignId : ''
  if (!campaignId || campaignId.length > 200) throw new Problem('Which campaign?')
  const known = new Set(profile.accounts.map((a) => a.id))
  const accounts = (Array.isArray(body.accounts) ? body.accounts : []).filter((a): a is string => typeof a === 'string' && known.has(a))
  const times = normalTimes((Array.isArray(body.times) ? body.times : []).filter((t): t is string => typeof t === 'string'))
  // A window is kept only beside no times of his own: his own times win,
  // and keeping both would leave a window that silently does nothing.
  const window = times.length === 0 ? cleanWindow(body.window) : null
  // Its own Instagram place, over the default (place.ts).
  const ownPlace = cleanPlace(body.instagramPlace)
  const campaigns = { ...(profile.settings.campaigns ?? {}) }
  if (accounts.length === 0 && times.length === 0 && !window && !ownPlace) delete campaigns[campaignId]
  else campaigns[campaignId] = { accounts, times, ...(window ? { window } : {}), ...(ownPlace ? { instagramPlace: ownPlace } : {}) }
  const { data, error } = await db
    .from('cutter_profiles')
    .update({ settings: { ...profile.settings, campaigns }, updated_at: new Date().toISOString() })
    .eq('id', profile.id)
    .select('*')
    .single()
  if (error || !data) throw new Problem('It could not be saved. Try again.', true, 500)
  return reply(await profileView(data as Profile))
}

/** The place every Instagram post is tagged with (place.ts), or none. */
async function savePlace(profile: Profile, body: Record<string, unknown>): Promise<Response> {
  const place = cleanPlace(body.place)
  const { instagramPlace: _old, ...rest } = profile.settings
  const { data, error } = await db
    .from('cutter_profiles')
    .update({ settings: place ? { ...rest, instagramPlace: place } : rest, updated_at: new Date().toISOString() })
    .eq('id', profile.id)
    .select('*')
    .single()
  if (error || !data) throw new Problem('It could not be saved. Try again.', true, 500)
  return reply(await profileView(data as Profile))
}

/** Pause / posts-a-day limits, per platform and per account (limits.ts). Saved
 *  whole; a held account is let go by the scheduler on its next pass, so
 *  unpausing needs nothing else. */
async function saveLimits(profile: Profile, body: Record<string, unknown>): Promise<Response> {
  const limits = cleanLimits(body.limits)
  const { data, error } = await db
    .from('cutter_profiles')
    .update({ settings: { ...profile.settings, limits }, updated_at: new Date().toISOString() })
    .eq('id', profile.id)
    .select('*')
    .single()
  if (error || !data) throw new Problem('It could not be saved. Try again.', true, 500)
  return reply(await profileView(data as Profile))
}

/** Lets held accounts go: scheduled or posted videos with an account that was
 *  paused or full, which is now free. Each gets its own Postiz post from the
 *  same video and caption - at the video's own time of day on the first day it
 *  has room, or in a few minutes when that has passed. Nothing held is ever
 *  dropped; the others the video already went to are not touched. */
async function releaseHeld(now: number): Promise<void> {
  const { data } = await db
    .from('cutter_posts')
    .select('*')
    .in('status', ['scheduled', 'posted'])
    .gt('created_at', new Date(now - 14 * 24 * 60 * MINUTE).toISOString())
    .order('updated_at', { ascending: false })
    .limit(300)
  const rows = ((data ?? []) as Post[]).filter((p) => p.accounts.some((a) => a.held) && p.media && p.caption?.trim())
  const profiles = new Map<string, Profile>()
  for (const row of rows) {
    try {
      let profile = profiles.get(row.profile_id)
      if (!profile) {
        const { data: found } = await db.from('cutter_profiles').select('*').eq('id', row.profile_id).single()
        profile = found as Profile
        profiles.set(row.profile_id, profile)
      }
      const free = releasable(row.accounts, profile.settings.limits)
      if (free.length === 0) continue
      const owned = await claim(row.id)
      if (!owned) continue
      try {
        const tz = profile.timezone
        const keys = await keysFor(profile.id)
        const soon = Math.max(owned.post_at ? new Date(owned.post_at).getTime() : 0, now + 3 * MINUTE)
        const baseDay = localDate(new Date(soon), tz)
        const timeOfDay = localTime(new Date(owned.post_at ?? soon), tz)
        const caches = new Map<string, Record<string, number>>()
        const usedFor = async (day: string) => {
          if (!caches.has(day)) caches.set(day, await usedForDay(profile!, day, owned.id))
          return caches.get(day)!
        }
        // Each account's first day with room; accounts landing on one day go together.
        const byDay = new Map<string, PostAccount[]>()
        for (const account of free) {
          const counts = new Map<string, Record<string, number>>()
          for (let n = 0; n < 7; n++) counts.set(addDays(baseDay, n), await usedFor(addDays(baseDay, n)))
          const day = firstDayWithRoom(account, profile.settings.limits, baseDay, addDays, (d, id) => counts.get(d)?.[id] ?? 0)
          if (day) byDay.set(day, [...(byDay.get(day) ?? []), account])
        }
        if (byDay.size === 0) continue
        const title = finishTitle(owned.title ?? '', [owned.headline ?? '', owned.campaign_name])
        const ids = [...(owned.postiz_ids ?? [])]
        const gone = new Set<string>()
        let latest = owned.post_at ? new Date(owned.post_at).getTime() : 0
        for (const [day, accounts] of byDay) {
          // Another day: the same time of day.
          const at = day === baseDay ? new Date(soon) : zoned(day, timeOfDay, tz)
          const date = at.toISOString()
          const found = await findCreated(keys.postiz, { ...owned, accounts }, date)
          const made =
            found ??
            (await postiz<{ postId: string; integration: string }[]>(keys.postiz, 'POST', '/posts', {
              type: 'schedule',
              date,
              shortLink: false,
              tags: [],
              posts: accounts.map((account) => {
                const text = textFor(owned, account.id)
                return {
                  integration: { id: account.id },
                  value: [{ content: text.caption, image: [{ id: owned.media!.id, path: owned.media!.path }] }],
                  settings: settingsFor(account.platform, finishTitle(text.title ?? '', [owned.headline ?? '', owned.campaign_name]), instagramPlace(profile.settings, owned.campaign_id)),
                }
              }),
            }))
          ids.push(...(Array.isArray(made) ? made : []))
          for (const a of accounts) gone.add(a.id)
          latest = Math.max(latest, at.getTime())
        }
        const accountsNow: PostAccount[] = owned.accounts.map((a): PostAccount => {
          if (!gone.has(a.id)) return a
          const { held: _was, ...bare } = a
          void _was
          return bare
        })
        await update(owned.id, {
          accounts: accountsNow,
          postiz_ids: ids,
          status: 'scheduled',
          post_at: new Date(latest).toISOString(),
          error: heldNote(accountsNow.filter((a) => a.held)),
          checks: 0,
          checked_at: null,
        })
      } finally {
        await release(row.id)
      }
    } catch (error) {
      console.error('release held failed', row.id, error instanceof Error ? error.message : String(error))
    }
  }
}

/** Videos already made for a campaign get an account that was linked after
 *  them (attach.ts says what each one does). The accounts must already be
 *  saved on the campaign's Posting - this only catches the videos up.
 *
 *  Each post is claimed first, like the scheduler does, so a run that is
 *  moving it along cannot race this. A scheduled post gets a Postiz post for
 *  ONLY the new accounts, at the time it already has; the accounts that are
 *  there are never touched, so nothing goes out twice. */
async function attachAccounts(profile: Profile, body: Record<string, unknown>): Promise<Response> {
  const campaignId = typeof body.campaignId === 'string' ? body.campaignId : ''
  if (!campaignId || campaignId.length > 200) throw new Problem('Which campaign?')
  const chosen = new Set(profile.settings.campaigns?.[campaignId]?.accounts ?? [])
  const accounts = (Array.isArray(body.accounts) ? body.accounts : [])
    .filter((id): id is string => typeof id === 'string' && chosen.has(id))
    .map((id) => profile.accounts.find((a) => a.id === id))
    .filter((a): a is Account => Boolean(a))
    .map((a) => ({ id: a.id, name: a.name, platform: a.platform, profile: a.profile }))
  if (accounts.length === 0) return reply({ added: 0, scheduled: 0, left: 0 })
  const wanted = accounts.map((a) => a.id)

  const { data } = await db
    .from('cutter_posts')
    .select('*')
    .eq('profile_id', profile.id)
    .eq('campaign_id', campaignId)
    .in('status', ['waiting', 'approved', 'scheduled'])
  const keys = await keysFor(profile.id)
  const moves: AttachMove[] = []

  for (const row of (data ?? []) as Post[]) {
    const first = attachMove(row, wanted, Date.now())
    if (first.move === 'has-all' || first.move === 'not-open') continue
    const owned = await claim(row.id)
    if (!owned) {
      moves.push('busy')
      continue
    }
    try {
      // Decided again now that it is ours: it may have moved on since the read.
      const { move, missing } = attachMove(owned, wanted, Date.now())
      moves.push(move)
      const extra = accounts.filter((a) => missing.includes(a.id))
      if (move === 'add') {
        await update(owned.id, { accounts: [...owned.accounts, ...extra] })
      } else if (move === 'add-scheduled') {
        const date = owned.post_at!
        // A run that stopped before it could record what it made is found
        // first, so the same account is never posted to twice.
        const found = await findCreated(keys.postiz, { ...owned, accounts: extra }, date)
        const title = finishTitle(owned.title ?? '', [owned.headline ?? '', owned.campaign_name])
        const made =
          found ??
          (await postiz<{ postId: string; integration: string }[]>(keys.postiz, 'POST', '/posts', {
            type: 'schedule',
            date,
            shortLink: false,
            tags: [],
            posts: extra.map((account) => {
              const text = textFor(owned, account.id)
              return {
                integration: { id: account.id },
                value: [{ content: text.caption, image: [{ id: owned.media!.id, path: owned.media!.path }] }],
                settings: settingsFor(account.platform, finishTitle(text.title ?? '', [owned.headline ?? '', owned.campaign_name]), instagramPlace(profile.settings, owned.campaign_id)),
              }
            }),
          }))
        await update(owned.id, {
          accounts: [...owned.accounts, ...extra],
          postiz_ids: [...(owned.postiz_ids ?? []), ...(Array.isArray(made) ? made : [])],
        })
      }
    } finally {
      await release(row.id)
    }
  }
  return reply(summarise(moves))
}

// --- Notifications --------------------------------------------------------------

let vapidReady: Promise<boolean> | null = null
function vapid(): Promise<boolean> {
  vapidReady ??= (async () => {
    const { data } = await db.from('cutter_config').select('key, value').in('key', ['vapid_public', 'vapid_private'])
    const get = (k: string) => data?.find((r) => r.key === k)?.value
    if (!get('vapid_public') || !get('vapid_private')) return false
    webpush.setVapidDetails(APP_URL, get('vapid_public')!, get('vapid_private')!)
    return true
  })()
  return vapidReady
}

async function savePush(profile: Profile, body: Record<string, unknown>): Promise<Response> {
  const sub = body.subscription as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | undefined
  if (
    !sub ||
    typeof sub.endpoint !== 'string' ||
    !sub.endpoint.startsWith('https://') ||
    typeof sub.keys?.p256dh !== 'string' ||
    typeof sub.keys?.auth !== 'string'
  ) {
    throw new Problem('That notification subscription is not usable.')
  }
  const { error } = await db
    .from('cutter_push')
    .upsert({ endpoint: sub.endpoint, profile_id: profile.id, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } })
  if (error) throw new Problem('Notifications could not be turned on. Try again.', true, 500)
  return reply({ ok: true })
}

/** Tells every phone of this profile. A phone that has gone away is
 *  forgotten. */
async function notify(profileId: string, message: { title: string; body: string; tag: string; url?: string }): Promise<number> {
  if (!(await vapid())) return 0
  const { data } = await db.from('cutter_push').select('endpoint, keys').eq('profile_id', profileId)
  let sent = 0
  for (const row of data ?? []) {
    try {
      await webpush.sendNotification(
        { endpoint: row.endpoint, keys: row.keys as { p256dh: string; auth: string } },
        JSON.stringify({ ...message, url: message.url ?? '/campaign.html#posts' }),
        { TTL: 12 * 60 * 60, urgency: 'high' },
      )
      sent++
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode
      if (status === 404 || status === 410) await db.from('cutter_push').delete().eq('endpoint', row.endpoint)
      else console.error('push failed', status, error instanceof Error ? error.message : String(error))
    }
  }
  return sent
}

/** How often "posts to approve" may buzz: a day's videos finish one after
 *  another, and the scheduler sends what was held back. */
const APPROVE_PUSH_EVERY = 10 * MINUTE

/** Something new is waiting for him: say so now, or - if he was told a
 *  moment ago - with the next one the scheduler sends. */
async function notifyWaiting(profileId: string): Promise<void> {
  await db.from('cutter_profiles').update({ push_pending: true }).eq('id', profileId)
  await sendWaiting(profileId)
}

async function sendWaiting(profileId: string): Promise<void> {
  const quietSince = new Date(Date.now() - APPROVE_PUSH_EVERY).toISOString()
  // Taken by one run only, so two videos finishing together buzz once.
  const { data: claimed } = await db
    .from('cutter_profiles')
    .update({ push_pending: false, pushed_at: new Date().toISOString() })
    .eq('id', profileId)
    .eq('push_pending', true)
    .or(`pushed_at.is.null,pushed_at.lt.${quietSince}`)
    .select('id')
    .maybeSingle()
  if (!claimed) return
  const { data } = await db.from('cutter_posts').select('campaign_name').eq('profile_id', profileId).eq('status', 'waiting').is('ready_at', null)
  const waiting = data ?? []
  if (waiting.length === 0) return
  const names = [...new Set(waiting.map((w) => w.campaign_name))]
  await notify(profileId, {
    title: waiting.length === 1 ? '1 post to approve' : `${waiting.length} posts to approve`,
    body: names.slice(0, 4).join(', ') + (names.length > 4 ? '…' : ''),
    tag: 'approve',
  })
}

// --- The video, in parts ------------------------------------------------------

const partPath = (post: Pick<Post, 'profile_id' | 'id'>, i: number) => `${post.profile_id}/${post.id}/${i}`

async function partsIn(post: Post): Promise<Map<number, number>> {
  const { data, error } = await db.storage.from(BUCKET).list(`${post.profile_id}/${post.id}`, { limit: 1000 })
  if (error) throw new Problem('The uploaded parts could not be checked.', true, 500)
  const found = new Map<number, number>()
  for (const entry of data ?? []) {
    const index = Number(entry.name)
    if (Number.isInteger(index)) found.set(index, Number((entry.metadata as { size?: number } | null)?.size ?? 0))
  }
  return found
}

function expectedSize(post: Post, i: number): number {
  return i < post.parts - 1 ? PART_BYTES : post.size - PART_BYTES * (post.parts - 1)
}

async function removeParts(post: Post): Promise<void> {
  const paths = Array.from({ length: post.parts }, (_, i) => partPath(post, i))
  await db.storage.from(BUCKET).remove(paths)
}

async function signature(id: string, expires: number): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(), encoder.encode(`video:${id}:${expires}`)))
  return b64url(bytes)
}

async function videoUrl(post: Post, expires = Date.now() + 60 * MINUTE): Promise<string> {
  return `${PUBLIC_URL}/video/${post.id}.mp4?e=${expires}&s=${await signature(post.id, expires)}`
}

/** The parts joined back into the video, streamed - for Postiz to fetch. */
async function serveVideo(req: Request, url: URL): Promise<Response> {
  const match = url.pathname.match(/\/video\/([0-9a-f-]{36})\.mp4$/)
  const expires = Number(url.searchParams.get('e'))
  const given = url.searchParams.get('s') ?? ''
  if (!match || !Number.isFinite(expires) || expires < Date.now()) return new Response('Gone', { status: 410, headers: CORS })
  const id = match[1]
  const wanted = await signature(id, expires)
  if (wanted.length !== given.length || wanted !== given) return new Response('Forbidden', { status: 403, headers: CORS })
  const { data } = await db.from('cutter_posts').select('*').eq('id', id).maybeSingle()
  if (!data) return new Response('Not found', { status: 404, headers: CORS })
  const post = data as Post
  const headers = { ...CORS, 'Content-Type': 'video/mp4', 'Content-Length': String(post.size), 'Cache-Control': 'no-store' }
  if (req.method === 'HEAD') return new Response(null, { headers })
  let next = 0
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (next >= post.parts) {
        controller.close()
        return
      }
      const { data: blob, error } = await db.storage.from(BUCKET).download(partPath(post, next))
      if (error || !blob) {
        controller.error(new Error(`part ${next} is missing`))
        return
      }
      controller.enqueue(new Uint8Array(await blob.arrayBuffer()))
      next++
    },
  })
  return new Response(stream, { headers })
}

// --- Buffer, the backup (buffer.ts) -------------------------------------------------
//
// When Postiz can't post something, the accounts Buffer backs up get the same
// video, caption and time through Buffer. A post that never got into Postiz
// goes there by itself (schedule); posts Postiz already holds go only while
// he has switched "Postiz is down" on (handOver), since Postiz's own
// scheduler can keep posting while its API is down. An account with a backup
// keeps the server's copy of its video until the post is out, for Buffer to
// fetch.

async function bufferKeysFor(profileId: string): Promise<string[]> {
  const { data } = await db.from('cutter_profile_secrets').select('buffer_keys').eq('profile_id', profileId).maybeSingle()
  if (!data?.buffer_keys) return []
  try {
    const keys = JSON.parse(await unseal(data.buffer_keys)) as unknown
    return Array.isArray(keys) ? keys.map(String) : []
  } catch {
    return []
  }
}

/** Postiz account id -> the Buffer channel that backs it up. */
function backupFor(profile: Pick<Profile, 'accounts' | 'settings'>): Record<string, BufferChannel> {
  return matchChannels(profile.accounts, profile.settings.backup?.channels ?? [])
}

/** The video for Buffer to fetch: the server's own copy while it has it -
 *  signed until a day past its time - or else Postiz's. */
async function bufferVideoUrl(post: Post): Promise<string> {
  const parts = await partsIn(post).catch(() => new Map<number, number>())
  if (post.parts > 0 && parts.size === post.parts) {
    const at = post.post_at ? new Date(post.post_at).getTime() : Date.now()
    return videoUrl(post, Math.max(at, Date.now()) + 24 * 60 * MINUTE)
  }
  if (post.media?.path?.startsWith('https://')) return post.media.path
  throw new Problem('The video is no longer on the server, and Postiz has no copy to give Buffer.')
}

/** How many more posts each of his Buffer channels can take now (roomLeft:
 *  the free plan holds BUFFER_QUEUE waiting at once). */
async function bufferRoom(profile: Profile): Promise<Map<string, number>> {
  const { data } = await db
    .from('cutter_posts')
    .select('buffer_ids')
    .eq('profile_id', profile.id)
    .eq('status', 'scheduled')
    .not('buffer_ids', 'is', null)
    .limit(1000)
  return roomLeft((data ?? []) as Pick<Post, 'buffer_ids'>[], profile.settings.backup?.channels ?? [])
}

/** Sends these accounts of a post through Buffer, at `dueAt` (null: now) -
 *  each saved on the post as it goes, so none is ever sent twice - while
 *  their channel has `room` (taken as it goes). Says which accounts wait for
 *  room (`full`) and what Buffer turned down (`problems`). */
async function toBuffer(
  profile: Profile,
  start: Post,
  accounts: PostAccount[],
  dueAt: number | null,
  room: Map<string, number>,
): Promise<{ post: Post; problems: string[]; full: string[] }> {
  const matched = backupFor(profile)
  const keys = await bufferKeysFor(profile.id)
  let post = start
  let url: string | null = null
  const problems: string[] = []
  const full: string[] = []
  for (const account of accounts) {
    const channel = matched[account.id]
    if (!channel || post.buffer_ids?.[account.id]) continue
    if ((room.get(channel.id) ?? 0) <= 0) {
      full.push(account.name)
      continue
    }
    const key = keys[channel.key]
    if (!key) {
      problems.push(`${account.name}: its Buffer key is gone - paste it again in Settings, Posting.`)
      continue
    }
    try {
      url ??= await bufferVideoUrl(post)
      const made = await createBufferPost(key, { channel, caption: textFor(post, account.id).caption ?? '', videoUrl: url, dueAt })
      const ref: BufferRef = { postId: made.id, channelId: channel.id, at: new Date(dueAt ?? Date.now()).toISOString(), status: made.status }
      post = await update(post.id, { buffer_ids: { ...(post.buffer_ids ?? {}), [account.id]: ref } })
      room.set(channel.id, (room.get(channel.id) ?? 0) - 1)
    } catch (error) {
      const said = error instanceof Error ? error.message : String(error)
      if (isFull(said)) {
        // Buffer counts it full before we do (posts added in Buffer by hand).
        room.set(channel.id, 0)
        full.push(account.name)
      } else problems.push(`${account.name}: ${said}`)
    }
  }
  return { post, problems, full }
}

/** Takes what Buffer still holds of a post out of it, so it doesn't go. */
async function dropFromBuffer(profile: Profile, post: Post): Promise<void> {
  const refs = Object.values(post.buffer_ids ?? {}).filter((ref) => ref.status !== 'sent')
  if (refs.length === 0) return
  const keys = await bufferKeysFor(profile.id)
  const channels = profile.settings.backup?.channels ?? []
  for (const ref of refs) {
    const key = keys[channels.find((c) => c.id === ref.channelId)?.key ?? -1]
    if (!key) throw new Problem("Its Buffer key is gone, so it couldn't be taken out of Buffer - delete it there.")
    await deleteBufferPost(key, ref.postId)
  }
}

/** Buffer as a backup: a key pasted (checked by reading its channels), every
 *  key taken out, or "Postiz is down" switched. Every key's channels are
 *  read again each time; the keys are sealed like the Postiz key. */
async function saveBackup(profile: Profile, body: Record<string, unknown>): Promise<Response> {
  let keys = await bufferKeysFor(profile.id)
  const pasted = typeof body.bufferKey === 'string' ? body.bufferKey.trim() : ''
  if (pasted) {
    if (pasted.length > 500 || /\s/.test(pasted)) throw new Problem("That doesn't look like a Buffer key - copy it again from Buffer: Settings, API.")
    if (!keys.includes(pasted)) {
      if (keys.length >= 5) throw new Problem('Five Buffer keys at most - take the old ones out first.')
      try {
        await listChannels(pasted, keys.length)
      } catch (error) {
        throw new Problem(error instanceof Error ? error.message : String(error))
      }
      keys = [...keys, pasted]
    }
  }
  if (body.removeKeys === true) keys = []
  const channels: BufferChannel[] = []
  const problems: string[] = []
  for (const [i, key] of keys.entries()) {
    try {
      channels.push(...(await listChannels(key, i)))
    } catch (error) {
      problems.push(`Key ${i + 1}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const { error } = await db
    .from('cutter_profile_secrets')
    .update({ buffer_keys: keys.length > 0 ? await seal(JSON.stringify(keys)) : null })
    .eq('profile_id', profile.id)
  if (error) throw new Problem('The Buffer key could not be saved. Try again.', true, 500)
  const saved = await patchSettings(profile.id, (settings) => ({
    ...settings,
    backup: {
      keys: keys.length,
      channels,
      active: keys.length > 0 && (typeof body.active === 'boolean' ? body.active : Boolean(settings.backup?.active)),
      checkedAt: new Date().toISOString(),
      problem: problems.join(' ') || null,
    },
  }))
  return reply(await profileView(saved))
}

// --- A video arriving -----------------------------------------------------------

function cleanRules(value: unknown): PostingRules {
  const r = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  return {
    caption: r.caption === 'paste' ? 'paste' : 'claude',
    rules: typeof r.rules === 'string' ? r.rules.slice(0, 4000) : '',
    hashtags: (Array.isArray(r.hashtags) ? r.hashtags : [])
      .filter((t): t is string => typeof t === 'string')
      .map(normalTag)
      .filter(Boolean)
      .slice(0, 30),
    approval: r.approval === 'direct' || r.approval === 'brand' ? r.approval : 'me',
    remind: r.remind === true,
    repost: cleanRepost(r.repost),
  }
}

const text = (value: unknown, max: number): string | null => (typeof value === 'string' ? value.slice(0, max) : null)

async function start(profile: Profile, body: Record<string, unknown>): Promise<Response> {
  const key = typeof body.key === 'string' && body.key.length > 0 && body.key.length < 200 ? body.key : null
  const size = Number(body.size)
  const campaign = (body.campaign ?? {}) as Record<string, unknown>
  const meta = (body.meta ?? {}) as Record<string, unknown>
  if (!key) throw new Problem('Which video?')
  if (!Number.isInteger(size) || size <= 0 || size > MAX_BYTES) throw new Problem('That video is too big to send.')
  if (typeof campaign.id !== 'string' || !campaign.id) throw new Problem('Which campaign?')
  const parts = Math.ceil(size / PART_BYTES)
  const rules = cleanRules(campaign.posting)
  const hand = handFields(meta.byHand, rules, text(campaign.name, 200) ?? 'Campaign')
  const batch = hand ? null : batchInfo(meta.batch)
  const carry = carryOver(meta.carry, (c) => finishCaption(c, rules.caption === 'paste' ? [] : rules.hashtags))
  // Music added with "Add music & approve": the new version goes out without
  // asking again - never past a brand's own say.
  const approveNow = carry !== null && (meta.carry as Record<string, unknown>).approve === true && rules.approval !== 'brand'

  let { data: post } = await db.from('cutter_posts').select('*').eq('profile_id', profile.id).eq('client_key', key).maybeSingle()
  if (!post) {
    const { data, error } = await db
      .from('cutter_posts')
      .insert({
        profile_id: profile.id,
        client_key: key,
        campaign_id: campaign.id,
        campaign_name: text(campaign.name, 200) ?? 'Campaign',
        // By hand: nothing to approve. A batch: always his approval - but a
        // Formats video he scheduled himself goes at its time (approvalFor).
        rules: {
          ...rules,
          approval: approvalFor(rules.approval, { hand: Boolean(hand), approveNow, batch: Boolean(batch), scheduled: meta.scheduled === true }),
        },
        status: 'uploading',
        parts,
        size,
        file_name: text(meta.fileName, 300),
        transcript: text(meta.transcript, 20_000),
        headline: text(meta.headline, 500),
        duration: Number.isFinite(Number(meta.duration)) ? Number(meta.duration) : null,
        later: meta.later === true,
        // A video made again from an earlier post keeps what he already wrote.
        ...(carry ?? {}),
        ...(hand ?? {}),
        ...(batch ? { batch } : {}),
      })
      .select('*')
      .single()
    if (error?.code === '23505') {
      ;({ data: post } = await db.from('cutter_posts').select('*').eq('profile_id', profile.id).eq('client_key', key).maybeSingle())
    } else if (error || !data) {
      throw new Problem('The server could not take the video. Trying again.', true, 500)
    } else post = data
  }
  const row = post as Post
  if (row.status !== 'uploading') return reply({ id: row.id, partBytes: PART_BYTES, uploads: [], status: row.status })
  if (row.size !== size) throw new Problem('This video changed since it was first sent.')
  const have = await partsIn(row)
  const uploads: { part: number; url: string }[] = []
  for (let i = 0; i < row.parts; i++) {
    if (have.get(i) === expectedSize(row, i)) continue
    const { data } = await db.storage.from(BUCKET).createSignedUploadUrl(partPath(row, i), { upsert: true })
    if (!data?.signedUrl) throw new Problem('The server could not make a place for the video. Trying again.', true, 500)
    uploads.push({ part: i, url: data.signedUrl })
  }
  return reply({ id: row.id, partBytes: PART_BYTES, uploads, status: row.status })
}

/** The caption Claude would write for a post made by hand, for him to read
 *  and change before it goes. */
async function captionFor(profile: Profile, body: Record<string, unknown>): Promise<Response> {
  const campaign = (body.campaign ?? {}) as Record<string, unknown>
  if (typeof campaign.id !== 'string' || !campaign.id) throw new Problem('Which campaign?')
  const stills = (Array.isArray(body.stills) ? body.stills : [])
    .filter((s): s is string => typeof s === 'string' && s.length < 700_000 && /^[A-Za-z0-9+/]+=*$/.test(s))
    .slice(0, 4)
  const keys = await keysFor(profile.id)
  const written = await writeCaption(
    keys.anthropic,
    {
      campaign_name: text(campaign.name, 200) ?? 'Campaign',
      rules: cleanRules(campaign.posting),
      headline: null,
      transcript: null,
      about: text(body.about, 2000),
    },
    stills,
  )
  return reply({ caption: written.caption ?? '', title: written.title ?? '', error: written.error ?? null })
}

/** Claude's second look at a video's burned-in captions: fixes words the
 *  phone's speech model misheard, using the campaign's own vocabulary, and
 *  nothing more. Costs credits on his Anthropic key, so it only runs when he
 *  asks. The reply says what changed and what it cost. */
async function recheckCaptions(profile: Profile, body: Record<string, unknown>): Promise<Response> {
  const phrases = (Array.isArray(body.phrases) ? body.phrases : [])
    .filter((p): p is string => typeof p === 'string')
    .slice(0, 200)
    .map((p) => p.slice(0, 400))
  if (phrases.length === 0) throw new Problem('There are no captions to check.')
  const vocabulary = (Array.isArray(body.vocabulary) ? body.vocabulary : [])
    .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
    .slice(0, 80)
    .map((v) => v.trim().slice(0, 60))
  const keys = await keysFor(profile.id)
  if (!keys.anthropic) throw new Problem('Your Anthropic key is missing - paste it in Settings, Posting.')
  if (keys.anthropic === FAKE_CLAUDE) return reply({ phrases, changed: [], costCents: 0 })

  const client = new Anthropic({ apiKey: keys.anthropic, maxRetries: 2, timeout: 2 * MINUTE })
  const request = {
    model: MODEL,
    max_tokens: 8000,
    system: RECHECK_SYSTEM,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: RECHECK_SCHEMA } },
    messages: [
      {
        role: 'user',
        content: `Vocabulary: ${vocabulary.length > 0 ? vocabulary.join(', ') : '(none given)'}\n\nCaptions:\n${phrases.map((p, i) => `${i + 1}. ${p}`).join('\n')}`,
      },
    ],
  }
  let response
  try {
    response = await client.beta.messages.create({
      ...request,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    } as never)
  } catch (error) {
    if (error instanceof Anthropic.BadRequestError && /fallback/i.test(error.message)) {
      response = await client.beta.messages.create(request as never).catch(anthropicProblem)
    } else anthropicProblem(error)
  }
  const message = response as {
    stop_reason: string
    content: { type: string; text?: string }[]
    usage?: { input_tokens?: number; output_tokens?: number }
  }
  const said = message.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('')
  let parsed: { phrases?: unknown } = {}
  try {
    parsed = JSON.parse(said)
  } catch {
    parsed = {}
  }
  const cost = costCents(message.usage?.input_tokens ?? 0, message.usage?.output_tokens ?? 0)
  const fixed = Array.isArray(parsed.phrases) ? parsed.phrases : null
  // Not the same number of phrases: nothing can be trusted to line up, so
  // nothing changes. What it cost is still said.
  if (message.stop_reason === 'refusal' || !fixed || fixed.length !== phrases.length) {
    return reply({ phrases, changed: [], costCents: cost, error: "Claude's answer didn't line up with the captions, so nothing was changed." })
  }
  const result = phrases.map((original, i) => acceptFix(original, fixed[i]))
  const changed = result.flatMap((text, i) => (text !== phrases[i] ? [i] : []))
  return reply({ phrases: result, changed, costCents: cost })
}

async function sent(profile: Profile, body: Record<string, unknown>): Promise<Response> {
  const { data } = await db.from('cutter_posts').select('*').eq('profile_id', profile.id).eq('client_key', String(body.key ?? '')).maybeSingle()
  if (!data) throw new Problem('That video never arrived - it is being sent again.', true, 404)
  const post = data as Post
  if (post.status !== 'uploading') return reply({ id: post.id, status: post.status })
  const have = await partsIn(post)
  const missing = Array.from({ length: post.parts }, (_, i) => i).filter((i) => have.get(i) !== expectedSize(post, i))
  if (missing.length > 0) return reply({ id: post.id, missing })
  const moved = await update(post.id, { status: 'writing', error: null, attempts: 0, retry_at: null })
  later(advance(moved.id))
  return reply({ id: post.id, status: moved.status })
}

// --- Moving a post along ------------------------------------------------------

/** Runs after the reply has gone, so the phone is never kept waiting. */
function later(work: Promise<unknown>): void {
  const guarded = work.catch((error) => console.error('background work failed', error))
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime
  if (runtime) runtime.waitUntil(guarded)
}

/** Takes the post for this run, or says another run has it. */
async function claim(id: string): Promise<Post | null> {
  const stale = new Date(Date.now() - 8 * MINUTE).toISOString()
  const { data } = await db
    .from('cutter_posts')
    .update({ working_at: new Date().toISOString() })
    .eq('id', id)
    .or(`working_at.is.null,working_at.lt.${stale}`)
    .select('*')
    .maybeSingle()
  return (data as Post | null) ?? null
}

async function release(id: string): Promise<void> {
  await db.from('cutter_posts').update({ working_at: null }).eq('id', id)
}

/** Gets a post as far as it can go: caption, video into Postiz, a time,
 *  then either waiting for him or scheduled. */
async function advance(id: string): Promise<void> {
  const claimed = await claim(id)
  if (!claimed) return
  let post = claimed
  try {
    if (post.status === 'writing') post = await prepare(post)
    if (post.status === 'approved') post = await schedule(post)
  } catch (error) {
    await failed(post, error)
  } finally {
    await release(id)
  }
}

async function prepare(start: Post): Promise<Post> {
  let post = start
  const { data: profileRow } = await db.from('cutter_profiles').select('*').eq('id', post.profile_id).single()
  const profile = profileRow as Profile
  const keys = await keysFor(profile.id)

  if (post.rules.caption === 'claude' && !post.caption) {
    let previous: string | null = null
    if (post.repost_of) {
      const { data: original } = await db.from('cutter_posts').select('caption').eq('id', post.repost_of).maybeSingle()
      previous = (original as { caption: string | null } | null)?.caption ?? null
    }
    const written = await writeCaption(keys.anthropic, post, [], previous)
    post = await update(post.id, written)
  }

  const chosen = profile.settings.campaigns?.[post.campaign_id]
  const accounts = (chosen?.accounts ?? [])
    .map((accountId) => profile.accounts.find((a) => a.id === accountId))
    .filter((a): a is Account => Boolean(a))
    .map((a) => ({ id: a.id, name: a.name, platform: a.platform, profile: a.profile }))
  if (accounts.length === 0) {
    throw new Problem(`No accounts are picked for ${post.campaign_name} - pick them in the campaign's Posting, then Try again.`)
  }

  // A batch video's goes in with it, half a day before its time (schedule).
  if (!post.media && !post.batch) {
    const backedUp = accounts.some((a) => backupFor(profile)[a.id])
    try {
      post = await mediaInPostiz(keys.postiz, post, backedUp)
    } catch (error) {
      // Postiz can't take it: with a Buffer backup it goes on without, and
      // schedule() hands those accounts to Buffer.
      if (!(error instanceof PostizProblem) || !backedUp) throw error
    }
  }

  if (post.batch && !post.post_at) post = await takeBatchSlot(post, profile)
  if (!post.post_at && !post.by_hand && !post.batch) post = await takeSlot(post, profile, { leadMinutes: 10 })

  const hasCaption = Boolean(post.caption?.trim())
  const ready = (post.rules.approval === 'direct' || post.by_hand) && hasCaption
  post = await update(post.id, {
    accounts,
    status: ready ? 'approved' : 'waiting',
    // "Claude didn't write this one" stays until he writes it.
    error: hasCaption || post.rules.caption === 'paste' ? null : post.error,
    attempts: 0,
    retry_at: null,
  })
  if (post.status === 'waiting') await (post.batch ? notifyBatch(post.profile_id, post.batch.id) : notifyWaiting(post.profile_id))
  return post
}

/** The video into Postiz. The server's copy goes then - unless a Buffer
 *  backup may need it, in which case it stays until the post is out. */
async function mediaInPostiz(key: string, post: Post, keepCopy: boolean): Promise<Post> {
  const media = await postiz<Media>(key, 'POST', '/upload-from-url', { url: await videoUrl(post) }, needOf(post))
  if (!media?.id || !media?.path) throw new PostizProblem('Postiz took the video but gave nothing back to post it with.', true)
  const saved = await update(post.id, { media: { id: media.id, path: media.path } })
  if (!keepCopy) await removeParts(saved).catch(() => {})
  return saved
}

/** A batch video's day and time: its own, or - taken by another video of
 *  the campaign - the day's next free one, then an earlier one. With every
 *  one of them taken it still goes at its own time. */
async function takeBatchSlot(post: Post, profile: Profile): Promise<Post> {
  const batch = post.batch!
  const times = timesFor(profile.settings.campaigns?.[post.campaign_id], post.campaign_id)
  const choices = batchChoices(batch, times, profile.timezone)
  for (const choice of choices) {
    const { data, error } = await db
      .from('cutter_posts')
      .update({ slot: choice.slot, post_at: choice.at.toISOString(), spread: null, updated_at: new Date().toISOString() })
      .eq('id', post.id)
      .select('*')
      .single()
    if (!error && data) return data as Post
    if (error?.code !== '23505') throw new Problem('A time could not be saved for the post.', true, 500)
  }
  return update(post.id, { slot: null, post_at: choices[0]?.at.toISOString() ?? null, spread: null })
}

/** A batch's one notification: once every video of it is up and waiting -
 *  or, when some never came (they failed to be made), once the rest have
 *  been sitting there a while (the scheduler's tick, with stragglers). */
async function notifyBatch(profileId: string, batchId: string, stragglers = false): Promise<void> {
  const { data } = await db
    .from('cutter_posts')
    .select('status, batch, batch_told, campaign_name, updated_at')
    .eq('profile_id', profileId)
    .eq('batch->>id', batchId)
  const rows = (data ?? []) as Pick<Post, 'status' | 'batch' | 'batch_told' | 'campaign_name' | 'updated_at'>[]
  if (rows.length === 0 || rows.some((r) => r.batch_told)) return
  if (rows.some((r) => r.status === 'uploading' || r.status === 'writing')) return
  const size = rows[0].batch?.size ?? rows.length
  const quiet = rows.every((r) => Date.now() - Date.parse(r.updated_at) > 20 * MINUTE)
  if (rows.length < size && !(stragglers && quiet)) return
  const waiting = rows.filter((r) => r.status === 'waiting')
  await db.from('cutter_posts').update({ batch_told: true }).eq('profile_id', profileId).eq('batch->>id', batchId)
  if (waiting.length === 0) return
  const last = rows.some((r) => r.batch?.last === true)
  await notify(profileId, { ...batchReady(rows[0].campaign_name, waiting.map((r) => r.batch!.date), last), tag: `batch-${batchId}` })
}

/** The next free time of the campaign's own - or a place in today's spread
 *  when the day ran late or it is one more than the campaign's times - or
 *  "as soon as it's ready" when it has no times. A brand's late yes takes
 *  the next time today, or goes at once. */
async function takeSlot(post: Post, profile: Profile, { leadMinutes, todayOnly = false }: { leadMinutes: number; todayOnly?: boolean }): Promise<Post> {
  const times = timesFor(profile.settings.campaigns?.[post.campaign_id], post.campaign_id)
  for (let tries = 0; tries < 5; tries++) {
    const { data: rows } = await db
      .from('cutter_posts')
      .select('slot, spread')
      .eq('profile_id', post.profile_id)
      .eq('campaign_id', post.campaign_id)
      .not('slot', 'is', null)
      .not('status', 'in', '(rejected,failed)')
      .neq('id', post.id)
    const others = (rows ?? []) as OtherPost[]
    const now = new Date()
    let fields: Partial<Post>
    if (todayOnly) {
      const choice = nextSlot({ times, taken: new Set(others.map((o) => o.slot)), now, tz: profile.timezone, leadMinutes, todayOnly })
      fields = choice ? { slot: choice.slot, post_at: choice.at.toISOString(), spread: null } : { slot: null, post_at: null, spread: null }
    } else {
      const choice = pickTime({ times, others, now, tz: profile.timezone, later: post.later, leadMinutes, session: sessionOf(profile.settings.campaigns?.[post.campaign_id]) })
      fields = !choice
        ? { slot: null, post_at: null, spread: null }
        : choice.kind === 'fixed'
          ? { slot: choice.slot, post_at: choice.at.toISOString(), spread: null }
          : { slot: choice.slot, spread: choice.spread }
    }
    const { data, error } = await db
      .from('cutter_posts')
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq('id', post.id)
      .select('*')
      .single()
    if (!error && data) {
      const saved = data as Post
      if (!saved.spread) return saved
      // Its place in the day's spread - and every other one's, now there is
      // one more.
      await respread(profile, saved.campaign_id, saved.slot!.slice(0, 10))
      return await reload(saved.id)
    }
    // Another video took that time a moment ago: look again.
    if (error?.code !== '23505') throw new Problem('A time could not be saved for the post.', true, 500)
  }
  throw new Problem('A free time could not be found for the post.', true, 500)
}

async function reload(id: string): Promise<Post> {
  const { data } = await db.from('cutter_posts').select('*').eq('id', id).single()
  if (!data) throw new Problem('The post is gone.', false, 404)
  return data as Post
}

/** Sets the times of one campaign's spread videos for a day: late ones
 *  evenly from half an hour after the first came in until midnight, extra
 *  ones evenly between the campaign's last time and midnight. Ones already
 *  in Postiz keep their time; the rest move, so a batch still coming in
 *  stays evenly divided. */
async function respread(profile: Profile, campaignId: string, date: string): Promise<void> {
  const { data } = await db
    .from('cutter_posts')
    .select('id, spread, post_at, status, creating_at, created_at')
    .eq('profile_id', profile.id)
    .eq('campaign_id', campaignId)
    .like('slot', `${date} +%`)
    .not('status', 'in', '(rejected,failed)')
    .order('created_at', { ascending: true })
  const rows = (data ?? []) as Pick<Post, 'id' | 'spread' | 'post_at' | 'status' | 'creating_at' | 'created_at'>[]
  const times = timesFor(profile.settings.campaigns?.[campaignId], campaignId)
  const now = Date.now()
  for (const kind of ['late', 'extra'] as const) {
    const members = rows.filter((r) => r.spread === kind)
    if (members.length === 0) continue
    const start =
      kind === 'late'
        ? Math.min(...members.map((m) => Date.parse(m.created_at))) + 20 * MINUTE
        : (lastTimeToday(times, date, profile.timezone) ?? now)
    const end = spreadEnd(start, date, profile.timezone, spreadUntil(profile.settings.campaigns?.[campaignId]))
    const placed = spreadDay(
      members.map((m) => ({
        id: m.id,
        at: m.post_at ? Date.parse(m.post_at) : null,
        locked: ['scheduled', 'posted', 'error'].includes(m.status) || Boolean(m.creating_at),
      })),
      // Random until the spread's end, at least 15 minutes apart (slots.ts spreadDay, spreadEnd).
      { start, end, now, leadMs: 5 * MINUTE, minGapMs: 15 * MINUTE },
    )
    for (const m of members) {
      const at = placed.get(m.id)
      if (at === undefined || (m.post_at && Math.abs(Date.parse(m.post_at) - at) < 30_000)) continue
      await db
        .from('cutter_posts')
        .update({ post_at: new Date(at).toISOString(), updated_at: new Date().toISOString() })
        .eq('id', m.id)
        .is('creating_at', null)
    }
  }
}

/** A "straight away" video in the day's spread goes to Postiz once the
 *  batch has stopped coming in - no other video of its campaign in the last
 *  ten minutes - so the spread is settled first. Or when its time is close. */
async function settled(post: Post): Promise<boolean> {
  if (post.post_at && Date.parse(post.post_at) - Date.now() < 15 * MINUTE) return true
  const since = new Date(Date.now() - 10 * MINUTE).toISOString()
  const { count } = await db
    .from('cutter_posts')
    .select('id', { count: 'exact', head: true })
    .eq('profile_id', post.profile_id)
    .eq('campaign_id', post.campaign_id)
    .neq('id', post.id)
    .eq('by_hand', false)
    .not('status', 'in', '(rejected,failed)')
    .or(`created_at.gt.${since},status.in.(uploading,writing)`)
  return (count ?? 0) === 0
}

async function writeCaption(
  apiKey: string | null,
  post: Pick<Post, 'campaign_name' | 'rules' | 'headline' | 'transcript' | 'about'>,
  stills: string[] = [],
  /** The caption this video went out with before, when this is a repost. */
  previous: string | null = null,
): Promise<Partial<Post>> {
  if (!apiKey) throw new Problem('Your Anthropic key is missing - paste it in Settings, Posting.')
  if (apiKey === FAKE_CLAUDE) {
    const fake = fakeCaption(post.transcript || post.about || '', post.headline ?? '')
    return { caption: finishCaption(fake.caption, post.rules.hashtags), title: finishTitle(fake.title, [post.campaign_name]) }
  }
  const client = new Anthropic({ apiKey, maxRetries: 2, timeout: 2 * MINUTE })
  const request = {
    model: MODEL,
    max_tokens: 4000,
    system: CAPTION_SYSTEM,
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: CAPTION_SCHEMA } },
    messages: [
      {
        role: 'user',
        content: [
          ...stills.map((data) => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } })),
          {
            type: 'text',
            text: captionRequest({
              campaignName: post.campaign_name,
              rules: post.rules.rules,
              hashtags: post.rules.hashtags,
              headline: post.headline ?? '',
              transcript: post.transcript ?? '',
              about: post.about ?? '',
              stills: stills.length,
            }) + variationNote(previous),
          },
        ],
      },
    ],
  }
  let response
  try {
    // A declined request is tried again on another model by Anthropic
    // itself, rather than coming back empty.
    response = await client.beta.messages.create({
      ...request,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    } as never)
  } catch (error) {
    if (error instanceof Anthropic.BadRequestError && /fallback/i.test(error.message)) {
      response = await client.beta.messages.create(request as never).catch(anthropicProblem)
    } else anthropicProblem(error)
  }
  const message = response as { stop_reason: string; content: { type: string; text?: string }[] }
  const said = message.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('')
  let parsed: { caption?: unknown; title?: unknown } = {}
  try {
    parsed = JSON.parse(said)
  } catch {
    parsed = {}
  }
  if (message.stop_reason === 'refusal' || typeof parsed.caption !== 'string' || !parsed.caption.trim()) {
    // Left for him to write rather than posted with nothing.
    return { caption: '', title: finishTitle('', [post.headline ?? '', post.campaign_name]), error: "Claude didn't write this caption - write it here." }
  }
  return {
    caption: finishCaption(parsed.caption, post.rules.hashtags),
    title: finishTitle(typeof parsed.title === 'string' ? parsed.title : '', [post.headline ?? '', post.campaign_name]),
  }
}

function anthropicProblem(error: unknown): never {
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    throw new Problem("Your Anthropic key didn't work - paste it again in Settings, Posting.")
  }
  if (error instanceof Anthropic.RateLimitError || error instanceof Anthropic.InternalServerError || error instanceof Anthropic.APIConnectionError) {
    throw new Problem('Claude is busy right now.', true)
  }
  if (error instanceof Anthropic.APIError) throw new Problem(`Claude said: ${error.message}`)
  throw new Problem(`Claude could not be reached (${error instanceof Error ? error.message : String(error)}).`, true)
}

/** Puts an approved post into Postiz, at its time - or, if that time has
 *  gone while it waited, the next one (a brand-approved post takes the next
 *  time today, or goes at once). */
/** How many posts each account already has on a day (limits.ts usedOn). */
async function usedForDay(profile: Profile, date: string, exceptId: string): Promise<Record<string, number>> {
  const around = new Date(zoned(date, '12:00', profile.timezone).getTime())
  const { data } = await db
    .from('cutter_posts')
    .select('post_at, status, accounts')
    .eq('profile_id', profile.id)
    .in('status', ['scheduled', 'posted'])
    .neq('id', exceptId)
    .gte('post_at', new Date(around.getTime() - 36 * 60 * MINUTE).toISOString())
    .lte('post_at', new Date(around.getTime() + 36 * 60 * MINUTE).toISOString())
  return usedOn((data ?? []) as { post_at: string | null; status: string; accounts: PostAccount[] }[], date, (iso) => localDate(new Date(iso), profile.timezone))
}

async function schedule(start: Post): Promise<Post> {
  let post = start
  const { data: profileRow } = await db.from('cutter_profiles').select('*').eq('id', post.profile_id).single()
  const profile = profileRow as Profile
  const keys = await keysFor(profile.id)
  if (!post.caption?.trim()) throw new Problem(post.rules.caption === 'paste' ? 'Paste the caption first.' : 'Write the caption first.')

  const soon = Date.now() + 2 * MINUTE
  if (post.spread && post.rules.approval !== 'brand') {
    // Settled first, then at its place in the day's spread as it is now.
    if (post.rules.approval === 'direct' && !(await settled(post))) {
      return update(post.id, { retry_at: new Date(Date.now() + 5 * MINUTE).toISOString() })
    }
    await respread(profile, post.campaign_id, post.slot!.slice(0, 10))
    post = await reload(post.id)
  } else {
    if (!post.post_at || new Date(post.post_at).getTime() < soon) {
      if (post.slot) {
        const brand = post.rules.approval === 'brand'
        post = await takeSlot(post, profile, { leadMinutes: 3, todayOnly: brand })
      } else {
        post = await update(post.id, { post_at: null })
      }
    }
  }
  const now = !post.post_at
  const date = now ? new Date().toISOString() : post.post_at!

  // A batch video waits here, ready, until half a day before its time - not
  // into Postiz the moment it is made: a night's videos for days ahead used
  // all of Postiz's hour, and his own posts couldn't get in (2026-10-27). One
  // that may be in Postiz already (creating_at, Buffer) goes on.
  const goesIn = new Date(date).getTime() - BATCH_LEAD_MS
  if (post.batch && !now && goesIn > Date.now() && !post.creating_at && !post.buffer_ids) {
    return update(post.id, { retry_at: new Date(goesIn).toISOString(), error: null, attempts: 0 })
  }

  // A paused or full account does not go in this group: it is held on the post
  // and goes out by itself once it is free (releaseHeld). The others go as
  // planned. Everything held keeps the post queued, untouched.
  const used = await usedForDay(profile, localDate(new Date(date), profile.timezone), post.id)
  const { send, held } = split(post.accounts, profile.settings.limits, used)
  if (send.length === 0) {
    return update(post.id, { accounts: held, error: heldNote(held), retry_at: new Date(Date.now() + 30 * MINUTE).toISOString(), attempts: 0 })
  }
  const scheduled = async (fields: Partial<Post>) => {
    const row = await updateIf(post.id, 'approved', {
      status: 'scheduled',
      accounts: [...send, ...held],
      post_at: date,
      creating_at: null,
      error: heldNote(held),
      attempts: 0,
      retry_at: null,
      checks: 0,
      checked_at: null,
      ...fields,
    })
    if (row) return row
    // He stopped it, took it back or replaced it (Add music) while it was
    // being put into Postiz: it stays as he left it, and what this run just
    // created in Postiz goes again - or it would have gone out anyway.
    const current = await reload(post.id)
    const made = fields.postiz_ids ?? []
    if (made.length > 0 && current.status !== 'scheduled') await deleteScheduled(keys.postiz, { ...current, postiz_ids: made }).catch(() => {})
    return current
  }
  // The accounts already sent through Buffer stay there.
  const toPostiz = send.filter((account) => !post.buffer_ids?.[account.id])
  if (toPostiz.length === 0) return scheduled({})

  try {
    if (!post.media) post = await mediaInPostiz(keys.postiz, post, toPostiz.some((a) => backupFor(profile)[a.id]))
    if (post.creating_at) {
      // A run before this one may have got as far as creating it.
      const found = await findCreated(keys.postiz, { ...post, accounts: toPostiz }, date)
      if (found) return scheduled({ postiz_ids: found })
    }
    await update(post.id, { creating_at: new Date().toISOString() })
    const media = post.media!
    const created = await postiz<{ postId: string; integration: string }[]>(keys.postiz, 'POST', '/posts', {
      type: now ? 'now' : 'schedule',
      date,
      shortLink: false,
      tags: [],
      posts: toPostiz.map((account) => {
        const text = textFor(post, account.id)
        return {
          integration: { id: account.id },
          value: [{ content: text.caption, image: [{ id: media.id, path: media.path }] }],
          settings: settingsFor(account.platform, finishTitle(text.title ?? '', [post.headline ?? '', post.campaign_name]), instagramPlace(profile.settings, post.campaign_id)),
        }
      }),
    }, needOf(post))
    return scheduled({ postiz_ids: Array.isArray(created) ? created : [] })
  } catch (error) {
    if (!(error instanceof PostizProblem)) throw error
    // Postiz can't post it: the accounts Buffer backs up go through Buffer,
    // at the same time; the rest wait for Postiz as before.
    const covered = toPostiz.filter((a) => backupFor(profile)[a.id])
    if (covered.length === 0) throw error
    const at = now ? Date.now() : new Date(date).getTime()
    // Postiz not asked - this hour's share of its requests is used: it is
    // asked again once the hour is out (failed), not left until a few hours
    // before its time (2026-10-26: 80 of his friend's sat there all day).
    if (error instanceof PostizWait && at - Date.now() > 60 * MINUTE) throw error
    if (at - Date.now() > HAND_AHEAD_MS) {
      // Not due for a while: Postiz gets another go once it answers again
      // (probePostiz, a tick's one question every half hour) or nearer its
      // time, and Buffer takes it then if Postiz still can't - Buffer's free
      // plan holds only 10 posts a channel.
      return update(post.id, {
        error: `${POSTIZ_WAIT} (${error.message})`,
        retry_at: new Date(at - HAND_AHEAD_MS).toISOString(),
        attempts: 0,
        creating_at: null,
      })
    }
    const handed = await toBuffer(profile, post, covered, now ? null : at, await bufferRoom(profile))
    post = handed.post
    if (toPostiz.every((a) => post.buffer_ids?.[a.id])) return scheduled({})
    const through = covered.filter((a) => post.buffer_ids?.[a.id]).map((a) => a.name)
    const note = [
      error.message,
      through.length > 0 ? `Sent through Buffer to ${through.join(', ')}.` : '',
      handed.full.length > 0 ? `Buffer holds ${BUFFER_QUEUE} at a time for ${handed.full.join(', ')} - it goes in as soon as one is out.` : '',
      ...handed.problems,
    ]
      .filter(Boolean)
      .join(' ')
    // A backed-up account still to go - its Buffer channel full, or Buffer
    // turned it down - stays approved and is tried again shortly (Postiz
    // first, then Buffer): never sent back to him for being full, only once
    // Buffer has turned it down MAX_ATTEMPTS times.
    const attempts = handed.problems.length > 0 ? post.attempts + 1 : post.attempts
    if (covered.some((a) => !post.buffer_ids?.[a.id]) && attempts < MAX_ATTEMPTS) {
      return update(post.id, { error: note, retry_at: new Date(Date.now() + 10 * MINUTE).toISOString(), attempts, creating_at: null })
    }
    throw new PostizProblem(note, error.later, error.status)
  }
}

interface PostizPost {
  id: string
  content?: string
  publishDate?: string
  releaseURL?: string
  state?: string
  integration?: { id?: string; providerIdentifier?: string; name?: string }
}

async function postsAround(key: string, from: number, to: number, need: PostizNeed = 'post'): Promise<PostizPost[]> {
  const query = `?startDate=${encodeURIComponent(new Date(from).toISOString())}&endDate=${encodeURIComponent(new Date(to).toISOString())}`
  const result = await postiz<{ posts?: PostizPost[] }>(key, 'GET', `/posts${query}`, undefined, need)
  return result?.posts ?? []
}

/** Posts to these accounts at this time already in Postiz - made by a run
 *  that stopped before it could record them. */
async function findCreated(key: string, post: Post, date: string): Promise<{ postId: string; integration: string }[] | null> {
  const at = new Date(date).getTime()
  const found = await postsAround(key, at - 60 * MINUTE, at + 60 * MINUTE, needOf(post))
  const ours = new Set(post.accounts.map((a) => a.id))
  const matches = found.filter(
    (p) =>
      p.integration?.id &&
      ours.has(p.integration.id) &&
      p.publishDate &&
      Math.abs(new Date(p.publishDate).getTime() - at) < 10 * MINUTE,
  )
  return matches.length > 0 ? matches.map((p) => ({ postId: p.id, integration: p.integration!.id! })) : null
}

async function failed(post: Post, error: unknown): Promise<void> {
  const problem = error instanceof Problem ? error : new Problem(error instanceof Error ? error.message : String(error), true)
  // Not asked at all (PostizWait): no try spent - a post never goes back to
  // him for waiting out Postiz's hour.
  const attempts = error instanceof PostizWait ? post.attempts : post.attempts + 1
  // Postiz counts requests by the hour, so "too many" waits it out - this
  // login's other posts too, for the rest of this run.
  const busy = problem.status === 429
  const free = error instanceof PostizWait ? error.until : Date.now() + 15 * MINUTE
  const busyKey = error instanceof PostizWait && error.batchOnly ? `${post.profile_id}|batch` : post.profile_id
  if (busy) postizBusy.set(busyKey, Math.max(postizBusy.get(busyKey) ?? 0, free))
  if (problem.later && attempts < (busy ? MAX_ATTEMPTS * 2 : MAX_ATTEMPTS)) {
    const wait = busy ? Math.max(5 * MINUTE, free - Date.now()) : [2, 5, 10, 20, 30][Math.min(attempts - 1, 4)] * MINUTE
    // creating_at cleared: while it is set, Take back says the post is going
    // to Postiz this moment, and it could stay set through a whole outage.
    await update(post.id, { error: `${problem.message} Trying again by itself.`, attempts, retry_at: new Date(Date.now() + wait).toISOString(), creating_at: null })
    return
  }
  if (problem.later && post.status === 'approved' && attempts < LATER_GIVE_UP) {
    // Postiz (or the network) still not answering after an hour of tries:
    // an approved post stays approved and is tried every half hour, for a
    // day. Sent back to To approve, 25 posts came back for nothing in every
    // outage, and again an hour after he approved them again.
    // "Too many": tried again the moment Postiz's hour is out, like the rest -
    // half an hour on, it came after them and its time went by.
    await update(post.id, {
      error: `${problem.message} Trying again ${busy ? 'by itself' : 'every half hour'}.`,
      attempts,
      retry_at: new Date(Date.now() + (busy ? Math.max(5 * MINUTE, free - Date.now()) : 30 * MINUTE)).toISOString(),
      creating_at: null,
    })
    return
  }
  if (post.status === 'approved') {
    // Back to him, with the reason, so he can fix it and approve again.
    await update(post.id, { status: 'waiting', error: problem.message, attempts, retry_at: null, creating_at: null })
    await notifyWaiting(post.profile_id)
    return
  }
  await update(post.id, { status: 'failed', error: problem.message, attempts, retry_at: null, slot: null, post_at: null, spread: null })
  await notify(post.profile_id, { title: `${post.campaign_name}: a post failed`, body: problem.message, tag: `failed-${post.id}` })
}

// --- What he does on the Posts screen -----------------------------------------

async function ownPost(profile: Profile, id: unknown): Promise<Post> {
  if (typeof id !== 'string') throw new Problem('Which post?')
  const { data } = await db.from('cutter_posts').select('*').eq('id', id).eq('profile_id', profile.id).maybeSingle()
  if (!data) throw new Problem('That post is gone.', false, 404)
  return data as Post
}

/** His edits: caption, title and time. A time he picks is his, not a slot. */
function edits(post: Post, body: Record<string, unknown>): Partial<Post> {
  const fields: Partial<Post> = {}
  if (typeof body.caption === 'string') fields.caption = finishCaption(body.caption, post.rules.caption === 'paste' ? [] : post.rules.hashtags)
  if (typeof body.title === 'string') fields.title = body.title.slice(0, 100)
  if (body.captions !== undefined) {
    const hashtags = post.rules.caption === 'paste' ? [] : post.rules.hashtags
    fields.captions = cleanCaptions(body.captions, (c) => finishCaption(c, hashtags))
  }
  if (typeof body.at === 'string') {
    const at = Date.parse(body.at)
    if (!Number.isFinite(at)) throw new Problem('That time is not a real time.')
    fields.post_at = new Date(at).toISOString()
    fields.slot = null
    fields.spread = null
  }
  return fields
}

async function listPosts(profile: Profile): Promise<Response> {
  const since = new Date(Date.now() - 3 * 24 * 60 * MINUTE).toISOString()
  // Every post still to go, whatever else there is - then the recent
  // finished ones. In one list, newest first and cut at 300, a Stop or a
  // Start over (hundreds of rejected rows at once) pushed scheduled and
  // waiting posts off the end: 15 scheduled and 3 waiting were missing from
  // the friend's Posts screen on 2026-10-23.
  const [live, done] = await Promise.all([
    db
      .from('cutter_posts')
      .select('*')
      .eq('profile_id', profile.id)
      .or(`status.in.(uploading,writing,waiting,approved,failed),and(status.eq.scheduled,post_at.gt.${since})`)
      .order('created_at', { ascending: false })
      .limit(1000),
    db
      .from('cutter_posts')
      .select('*')
      .eq('profile_id', profile.id)
      .in('status', ['posted', 'rejected', 'error', 'scheduled'])
      .or(`created_at.gt.${since},post_at.gt.${since}`)
      .order('created_at', { ascending: false })
      .limit(300),
  ])
  if (live.error || done.error) throw new Problem('The posts could not be read.', true, 500)
  const seen = new Set<string>()
  const posts = [...((live.data ?? []) as Post[]), ...((done.data ?? []) as Post[])]
    .filter((p) => !seen.has(p.id) && seen.add(p.id))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
  // Anything stuck mid-way gets a nudge, without waiting for the scheduler -
  // the soonest to go out first, as the scheduler does: newest first, the
  // nudges spent Postiz's hour on videos days off while one due that evening
  // waited, and went out late (2026-10-26).
  const stuck = posts
    .filter(
      (p) =>
        (p.status === 'writing' || p.status === 'approved') &&
        (!p.retry_at || new Date(p.retry_at).getTime() <= Date.now()) &&
        Date.now() - new Date(p.updated_at).getTime() > 2 * MINUTE,
    )
    .sort((a, b) => (a.post_at ?? '').localeCompare(b.post_at ?? ''))
  for (const p of stuck.filter((p) => !postizBusyFor(profile.id, Boolean(p.batch))).slice(0, 3)) later(advance(p.id))
  return reply({ posts: posts.map(postView), now: new Date().toISOString() })
}

/** Takes a scheduled post back out of Postiz: every post it made. Accounts
 *  linked late are scheduled as their own group (attachAccounts), so deleting
 *  only the first id would leave those posts to go out. Ids after the first
 *  may already be gone with their group; only a refusal that matters stops it. */
async function deleteScheduled(key: string, post: Post): Promise<void> {
  const ids = [...new Set((post.postiz_ids ?? []).map((ref) => ref.postId))]
  for (const [n, id] of ids.entries()) {
    try {
      await postiz(key, 'DELETE', `/posts/${id}`, undefined, needOf(post))
    } catch (error) {
      if (n === 0 || !(error instanceof Problem) || error.status !== 400) throw error
    }
  }
}

async function act(profile: Profile, action: string, body: Record<string, unknown>): Promise<Response> {
  const post = await ownPost(profile, body.id)
  switch (action) {
    case 'edit': {
      if (!['waiting', 'failed'].includes(post.status)) throw new Problem('Take it back from Postiz first to change it.')
      return reply({ post: postView(await update(post.id, edits(post, body))) })
    }
    case 'approve': {
      if (post.status !== 'waiting') return reply({ post: postView(post) })
      const fields = edits(post, body)
      const caption = fields.caption ?? post.caption
      if (!caption?.trim()) throw new Problem(post.rules.caption === 'paste' ? 'Paste the caption first.' : 'Write the caption first.')
      const approved = await update(post.id, { ...fields, status: 'approved', ready_at: null, error: null, attempts: 0, retry_at: null })
      // Straight away when it can; if not, the scheduler keeps at it.
      await advance(approved.id)
      return reply({ post: postView(await ownPost(profile, post.id)) })
    }
    case 'ready': {
      // Approved, but held here until he taps Post (approve) - so he can save
      // the video first. Nothing sends a waiting post.
      if (post.status !== 'waiting') return reply({ post: postView(post) })
      const fields = edits(post, body)
      const caption = fields.caption ?? post.caption
      if (!caption?.trim()) throw new Problem(post.rules.caption === 'paste' ? 'Paste the caption first.' : 'Write the caption first.')
      return reply({ post: postView(await update(post.id, { ...fields, ready_at: new Date().toISOString(), error: null })) })
    }
    case 'reject': {
      // Out of Buffer first: a post there goes whatever Postiz does.
      if (post.buffer_ids) await dropFromBuffer(profile, post)
      let stopping: string | null = null
      if (post.status === 'scheduled' && post.postiz_ids?.[0]) {
        const { postiz: key } = await keysFor(profile.id)
        try {
          await deleteScheduled(key, post)
        } catch (error) {
          // Gone through Buffer while Postiz is down: Postiz lets go of it later (unpostStopped).
          if (!viaBufferOnly(post) || !(error instanceof PostizProblem)) throw error
          stopping = STOPPING
        }
      }
      // Its parts, or the copy kept for a Buffer backup.
      await removeParts(post).catch(() => {})
      return reply({ post: postView(await update(post.id, { status: 'rejected', error: stopping, retry_at: null, ...(stopping ? { attempts: 0 } : {}) })) })
    }
    case 'unschedule': {
      // Approved is scheduled to him (the Posts screen lists them together):
      // either comes back to To approve.
      if (post.status !== 'scheduled' && post.status !== 'approved') return reply({ post: postView(post) })
      if (post.status === 'scheduled' && post.post_at && new Date(post.post_at).getTime() < Date.now()) throw new Problem('It has already gone out.')
      // Not while a run is handing it to Postiz: that run would put it there
      // anyway. Held (claimed) until it is back in To approve.
      if (post.status === 'approved' && (post.creating_at || !(await claim(post.id)))) {
        throw new Problem('It is going to Postiz this moment - try again in a minute.')
      }
      const { postiz: key } = await keysFor(profile.id)
      if (post.postiz_ids?.[0]) await deleteScheduled(key, post)
      if (post.buffer_ids) await dropFromBuffer(profile, post)
      const back = { status: 'waiting' as const, ready_at: null, postiz_ids: null, buffer_ids: null, error: null, retry_at: null, attempts: 0, working_at: null }
      return reply({ post: postView(await update(post.id, back)) })
    }
    case 'retry-accounts':
      return reply({ post: postView(await retryAccounts(profile, post)) })
    case 'retry': {
      if (post.status !== 'failed' && !(post.status === 'writing' || post.status === 'approved')) return reply({ post: postView(post) })
      const moved = await update(post.id, { status: post.status === 'approved' ? 'approved' : 'writing', error: null, attempts: 0, retry_at: null })
      await advance(moved.id)
      return reply({ post: postView(await ownPost(profile, post.id)) })
    }
  }
  throw new Problem('Unknown action.')
}

/** Posts again, in a few minutes, to the accounts Postiz failed to post a
 *  video to - only those; the ones it reached are left alone. */
async function retryAccounts(profile: Profile, post: Post): Promise<Post> {
  const partly = post.status === 'posted' && Boolean(post.error)
  if (!partly && post.status !== 'error') return post
  if (!post.media || !post.caption?.trim() || !post.post_at) throw new Problem('This video is no longer in Postiz - post it again from New post.')
  const owned = await claim(post.id)
  if (!owned) throw new Problem('It is busy - try again in a minute.', true)
  try {
    const { postiz: key } = await keysFor(profile.id)
    const due = new Date(owned.post_at!).getTime()
    const found = await postsAround(key, due - 60 * MINUTE, due + 60 * MINUTE)
    const ids = owned.postiz_ids ?? []
    const failed = failedRefs(ids, found)
    const accounts = owned.accounts.filter((a) => !a.held && failed.some((ref) => ref.integration === a.id))
    if (accounts.length === 0) throw new Problem("Postiz no longer says which account it failed on - post it there by hand.")
    const date = new Date(Date.now() + 3 * MINUTE).toISOString()
    const made = await postiz<{ postId: string; integration: string }[]>(key, 'POST', '/posts', {
      type: 'schedule',
      date,
      shortLink: false,
      tags: [],
      posts: accounts.map((account) => {
        const text = textFor(owned, account.id)
        return {
          integration: { id: account.id },
          value: [{ content: text.caption, image: [{ id: owned.media!.id, path: owned.media!.path }] }],
          settings: settingsFor(account.platform, finishTitle(text.title ?? '', [owned.headline ?? '', owned.campaign_name]), instagramPlace(profile.settings, owned.campaign_id)),
        }
      }),
    })
    // The failed ones are dropped, or they would count as failed again.
    const gone = new Set(failed.map((ref) => ref.postId))
    return await update(owned.id, {
      postiz_ids: [...ids.filter((ref) => !gone.has(ref.postId)), ...(Array.isArray(made) ? made : [])],
      status: 'scheduled',
      post_at: date,
      error: null,
      checks: 0,
      checked_at: null,
    })
  } finally {
    await release(post.id)
  }
}

/** What a post says on the Posts screen while its caption is written again
 *  with the campaign's new rules - and how rewriteMarked finds them. */
const REWRITING = 'Rewriting the caption…'
/** The same for adding the campaign's missing hashtags, words kept. */
const ADDING_TAGS = 'Adding the hashtags…'
const REWRITE_BATCH = 12

/** His campaign's caption rules or hashtags changed: every post not out yet
 *  (recaption.ts pickRecaption) - or just the ones he picked, a batch - takes
 *  the new rules and is marked to get the missing hashtags (mode 'hashtags')
 *  or be written again ('rewrite'). The writing, and taking
 *  scheduled ones out of Postiz and back in with the new caption at the same
 *  time, happen after the answer (rewriteMarked), a dozen at a time. */
async function recaption(profile: Profile, body: Record<string, unknown>): Promise<Response> {
  const campaignId = typeof body.campaignId === 'string' ? body.campaignId : ''
  if (!campaignId || campaignId.length > 200) throw new Problem('Which campaign?')
  const rules = cleanRules(body.posting)
  const mode = cleanMode(body.mode)
  const only = Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === 'string' && /^[0-9a-f-]{36}$/.test(id)) : null
  const { data, error } = await db
    .from('cutter_posts')
    .select('id, status, post_at, rules')
    .eq('profile_id', profile.id)
    .eq('campaign_id', campaignId)
    .in('status', ['waiting', 'approved', 'scheduled'])
  if (error) throw new Problem('Its posts could not be read. Try again.', true, 500)
  const rows = ((data ?? []) as Pick<Post, 'id' | 'status' | 'post_at' | 'rules'>[]).filter((r) => !only || only.includes(r.id))
  const { redo, tooSoon } = pickRecaption(rows, Date.now())
  const at = new Date().toISOString()
  for (const row of rows.filter((r) => redo.includes(r.id))) {
    // Each keeps its own approval and reminders; only the caption rules change.
    const { error: failed } = await db
      .from('cutter_posts')
      .update({
        rules: { ...row.rules, caption: rules.caption, rules: rules.rules, hashtags: rules.hashtags },
        error: mode === 'rewrite' ? REWRITING : ADDING_TAGS,
        attempts: 0,
        updated_at: at,
      })
      .eq('id', row.id)
    if (failed) throw new Problem('Not all of them could be marked. Press Redo captions again to finish.', true, 500)
  }
  later(rewriteMarked(profile.id))
  return reply({ rewriting: redo.length, tooSoon })
}

/** Writes the marked captions again. A scheduled post is taken out of
 *  Postiz only once its new caption is written, then goes back at its own
 *  time; one that has come within a quarter of an hour of it meanwhile keeps
 *  the old caption. Run after a recaption and on every tick. */
async function rewriteMarked(profileId?: string): Promise<void> {
  let query = db
    .from('cutter_posts')
    .select('id')
    .in('error', [REWRITING, ADDING_TAGS])
    .in('status', ['waiting', 'approved', 'scheduled'])
    .limit(REWRITE_BATCH)
  if (profileId) query = query.eq('profile_id', profileId)
  const { data } = await query
  const ids = ((data ?? []) as { id: string }[]).map((r) => r.id)
  const one = async (id: string) => {
    const post = await claim(id)
    if (!post) return
    let resend = false
    try {
      if (post.status === 'scheduled' && pickRecaption([post], Date.now()).tooSoon > 0) {
        await update(post.id, { error: null })
        return
      }
      const keys = await keysFor(post.profile_id)
      const marker = post.error
      const tags = post.rules.caption === 'paste' ? [] : post.rules.hashtags
      const rewrite = marker === REWRITING && recaptionMode(post) === 'rewrite'
      // No caption yet (still to be written or pasted): nothing to add to -
      // it gets the hashtags when its caption comes.
      if (!rewrite && !post.caption?.trim()) {
        await update(post.id, { error: null, attempts: 0 })
        return
      }
      const written: Partial<Post> = rewrite ? await writeCaption(keys.anthropic, post) : { caption: finishCaption(post.caption ?? '', tags) }
      const captions = Object.fromEntries(
        Object.entries(post.captions ?? {}).map(([account, own]) => [account, { ...own, ...(own.caption ? { caption: finishCaption(own.caption, tags) } : {}) }]),
      )
      // Every hashtag already there: nothing to change, nothing to resend.
      if (!rewrite && written.caption === (post.caption ?? '') && JSON.stringify(captions) === JSON.stringify(post.captions ?? {})) {
        await update(post.id, { error: null, attempts: 0 })
        return
      }
      if (post.status === 'scheduled') {
        if (post.postiz_ids?.[0]) await deleteScheduled(keys.postiz, post)
        await update(post.id, { ...written, captions, postiz_ids: null, status: 'approved', error: null, attempts: 0, retry_at: null })
        resend = true
      } else {
        await update(post.id, { ...written, captions, error: null, attempts: 0 })
      }
    } catch (error) {
      const attempts = post.attempts + 1
      await update(post.id, {
        attempts,
        error:
          attempts >= MAX_ATTEMPTS
            ? `The caption couldn't be ${post.error === REWRITING ? 'written again' : 'given the hashtags'} (${error instanceof Error ? error.message : String(error)}) - it keeps the old one.`
            : post.error,
      })
    } finally {
      await release(id)
    }
    // Back into Postiz with the new caption, at its own time.
    if (resend) await advance(id)
  }
  for (let i = 0; i < ids.length; i += 3) await Promise.all(ids.slice(i, i + 3).map(one))
}

/** What a stopped post says on the Posts screen until Postiz no longer holds
 *  it - and how unpostStopped finds the ones still to take out. */
const STOPPING = 'Stopped - taking it out of Postiz'
const UNPOST_BATCH = 20

/** Every post of one campaign that has not gone out yet, stopped - at once,
 *  in two updates, however many there are. Ones Postiz holds are marked
 *  STOPPING and taken out of Postiz afterwards (unpostStopped), in the
 *  background and on every tick, so a stop of a hundred posts never waits on
 *  a hundred Postiz calls and a run that is cut off finishes by itself.
 *  Only this person's posts of that campaign; ones whose time has come are
 *  left as they are. Nothing stopped can go out: the scheduler only moves
 *  waiting, approved and scheduled posts. */
async function stopCampaign(profile: Profile, body: Record<string, unknown>): Promise<Response> {
  const campaignId = typeof body.campaignId === 'string' ? body.campaignId : ''
  if (!campaignId || campaignId.length > 200) throw new Problem('Which campaign?')
  const { data, error } = await db
    .from('cutter_posts')
    .select('*')
    .eq('profile_id', profile.id)
    .eq('campaign_id', campaignId)
    .in('status', [...PENDING_STATUSES])
  if (error) throw new Problem('Its posts could not be read. Try again.', true, 500)
  return await stopRows(profile, (data ?? []) as Post[])
}

/** The posts he ticked on the Posts screen, stopped the same way - only his
 *  own, and only the ones that have not gone out. */
async function stopPicked(profile: Profile, body: Record<string, unknown>): Promise<Response> {
  const ids = (Array.isArray(body.ids) ? body.ids : []).filter((id): id is string => typeof id === 'string' && /^[0-9a-f-]{36}$/.test(id))
  if (ids.length === 0) throw new Problem('Tick the posts to stop first.')
  if (ids.length > 500) throw new Problem('Stop at most 500 at a time.')
  const rows: Post[] = []
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await db
      .from('cutter_posts')
      .select('*')
      .eq('profile_id', profile.id)
      .in('id', ids.slice(i, i + 200))
      .in('status', [...PENDING_STATUSES])
    if (error) throw new Problem('Those posts could not be read. Try again.', true, 500)
    rows.push(...((data ?? []) as Post[]))
  }
  return await stopRows(profile, rows)
}

/** "Spread my scheduled posts evenly" (respread.ts, his ask on 2026-10-26):
 *  the batch's videos not in Postiz yet, each to its even time on its own
 *  day - only the time changes, nothing is asked of Postiz. One already in
 *  Postiz stays where it is, and so does its day: taking it out and putting
 *  it back took two of Postiz's 30 requests an hour, and his own posts
 *  couldn't get in (2026-10-27). A batch video waits outside Postiz until
 *  half a day before its time (BATCH_LEAD_MS), so all but the next hours'
 *  can still move. Under a minute a call; the phone calls again while `left`
 *  says some are. */
async function respreadBatches(profile: Profile, body: Record<string, unknown>): Promise<Response> {
  const campaignId = typeof body.campaignId === 'string' && /^[\w-]{1,80}$/.test(body.campaignId) ? body.campaignId : null
  let query = db
    .from('cutter_posts')
    .select('*')
    .eq('profile_id', profile.id)
    .not('batch', 'is', null)
    .in('status', [...PENDING_STATUSES, 'posted', 'error'])
    .gte('batch->>date', localDate(new Date(), profile.timezone))
    .limit(3000)
  if (campaignId) query = query.eq('campaign_id', campaignId)
  const { data, error } = await query
  if (error) throw new Problem('The posts could not be read. Try again.', true, 500)
  const rows = (data ?? []) as Post[]
  const { moves, pending } = planRespread(rows as unknown as RespreadRow[], { now: Date.now(), tz: profile.timezone })
  // Their slots freed first: a time one takes may still be another's old one
  // (one video a slot - cutter_posts_one_per_slot).
  const ids = moves.map((m) => m.id)
  for (let i = 0; i < ids.length; i += 200) {
    await db.from('cutter_posts').update({ slot: null }).in('id', ids.slice(i, i + 200)).in('status', [...PENDING_STATUSES])
  }
  const byId = new Map(rows.map((r) => [r.id, r]))
  const deadline = Date.now() + 50 * 1000
  let moved = 0
  let failed = 0
  let tried = 0
  for (const move of moves) {
    if (Date.now() > deadline) break
    const row = byId.get(move.id)!
    tried++
    try {
      const done = await updateIf(row.id, row.status, {
        slot: move.slot,
        batch: { ...row.batch!, time: move.time },
        ...(row.post_at ? { post_at: move.postAt } : {}),
        // Waiting for its time to go into Postiz: worked out again from the
        // new time (schedule) - one moved earlier must not go in late.
        ...(row.status === 'approved' ? { retry_at: null } : {}),
      })
      if (done) moved++
    } catch (error) {
      failed++
      console.error('moving a post to its even time failed', row.id, error)
    }
  }
  return reply({ moved, failed, left: moves.length - tried + pending, paused: false })
}

async function stopRows(profile: Profile, rows: Post[]): Promise<Response> {
  return reply(await stopAll(profile, rows, true))
}

/** Stops these posts; with `unpostNow`, starts taking the ones Postiz holds out
 *  of it straight away (ending a campaign does that itself, before deleting). */
async function stopAll(profile: Profile, rows: Post[], unpostNow: boolean): Promise<{ stopped: number; unposting: number }> {
  const { reject, unpost } = splitStop(rows, Date.now())
  const at = new Date().toISOString()
  // In chunks: the ids go in the request's address, which has a length limit.
  const mark = async (ids: string[], fields: Partial<Post>) => {
    for (let i = 0; i < ids.length; i += 200) {
      const { error: failed } = await db
        .from('cutter_posts')
        .update({ ...fields, status: 'rejected', retry_at: null, updated_at: at })
        .in('id', ids.slice(i, i + 200))
      if (failed) throw new Problem('They could not all be stopped. Press Stop again to finish.', true, 500)
    }
  }
  await mark(reject, { error: null })
  await mark(unpost, { error: STOPPING, attempts: 0 })
  // Their uploaded parts, and Postiz, after the answer.
  const unfinished = rows.filter((p) => reject.includes(p.id) && (p.status === 'uploading' || p.status === 'writing'))
  later(
    (async () => {
      for (const post of unfinished) await removeParts(post).catch(() => {})
      // Out of Buffer too, and the copies kept for a Buffer backup.
      const matched = backupFor(profile)
      for (const post of rows.filter((p) => p.buffer_ids || p.accounts.some((a) => matched[a.id]))) {
        if (post.buffer_ids) await dropFromBuffer(profile, post).catch((error) => console.error('taking a post out of Buffer failed', post.id, error))
        await removeParts(post).catch(() => {})
      }
      // A batch at a time until none is left. A batch that takes nothing
      // out (Postiz refusing) stops the loop; the tick tries those again.
      while (unpostNow && (await unpostStopped(profile.id)) > 0) {
        /* next batch */
      }
    })(),
  )
  return { stopped: reject.length + unpost.length, unposting: unpost.length }
}

/** Takes up to one batch of stopped posts out of Postiz; how many it took out.
 *  A post Postiz will not let go of is tried again on the next ticks, then
 *  left with a plain message to delete it in Postiz - never silently. */
async function unpostStopped(profileId?: string): Promise<number> {
  let query = db.from('cutter_posts').select('*').eq('status', 'rejected').eq('error', STOPPING).limit(UNPOST_BATCH)
  if (profileId) query = query.eq('profile_id', profileId)
  const { data } = await query
  const posts = (data ?? []) as Post[]
  const keys = new Map<string, string>()
  let done = 0
  for (const post of posts) {
    try {
      if (!keys.has(post.profile_id)) keys.set(post.profile_id, (await keysFor(post.profile_id)).postiz)
      if (post.postiz_ids?.[0]) await deleteScheduled(keys.get(post.profile_id)!, post)
      await update(post.id, { postiz_ids: null, error: null })
      done++
    } catch (error) {
      const attempts = post.attempts + 1
      await update(post.id, {
        attempts,
        error:
          attempts >= MAX_ATTEMPTS
            ? `Couldn't take it out of Postiz (${error instanceof Error ? error.message : String(error)}) - delete it there.`
            : STOPPING,
      })
    }
  }
  return done
}

// --- Ending a campaign ----------------------------------------------------------
//
// When a campaign ends its accounts come out of Postiz, so they stop counting
// toward the plan's channel limit (channels.ts endPlan says which may). Its
// posts are stopped first; the accounts are deleted once Postiz holds none of
// its posts half-taken-out, in the background and again on each tick, so a
// big campaign never waits on the phone and a cut-off run finishes by itself.

/** Campaign names from the phone, for the reasons it shows. */
function cleanNames(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {}
  const out: Record<string, string> = {}
  for (const [id, name] of Object.entries(value as Record<string, unknown>).slice(0, 300)) {
    if (typeof name === 'string' && id.length <= 200) out[id] = name.slice(0, 120)
  }
  return out
}

async function endInputs(profile: Profile, campaignId: string, accountIds: string[], key: string, names: Record<string, string>) {
  const now = Date.now()
  const [integrations, { data: pending, error }, { data: own }, { data: others }, upcoming] = await Promise.all([
    listAccounts(key),
    db.from('cutter_posts').select('*').eq('profile_id', profile.id).in('status', [...PENDING_STATUSES]).limit(3000),
    db.from('cutter_posts').select('postiz_ids').eq('profile_id', profile.id).eq('campaign_id', campaignId).not('postiz_ids', 'is', null).limit(3000),
    db.from('cutter_profiles').select('settings').eq('space_id', profile.space_id).neq('id', profile.id),
    postsAround(key, now - 60 * MINUTE, now + 120 * 24 * 60 * MINUTE),
  ])
  if (error) throw new Problem('Its posts could not be read. Try again.', true, 500)
  const posts = (pending ?? []) as Post[]
  const plan = endPlan({
    campaignId,
    accountIds,
    campaigns: profile.settings.campaigns ?? {},
    // The phone's list of campaigns (with this one, or it isn't trusted as whole).
    known: names[campaignId] ? new Set(Object.keys(names)) : undefined,
    otherProfiles: ((others ?? []) as Pick<Profile, 'settings'>[]).map((p) => p.settings?.campaigns ?? {}),
    integrations: integrations as Integration[],
    posts: posts as unknown as EndPost[],
    ownPostiz: new Set(((own ?? []) as Pick<Post, 'postiz_ids'>[]).flatMap((p) => (p.postiz_ids ?? []).map((ref) => ref.postId))),
    upcoming: upcoming.map((u) => ({ id: u.id, integration: u.integration?.id ?? '', publishDate: u.publishDate ?? null, state: u.state ?? null })),
    names: new Map(Object.entries(names)),
    now,
  })
  return { plan, integrations, posts }
}

const endedAccount = (a: Pick<Account, 'name' | 'platform' | 'profile'>): EndedAccount => ({ name: a.name, platform: a.platform, profile: a.profile })

/** Changes only what `change` touches, on the settings as they are now. */
async function patchSettings(profileId: string, change: (settings: Profile['settings']) => Profile['settings']): Promise<Profile> {
  const { data: fresh } = await db.from('cutter_profiles').select('*').eq('id', profileId).single()
  const current = (fresh as Profile).settings ?? {}
  const { data, error } = await db
    .from('cutter_profiles')
    .update({ settings: change({ ...current }), updated_at: new Date().toISOString() })
    .eq('id', profileId)
    .select('*')
    .single()
  if (error || !data) throw new Problem('It could not be saved. Try again.', true, 500)
  return data as Profile
}

async function endCampaign(profile: Profile, body: Record<string, unknown>): Promise<Response> {
  const campaignId = typeof body.campaignId === 'string' ? body.campaignId : ''
  if (!campaignId || campaignId.length > 200) throw new Problem('Which campaign?')
  const names = cleanNames(body.names)
  const accountIds = [...new Set(profile.settings.campaigns?.[campaignId]?.accounts ?? [])]
  const { postiz: key } = await keysFor(profile.id)
  const { plan, integrations, posts } = await endInputs(profile, campaignId, accountIds, key, names)
  const now = Date.now()
  const mine = posts.filter((p) => p.campaign_id === campaignId && isPending(p, now))

  if (!Array.isArray(body.confirm)) {
    return reply({
      plan: {
        remove: plan.remove.map((a) => ({ id: a.id, ...endedAccount(a) })),
        keep: plan.keep.map((k) => ({ id: k.account.id, ...endedAccount(k.account), why: k.why })),
        gone: plan.gone.length,
      },
      stopping: mine.length,
      connected: integrations.filter((i) => !i.disabled).length,
    })
  }

  // Only what he was shown, and only what may still come out.
  const confirmed = new Set(body.confirm.filter((id): id is string => typeof id === 'string'))
  const removing = plan.remove.filter((a) => confirmed.has(a.id)).map((a) => a.id)
  // With accounts to delete, finishEnding takes its posts out of Postiz first.
  const { stopped } = await stopAll(profile, mine, removing.length === 0)
  const leaving = new Set([...removing, ...plan.gone])
  const saved = await patchSettings(profile.id, (settings) => {
    const campaigns = { ...settings.campaigns }
    const place = campaigns[campaignId]
    // Unticked at once: nothing new of it is sent to them while they go.
    if (place) campaigns[campaignId] = { ...place, accounts: (place.accounts ?? []).filter((id) => !leaving.has(id)) }
    const ended = { ...settings.ended }
    delete ended[campaignId]
    const ending = { ...settings.ending }
    if (removing.length > 0) ending[campaignId] = { accounts: removing, names, at: new Date().toISOString() }
    return { ...settings, campaigns, ending, ended }
  })
  if (removing.length > 0) later(finishEnding(profile.id))
  return reply({ stopped, removing: removing.length, profile: await profileView(saved) })
}

/** Deletes the accounts of every campaign this login is ending, once Postiz
 *  holds none of its stopped posts; records what it did. */
async function finishEnding(profileId: string): Promise<void> {
  const { data } = await db.from('cutter_profiles').select('*').eq('id', profileId).maybeSingle()
  if (!data) return
  const profile = data as Profile
  const jobs = Object.entries(profile.settings.ending ?? {})
  if (jobs.length === 0) return
  // Its posts Postiz holds come out first, one by one, as a stop does.
  while ((await unpostStopped(profileId)) > 0) {
    /* next batch */
  }
  const { postiz: key } = await keysFor(profileId)
  for (const [campaignId, job] of jobs) {
    const { count } = await db
      .from('cutter_posts')
      .select('id', { count: 'exact', head: true })
      .eq('profile_id', profileId)
      .eq('campaign_id', campaignId)
      .eq('status', 'rejected')
      .eq('error', STOPPING)
    const attempts = (job.attempts ?? 0) + 1
    // Postiz refusing to let go of a post right now: the next tick tries again
    // (deleting the account takes it with it in the end).
    if ((count ?? 0) > 0 && attempts < MAX_ATTEMPTS) {
      await patchSettings(profileId, (s) => ({ ...s, ending: { ...s.ending, [campaignId]: { ...job, attempts } } }))
      continue
    }
    // Asked again now: something may have been scheduled on one since.
    const { plan } = await endInputs(profile, campaignId, job.accounts, key, job.names)
    const removed: Account[] = []
    const failed: { account: Account; error: unknown }[] = []
    for (const account of plan.remove) {
      try {
        await postiz(key, 'DELETE', `/integrations/${encodeURIComponent(account.id)}`)
        removed.push(account as Account)
      } catch (error) {
        failed.push({ account: account as Account, error })
      }
    }
    // Postiz busy or out of reach: those are tried again on the next ticks.
    const retry = failed.filter((f) => f.error instanceof Problem && f.error.later && attempts < MAX_ATTEMPTS)
    // Its stopped posts on those accounts went with them.
    const gone = new Set(removed.map((a) => a.id))
    const { data: left } = await db
      .from('cutter_posts')
      .select('id, accounts')
      .eq('profile_id', profileId)
      .eq('campaign_id', campaignId)
      .eq('status', 'rejected')
      .not('error', 'is', null)
      .not('postiz_ids', 'is', null)
      .limit(500)
    for (const row of (left ?? []) as Pick<Post, 'id' | 'accounts'>[]) {
      if (row.accounts.length > 0 && row.accounts.every((a) => gone.has(a.id))) await update(row.id, { error: null, postiz_ids: null })
    }
    // What stays in Postiz goes back on the campaign, so ending it again later can take it out.
    const back = [...plan.keep.filter((k) => k.later).map((k) => k.account.id), ...failed.filter((f) => !retry.includes(f)).map((f) => f.account.id)]
    await patchSettings(profileId, (s) => {
      const campaigns = { ...s.campaigns }
      const place = campaigns[campaignId]
      if (back.length > 0) {
        campaigns[campaignId] = { ...place, times: place?.times ?? [], accounts: [...new Set([...(place?.accounts ?? []), ...back])] }
      }
      const ending = { ...s.ending }
      if (retry.length > 0) ending[campaignId] = { ...job, accounts: retry.map((f) => f.account.id), attempts }
      else delete ending[campaignId]
      // A retry adds to what this ending already took out.
      const before = s.ended?.[campaignId]
      const carried = before && before.at >= job.at ? before.removed : []
      const result: EndedResult = {
        at: new Date().toISOString(),
        removed: [...carried, ...removed.map(endedAccount)],
        kept: plan.keep.map((k) => ({ ...endedAccount(k.account), why: k.why })),
        failed: failed
          .filter((f) => !retry.includes(f))
          .map((f) => ({ ...endedAccount(f.account), error: f.error instanceof Error ? f.error.message : String(f.error) })),
      }
      const limits = s.limits ? { ...s.limits, accounts: Object.fromEntries(Object.entries(s.limits.accounts ?? {}).filter(([id]) => !gone.has(id))) } : s.limits
      const next: Profile['settings'] = { ...s, campaigns, limits, ended: { ...s.ended, [campaignId]: result } }
      if (Object.keys(ending).length > 0) next.ending = ending
      else delete next.ending
      return next
    })
  }
  await refreshAccounts(profile).catch(() => {})
}

/** The tick's share: every login still ending a campaign. */
async function finishEndings(): Promise<void> {
  const { data } = await db.from('cutter_profiles').select('id').not('settings->ending', 'is', null).limit(10)
  for (const row of data ?? []) await finishEnding(row.id).catch((error) => console.error('ending a campaign failed', error))
}

// --- The scheduler ------------------------------------------------------------

/** How long before its time a batch video goes into Postiz (schedule): a
 *  steady few an hour around the clock, never a week's at once. Over the
 *  Buffer backup's few hours (HAND_AHEAD_MS), so a Postiz outage still has
 *  hours of tries before Buffer takes it. */
const BATCH_LEAD_MS = 12 * 60 * MINUTE

/** What an approved post far ahead says while Postiz won't take it: the
 *  tick asks again (probePostiz), and Buffer takes it before its time. */
const POSTIZ_WAIT = "Approved - Postiz didn't take it yet, so it tries again by itself. Buffer posts it a few hours before its time if Postiz still can't."
/** Matches POSTIZ_WAIT and what such a post said before it. */
const POSTIZ_WAIT_LIKE = "%a few hours before its time if Postiz still can't%"
/** How often a profile's posts waiting on Postiz ask it again: Postiz allows
 *  about 30 questions an hour, and posting needs them. */
const PROBE_EVERY_MS = 30 * MINUTE

/** Approved posts far ahead that Postiz turned down (POSTIZ_WAIT) used to sit
 *  until a few hours before their time - days, after an outage - looking
 *  stuck. Now one of them asks Postiz again every half hour per profile, and
 *  the moment one gets in, the rest follow. */
async function probePostiz(now: number): Promise<void> {
  const { data } = await db
    .from('cutter_posts')
    .select('id, profile_id, post_at, updated_at')
    .eq('status', 'approved')
    .like('error', POSTIZ_WAIT_LIKE)
    .gt('retry_at', new Date(now).toISOString())
    .order('post_at', { ascending: true })
    .limit(500)
  const byProfile = new Map<string, Pick<Post, 'id' | 'profile_id' | 'post_at' | 'updated_at'>[]>()
  for (const row of (data ?? []) as Pick<Post, 'id' | 'profile_id' | 'post_at' | 'updated_at'>[]) {
    byProfile.set(row.profile_id, [...(byProfile.get(row.profile_id) ?? []), row])
  }
  for (const [profileId, rows] of byProfile) {
    // Asked within the last half hour: not again yet. Its own note of when:
    // the waiting posts' last change was the clock before, and a respread
    // moving them held it back all day (2026-10-26).
    const key = `probe:${profileId}`
    const { data: last } = await db.from('cutter_config').select('value').eq('key', key).maybeSingle()
    if (now - (Number((last as { value: string } | null)?.value) || 0) < PROBE_EVERY_MS) continue
    await db.from('cutter_config').upsert({ key, value: String(now) }, { onConflict: 'key' })
    if (postizBusyFor(profileId)) continue
    await advance(rows[0].id)
    const after = await reload(rows[0].id).catch(() => null)
    if (after?.status !== 'scheduled') continue
    // Postiz answers again: the rest go now, a few each tick.
    await db
      .from('cutter_posts')
      .update({ retry_at: new Date(now).toISOString() })
      .eq('profile_id', profileId)
      .eq('status', 'approved')
      .like('error', POSTIZ_WAIT_LIKE)
  }
}

async function tick(): Promise<void> {
  const now = Date.now()
  const iso = (ms: number) => new Date(ms).toISOString()

  // Whatever is due to be tried again, or was left half-way - the soonest to
  // go out first: when Postiz takes only so many an hour (2026-10-26: 245
  // waiting to go back in after a respread), those are the ones that matter.
  const { data: due } = await db
    .from('cutter_posts')
    .select('id, profile_id, batch, retry_at, updated_at')
    .in('status', ['writing', 'approved'])
    .or(`retry_at.is.null,retry_at.lte.${iso(now)}`)
    .lt('updated_at', iso(now - 2 * MINUTE))
    .order('post_at', { ascending: true, nullsFirst: true })
    .limit(60)
  let tried = 0
  for (const row of (due ?? []) as { id: string; profile_id: string; batch: Post['batch'] }[]) {
    if (tried >= 10) break
    // That login's Postiz just said "too many": its rest wait for a later
    // tick, and the other logins' go meanwhile - his own posts too, while
    // only the batch's share is used.
    if (postizBusyFor(row.profile_id, Boolean(row.batch))) continue
    tried++
    await advance(row.id)
  }
  await probePostiz(now).catch((error) => console.error('asking Postiz again failed', error))

  // Uploads that never finished, after two days: the phone gave up on them.
  const { data: abandoned } = await db
    .from('cutter_posts')
    .select('*')
    .eq('status', 'uploading')
    .lt('created_at', iso(now - 2 * 24 * 60 * MINUTE))
    .limit(20)
  for (const post of (abandoned ?? []) as Post[]) {
    await removeParts(post).catch(() => {})
    await update(post.id, { status: 'failed', error: 'The video never finished uploading.' })
  }

  // Batches whose notification is still owed - some videos never came.
  const { data: untold } = await db
    .from('cutter_posts')
    .select('profile_id, batch')
    .eq('status', 'waiting')
    .eq('batch_told', false)
    .not('batch', 'is', null)
    .lt('updated_at', iso(now - 20 * MINUTE))
    .limit(50)
  const owed = new Map<string, string>()
  for (const row of (untold ?? []) as Pick<Post, 'profile_id' | 'batch'>[]) if (row.batch) owed.set(row.batch.id, row.profile_id)
  for (const [batchId, profileId] of owed) await notifyBatch(profileId, batchId, true)

  await releaseHeld(now)
  // Stopped posts Postiz still holds - a stop's own run may have been cut off.
  await unpostStopped()
  // Ended campaigns whose accounts are still to come out of Postiz.
  await finishEndings()
  // Captions marked to be written again with a campaign's new rules.
  await rewriteMarked()
  await checkPosted(now)
  await giveUpUnconfirmed(now)
  // Buffer, the backup: what Postiz holds while "Postiz is down" is on, what
  // Buffer has posted, and Postiz's copies of what went through Buffer.
  await handOver(now).catch((error) => console.error('handing over to Buffer failed', error))
  await checkBuffer(now).catch((error) => console.error('checking Buffer failed', error))
  await unpostHanded().catch((error) => console.error('taking handed-over posts out of Postiz failed', error))
  await remindReposts(now)
  await remind(now)
  await refreshViews(now).catch((error) => console.error('reading views failed', error))
  await refreshPostViews(now).catch((error) => console.error('reading post views failed', error))

  // "Posts to approve" held back while he was told a moment ago.
  const { data: pending } = await db.from('cutter_profiles').select('id').eq('push_pending', true).limit(20)
  for (const row of pending ?? []) await sendWaiting(row.id)
}

// --- Views, for Analytics (views.ts) ---------------------------------------------

const viewsKey = (profileId: string) => `views:${profileId}`

async function loadViews(profileId: string): Promise<ViewsCache> {
  const { data } = await db.from('cutter_config').select('value').eq('key', viewsKey(profileId)).maybeSingle()
  return parseCache(data?.value)
}

async function saveViews(profileId: string, cache: ViewsCache): Promise<void> {
  await db.from('cutter_config').upsert({ key: viewsKey(profileId), value: JSON.stringify(cache) }, { onConflict: 'key' })
}

/** How many videos the Cutter posted to an account in the views window.
 *  `accounts` is jsonb: the filter wants it as JSON text - given as an array
 *  it became `cs.{[object Object]}`, an error read as 0, so no Instagram
 *  account ever had views per video and Analytics stayed empty. */
async function postedThere(profileId: string, accountId: string, now: number): Promise<number> {
  const { count, error } = await db
    .from('cutter_posts')
    .select('id', { count: 'exact', head: true })
    .eq('profile_id', profileId)
    .eq('status', 'posted')
    .gte('post_at', new Date(now - VIEWS_WINDOW_DAYS * 24 * 60 * MINUTE).toISOString())
    .contains('accounts', JSON.stringify([{ id: accountId }]))
  if (error) throw new Problem(`The videos posted there couldn't be counted: ${error.message}`, true, 500)
  return count ?? 0
}

/** The tick's share of Analytics: the one account whose views are most due,
 *  read from Postiz. One question a tick, about once a day per account, so
 *  reading views never takes what posting needs from Postiz's hourly
 *  allowance. Only accounts a campaign posts to are read. */
async function refreshViews(now: number): Promise<void> {
  const [{ data: profiles }, { data: saved }] = await Promise.all([
    db.from('cutter_profiles').select('id, accounts, settings'),
    db.from('cutter_config').select('key, value').like('key', 'views:%'),
  ])
  const caches = new Map((saved ?? []).map((row: { key: string; value: string }) => [row.key, parseCache(row.value)]))
  let pick: { profileId: string; account: Account; cache: ViewsCache; due: number } | null = null
  for (const row of (profiles ?? []) as Pick<Profile, 'id' | 'accounts' | 'settings'>[]) {
    const inUse = new Set(Object.values(row.settings?.campaigns ?? {}).flatMap((c) => c.accounts ?? []))
    const cache = caches.get(viewsKey(row.id)) ?? { accounts: {} }
    for (const account of row.accounts ?? []) {
      if (account.disabled || !inUse.has(account.id)) continue
      const due = dueAt(cache.accounts[account.id])
      if (due <= now && (!pick || due < pick.due)) pick = { profileId: row.id, account, cache, due }
    }
  }
  if (!pick) return
  const { profileId, account, cache } = pick
  try {
    const { postiz: key } = await keysFor(profileId)
    const metrics = await postiz<unknown>(key, 'GET', `/analytics/${encodeURIComponent(account.id)}?date=${VIEWS_WINDOW_DAYS}`, undefined, 'read')
    const posted = await postedThere(profileId, account.id, now)
    cache.accounts[account.id] = remember(cache.accounts[account.id], readViews(account.platform, metrics, posted), new Date(now))
  } catch (error) {
    // Too many questions this hour: left as it was, for a later tick.
    if (error instanceof Problem && error.status === 429) return
    cache.accounts[account.id] = notRead(cache.accounts[account.id], error instanceof Error ? error.message : String(error), new Date(now))
  }
  await saveViews(profileId, cache)
}

/** One posted video's views, per account, when it is due a reading - a day,
 *  three days and a week after it went out (postViews.ts). One video a tick,
 *  so the hourly allowance posting needs is never used up; a 429 leaves it
 *  for a later tick. An answer that can't be read keeps a short sample in
 *  cutter_config (`postviews:unread`), to see what Postiz sent. */
async function refreshPostViews(now: number): Promise<void> {
  const { data } = await db
    .from('cutter_posts')
    .select('id, profile_id, post_at, views, views_at, accounts, postiz_ids')
    .eq('status', 'posted')
    .not('postiz_ids', 'is', null)
    .gte('post_at', new Date(now - POST_VIEW_MAX_DAYS * 24 * 60 * MINUTE).toISOString())
    .lte('post_at', new Date(now - POST_VIEW_AGES_H[0] * 60 * MINUTE).toISOString())
    .order('views_at', { ascending: true, nullsFirst: true })
    .limit(50)
  const post = ((data ?? []) as Pick<Post, 'id' | 'profile_id' | 'post_at' | 'views' | 'views_at' | 'accounts' | 'postiz_ids'>[]).find(
    (p) => p.post_at !== null && postViewsDue(p.post_at, p.views_at, now),
  )
  if (!post) return
  const { postiz: key } = await keysFor(post.profile_id)
  const views: Record<string, number> = { ...post.views }
  let unread: unknown
  for (const ref of post.postiz_ids ?? []) {
    try {
      const answer = await postiz<unknown>(key, 'GET', `/analytics/post/${encodeURIComponent(ref.postId)}?date=30`, undefined, 'read')
      const count = postViewCount(answer)
      if (count === null) unread = answer
      else views[accountNameFor(post.accounts, ref.integration)] = count
    } catch (error) {
      if (error instanceof Problem && error.status === 429) return
      // The platform gives none for it (yet): read again at the next age.
    }
  }
  if (unread !== undefined) {
    await db.from('cutter_config').upsert({ key: 'postviews:unread', value: JSON.stringify(unread ?? null).slice(0, 2000) }, { onConflict: 'key' })
  }
  await update(post.id, { views, views_at: new Date(now).toISOString() })
}

/** What the Analytics tab shows: this login's accounts' views as last read.
 *  One read before the count was fixed gets its views per video here, from
 *  what it read and the videos posted there (fillPerVideo), and keeps it. */
async function views(profile: Profile): Promise<Response> {
  const cache = await loadViews(profile.id)
  const now = Date.now()
  let filled = false
  for (const account of profile.accounts ?? []) {
    const entry = cache.accounts[account.id]
    if (!entry || entry.perVideo !== null || entry.views === null || account.platform.startsWith('tiktok')) continue
    const next = fillPerVideo(entry, account.platform, await postedThere(profile.id, account.id, Date.parse(entry.at) || now).catch(() => 0))
    if (next !== entry) {
      cache.accounts[account.id] = next
      filled = true
    }
  }
  if (filled) await saveViews(profile.id, cache)
  return reply({ accounts: cache.accounts })
}

/** Asks Postiz how the posts that were due went: posted (with links), or
 *  failed on the platform. One question per person, a few times at most. */
async function checkPosted(now: number): Promise<void> {
  // Every 8 minutes for the first six looks, then hourly, for three days:
  // a post Postiz publishes late used to stay "Scheduled" for ever once
  // the six looks were spent (one from 2026-10-16 still was a week on).
  const { data } = await db
    .from('cutter_posts')
    .select('*')
    .eq('status', 'scheduled')
    .lt('post_at', new Date(now - 2 * MINUTE).toISOString())
    .gt('post_at', new Date(now - UNCONFIRMED_MS).toISOString())
    .or(
      `checked_at.is.null,and(checks.lt.6,checked_at.lt.${new Date(now - 8 * MINUTE).toISOString()}),checked_at.lt.${new Date(now - 60 * MINUTE).toISOString()}`,
    )
    .limit(100)
  const byProfile = new Map<string, Post[]>()
  // Gone through Buffer on every account: checkBuffer follows those.
  for (const post of ((data ?? []) as Post[]).filter((p) => !viaBufferOnly(p))) {
    byProfile.set(post.profile_id, [...(byProfile.get(post.profile_id) ?? []), post])
  }
  for (const [profileId, posts] of byProfile) {
    try {
      const { postiz: key } = await keysFor(profileId)
      const times = posts.map((p) => new Date(p.post_at!).getTime())
      const found = await postsAround(key, Math.min(...times) - 60 * MINUTE, Math.max(...times) + 60 * MINUTE, 'read')
      const byId = new Map(found.map((p) => [p.id, p]))
      for (const post of posts) {
        const mine = (post.postiz_ids ?? []).map((ref) => byId.get(ref.postId)).filter((p): p is PostizPost => Boolean(p))
        const links: Record<string, string> = { ...(post.release_urls ?? {}) }
        for (const p of mine) {
          if (!p.releaseURL || !p.integration?.name) continue
          // Two accounts can share a name: each keeps its own link.
          const account = post.accounts.find((a) => a.id === p.integration?.id)
          links[accountName(account?.name ?? p.integration.name, account?.platform ?? p.integration.providerIdentifier, post.accounts)] = p.releaseURL
        }
        const errored = mine.filter((p) => p.state === 'ERROR')
        const published = mine.length > 0 && mine.every((p) => p.state === 'PUBLISHED' || p.state === 'ERROR') && errored.length < mine.length
        const fields: Partial<Post> = { checked_at: new Date().toISOString(), checks: post.checks + 1, release_urls: links }
        if (errored.length > 0 && !published) {
          fields.status = 'error'
          fields.error = `Postiz couldn't publish it to ${notPostedNote(errored, post.accounts).replace(/^Not posted to |\.$/g, '')}. Open Postiz to see why.`
        } else if (published) {
          fields.status = 'posted'
          if (!post.repost_of) {
            const due = repostDueAt(Date.now(), post.rules.repost)
            if (due !== null && !post.reposted_at) fields.repost_at = new Date(due).toISOString()
          }
          if (errored.length > 0) fields.error = notPostedNote(errored, post.accounts)
        }
        const saved = await update(post.id, fields)
        // A copy kept for a Buffer backup is no longer needed.
        if (saved.status !== 'scheduled') await removeParts(saved).catch(() => {})
        if (saved.status === 'error') {
          await notify(profileId, { title: `${post.campaign_name}: not posted`, body: saved.error ?? '', tag: `error-${post.id}` })
        }
      }
    } catch (error) {
      console.error('check failed', profileId, error instanceof Error ? error.message : String(error))
    }
  }
}

/** How long a scheduled post is asked after before it is given up on. */
const UNCONFIRMED_MS = 3 * 24 * 60 * MINUTE

/** A post Postiz never confirmed in three days of asking is marked so,
 *  instead of sitting in Scheduled with nothing to do about it. */
async function giveUpUnconfirmed(now: number): Promise<void> {
  const { data } = await db
    .from('cutter_posts')
    .select('*')
    .eq('status', 'scheduled')
    .lt('post_at', new Date(now - UNCONFIRMED_MS).toISOString())
    .gte('checks', 6)
    .limit(50)
  for (const post of (data ?? []) as Post[]) {
    const saved = await update(post.id, {
      status: 'error',
      error: 'Postiz never said whether it went out. Open Postiz to see; Post again sends it again.',
      checked_at: new Date(now).toISOString(),
    })
    await removeParts(saved).catch(() => {})
  }
}

/** Every account of the post went through Buffer instead of Postiz. */
function viaBufferOnly(post: Post): boolean {
  return post.accounts.length > 0 && post.accounts.every((a) => post.buffer_ids?.[a.id])
}

/** Posts that went through Buffer: posted once Buffer has sent them all, with
 *  their links - and then the server's copy of the video goes. */
async function checkBuffer(now: number): Promise<void> {
  const { data } = await db
    .from('cutter_posts')
    .select('*')
    .eq('status', 'scheduled')
    .not('buffer_ids', 'is', null)
    .lt('post_at', new Date(now - 2 * MINUTE).toISOString())
    .lt('checks', 12)
    .or(`checked_at.is.null,checked_at.lt.${new Date(now - 8 * MINUTE).toISOString()}`)
    .limit(30)
  const profiles = new Map<string, { profile: Profile; keys: string[] }>()
  for (const post of ((data ?? []) as Post[]).filter(viaBufferOnly)) {
    try {
      if (!profiles.has(post.profile_id)) {
        const { data: row } = await db.from('cutter_profiles').select('*').eq('id', post.profile_id).single()
        profiles.set(post.profile_id, { profile: row as Profile, keys: await bufferKeysFor(post.profile_id) })
      }
      const { profile, keys } = profiles.get(post.profile_id)!
      const channels = profile.settings.backup?.channels ?? []
      const refs = { ...post.buffer_ids! }
      const links: Record<string, string> = { ...(post.release_urls ?? {}) }
      for (const account of post.accounts) {
        const ref = refs[account.id]
        if (ref.status === 'sent' || ref.status === 'error') continue
        const key = keys[channels.find((c) => c.id === ref.channelId)?.key ?? -1]
        if (!key) continue
        const read = await readBufferPost(key, ref.postId)
        refs[account.id] = { ...ref, status: read.status, ...(read.link ? { link: read.link } : {}) }
        if (read.link) links[accountName(account.name, account.platform, post.accounts)] = read.link
      }
      const fields: Partial<Post> = { buffer_ids: refs, release_urls: links, checked_at: new Date().toISOString(), checks: post.checks + 1 }
      if (post.accounts.every((a) => refs[a.id].status === 'sent' || refs[a.id].status === 'error')) {
        const errored = post.accounts.filter((a) => refs[a.id].status === 'error')
        const names = errored.map((a) => a.name).join(', ')
        if (errored.length === post.accounts.length) {
          fields.status = 'error'
          fields.error = `Buffer couldn't post it to ${names}. Open Buffer to see why.`
        } else {
          fields.status = 'posted'
          if (!post.repost_of) {
            const due = repostDueAt(Date.now(), post.rules.repost)
            if (due !== null && !post.reposted_at) fields.repost_at = new Date(due).toISOString()
          }
          if (errored.length > 0) fields.error = `Not posted to ${names} (Buffer couldn't).`
        }
      }
      const saved = await update(post.id, fields)
      if (saved.status !== 'scheduled') await removeParts(saved).catch(() => {})
      if (saved.status === 'error') {
        await notify(post.profile_id, { title: `${post.campaign_name}: not posted`, body: saved.error ?? '', tag: `error-${post.id}` })
      }
    } catch (error) {
      console.error('buffer check failed', post.id, error instanceof Error ? error.message : String(error))
      await update(post.id, { checked_at: new Date().toISOString(), checks: post.checks + 1 }).catch(() => {})
    }
  }
}

/** "Postiz is down" switched on: the posts Postiz holds on accounts all backed
 *  up by Buffer go through Buffer instead - a few hours before their time, or,
 *  missed in the last two hours, from now on, apart (handOverPlan) - and come
 *  out of Postiz once it answers again (unpostHanded), so none goes twice. A
 *  post with an account Buffer doesn't back up stays with Postiz: Postiz can
 *  only take a post out whole. */
async function handOver(now: number): Promise<void> {
  const { data: profiles } = await db.from('cutter_profiles').select('*').eq('settings->backup->>active', 'true').limit(20)
  for (const profile of (profiles ?? []) as Profile[]) {
    const matched = backupFor(profile)
    if (Object.keys(matched).length === 0) continue
    const { data } = await db
      .from('cutter_posts')
      .select('*')
      .eq('profile_id', profile.id)
      .eq('status', 'scheduled')
      .gte('post_at', new Date(now - MISSED_MS).toISOString())
      .lte('post_at', new Date(now + HAND_AHEAD_MS).toISOString())
      .limit(50)
    // Never one with a paused or capped account: that waits for its turn as before.
    const posts = ((data ?? []) as Post[]).filter(
      (p) =>
        p.accounts.length > 0 &&
        p.accounts.every((a) => matched[a.id] && !a.held) &&
        p.accounts.some((a) => !p.buffer_ids?.[a.id]),
    )
    // Earliest first, while each channel has room: the rest on a later tick.
    const room = await bufferRoom(profile)
    for (const { post, dueAt } of handOverPlan(posts, now)) {
      if (post.accounts.some((a) => (room.get(matched[a.id].id) ?? 0) <= 0)) continue
      const claimed = await claim(post.id)
      if (!claimed) continue
      try {
        const { post: handed, problems } = await toBuffer(profile, claimed, claimed.accounts, dueAt, room)
        if (viaBufferOnly(handed)) await update(handed.id, { post_at: new Date(dueAt).toISOString(), error: null, checks: 0, checked_at: null })
        else if (problems.length > 0) await update(handed.id, { error: `Couldn't go through Buffer: ${problems.join(' ')}` })
      } catch (error) {
        await update(post.id, { error: `Couldn't go through Buffer: ${error instanceof Error ? error.message : String(error)}` }).catch(() => {})
      } finally {
        await release(post.id)
      }
    }
  }
}

/** Posts handed to Buffer that Postiz still holds: taken out of Postiz as
 *  soon as it answers, a few each tick. */
async function unpostHanded(): Promise<void> {
  const { data } = await db
    .from('cutter_posts')
    .select('*')
    .in('status', ['scheduled', 'posted', 'error'])
    .not('buffer_ids', 'is', null)
    .not('postiz_ids', 'is', null)
    .order('updated_at', { ascending: true })
    .limit(10)
  for (const post of ((data ?? []) as Post[]).filter(viaBufferOnly)) {
    try {
      if (post.postiz_ids?.[0]) await deleteScheduled((await keysFor(post.profile_id)).postiz, post)
      await update(post.id, { postiz_ids: null })
    } catch {
      // Postiz still down: to the back of the line, for a later tick.
      await update(post.id, {}).catch(() => {})
    }
  }
}

/** Pump.fun pays only if he submits within two hours of it going live: the
 *  moment it is live (or twenty minutes after its time, if Postiz hasn't
 *  said), he is told, with the link when there is one. */
async function remind(now: number): Promise<void> {
  const { data } = await db
    .from('cutter_posts')
    .select('*')
    .in('status', ['scheduled', 'posted'])
    .is('reminded_at', null)
    .lt('post_at', new Date(now).toISOString())
    .gt('post_at', new Date(now - 6 * 60 * MINUTE).toISOString())
    .limit(50)
  for (const post of (data ?? []) as Post[]) {
    if (!post.rules.remind) continue
    const live = post.status === 'posted'
    if (!live && new Date(post.post_at!).getTime() > now - 20 * MINUTE) continue
    const link = Object.values(post.release_urls ?? {})[0]
    await update(post.id, { reminded_at: new Date().toISOString() })
    await notify(post.profile_id, {
      title: `Submit your ${post.campaign_name} video now`,
      body: `It's ${live ? 'live' : 'going out'} - submit it within 2 hours to get paid.`,
      tag: `remind-${post.id}`,
      url: link ?? `/campaign.html#posts`,
    })
  }
}

/** Reposting is the platform's own button (TikTok, Instagram), which Postiz
 *  cannot press for him and neither can this app. So when a repost is due -
 *  the campaign's opt-in, N days after the post went live - he is told, with
 *  the post's link, and does it himself in a couple of taps. Told once per
 *  post; `reposted_at` records when, and the Posts screen shows "Time to
 *  repost" for a few days after. */
async function remindReposts(now: number): Promise<void> {
  const { data } = await db
    .from('cutter_posts')
    .select('*')
    .eq('status', 'posted')
    .is('reposted_at', null)
    .not('repost_at', 'is', null)
    .lte('repost_at', new Date(now).toISOString())
    .limit(50)
  for (const post of (data ?? []) as Post[]) {
    // Marked first: a run that stops half-way never tells him twice.
    await db.from('cutter_posts').update({ reposted_at: new Date().toISOString() }).eq('id', post.id).is('reposted_at', null)
    if (!post.rules.repost?.on) continue
    const link = Object.values(post.release_urls ?? {})[0]
    await notify(post.profile_id, {
      title: `Time to repost your ${post.campaign_name} video`,
      body: `It went live ${post.rules.repost.afterDays} days ago - open it and tap Repost.`,
      tag: `repost-${post.id}`,
      url: link ?? `/campaign.html#posts`,
    })
  }
}

// --- The planner's bridge -----------------------------------------------------
//
// The planner (ugc-planner, same Supabase project) asks which Postiz channels
// a finished campaign still holds, so he can free them on his 30-channel plan
// (its planner-postiz function, owner only). Server to server: the planner
// function proves itself with the project's service key, which this function
// already holds and which already seals every key in cutter_profile_secrets -
// so accepting it opens nothing that key did not already open, and there is
// no second secret to set or rotate. Read-only toward Postiz: it lists
// accounts and never changes one, and no Postiz key leaves this function.

async function bridgeAllowed(req: Request): Promise<boolean> {
  const sent = req.headers.get('x-planner-bridge')
  if (!sent || sent.length < 20) return false
  const [a, b] = await Promise.all([sha256(sent), sha256(SERVICE_KEY)])
  return a === b
}

async function channels(body: Record<string, unknown>): Promise<Response> {
  const campaignId = typeof body.cutterCampaignId === 'string' ? body.cutterCampaignId.trim() : ''
  if (campaignId === '') return reply({ error: 'cutterCampaignId is required.' }, 400)

  const { data: rows, error } = await db.from('cutter_profiles').select('id, settings')
  if (error) throw new Problem('Could not read the posting profiles.', true, 502)
  const linked = ((rows ?? []) as Pick<Profile, 'id' | 'settings'>[]).filter(
    (p) => (p.settings?.campaigns?.[campaignId]?.accounts ?? []).length > 0,
  )
  if (linked.length === 0) return reply({ profiles: [] })

  const ids = linked.map((p) => p.id)
  const [{ data: pending }, { data: named }] = await Promise.all([
    db
      .from('cutter_posts')
      .select('profile_id, campaign_id, status, post_at, accounts')
      .in('profile_id', ids)
      .in('status', [...PENDING_STATUSES])
      .limit(2000),
    db
      .from('cutter_posts')
      .select('campaign_id, campaign_name, created_at')
      .in('profile_id', ids)
      .order('created_at', { ascending: false })
      .limit(1000),
  ])
  const names = new Map<string, string>()
  for (const row of named ?? []) if (!names.has(row.campaign_id)) names.set(row.campaign_id, row.campaign_name)

  const now = Date.now()
  const profiles = await Promise.all(
    linked.map(async (p) => {
      try {
        const integrations = await listAccounts((await keysFor(p.id)).postiz)
        const posts = ((pending ?? []) as (PendingPost & { profile_id: string })[]).filter((r) => r.profile_id === p.id)
        return { id: p.id, ...channelReport(campaignId, p.settings?.campaigns ?? {}, integrations, posts, names, now) }
      } catch (error) {
        return { id: p.id, error: error instanceof Error ? error.message : String(error) }
      }
    }),
  )
  return reply({ profiles })
}

async function tickAllowed(secret: unknown): Promise<boolean> {
  if (typeof secret !== 'string' || secret.length < 20) return false
  const { data } = await db.from('cutter_config').select('value').eq('key', 'tick_secret').maybeSingle()
  return Boolean(data?.value) && data!.value === secret
}

// --- The door -----------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const url = new URL(req.url)
  if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname.includes('/video/')) return serveVideo(req, url)
  if (req.method !== 'POST') return reply({ error: 'POST only.' }, 405)
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return reply({ error: 'Not JSON.' }, 400)
  }
  try {
    if (body.action === 'tick') {
      if (!(await tickAllowed(body.secret))) return reply({ error: 'No.' }, 403)
      later(tick())
      return reply({ ok: true })
    }
    if (body.action === 'channels') {
      if (!(await bridgeAllowed(req))) return reply({ error: 'No.' }, 403)
      return await channels(body)
    }
    const spaceId = await spaceFor(body.token)
    if (!spaceId) return reply({ error: 'signed-out' }, 401)
    const action = String(body.action ?? '')
    if (action === 'connect') return await connect(spaceId, body)
    if (action === 'unpush') {
      if (typeof body.endpoint === 'string') await db.from('cutter_push').delete().eq('endpoint', body.endpoint)
      return reply({ ok: true })
    }
    const profile = await profileFor(spaceId, body.profile)
    switch (action) {
      case 'profile':
        return reply(await profileView(profile))
      case 'accounts':
        return reply(await profileView(await refreshAccounts(profile)))
      case 'save-campaign':
        return await saveCampaign(profile, body)
      case 'save-place':
        return await savePlace(profile, body)
      case 'save-limits':
        return await saveLimits(profile, body)
      case 'attach-accounts':
        return await attachAccounts(profile, body)
      case 'push':
        return await savePush(profile, body)
      case 'start':
        return await start(profile, body)
      case 'write-caption':
        return await captionFor(profile, body)
      case 'recheck-captions':
        return await recheckCaptions(profile, body)
      case 'sent':
        return await sent(profile, body)
      case 'posts':
        return await listPosts(profile)
      case 'edit':
      case 'approve':
      case 'ready':
      case 'reject':
      case 'unschedule':
      case 'retry':
      case 'retry-accounts':
        return await act(profile, action, body)
      case 'stop-campaign':
        return await stopCampaign(profile, body)
      case 'recaption':
        return await recaption(profile, body)
      case 'stop-posts':
        return await stopPicked(profile, body)
      case 'respread-batches':
        return await respreadBatches(profile, body)
      case 'end-campaign':
        return await endCampaign(profile, body)
      case 'backup':
        return await saveBackup(profile, body)
      case 'views':
        return await views(profile)
      default:
        return reply({ error: 'Unknown action.' }, 400)
    }
  } catch (error) {
    if (error instanceof Problem) return reply({ error: error.message, later: error.later }, error.status)
    console.error(error)
    return reply({ error: `Something went wrong on the server (${error instanceof Error ? error.message : String(error)}).`, later: true }, 500)
  }
})

