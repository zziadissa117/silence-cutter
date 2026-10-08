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
//   sent           { profile, key }             -> { id, status } or { missing }
//   posts          { profile }                  -> { posts }
//   edit / approve { profile, id, caption?, title?, at? } -> { post }
//   reject / unschedule / retry { profile, id } -> { post }
//   stop-campaign  { profile, campaignId }   -> { stopped, failed }  every post of one campaign not out yet, rejected
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
import { carryOver, cleanCaptions, cleanRepost, repostDueAt, textFor, variationNote, type AccountText } from './repost.ts'
import { FAKE_CLAUDE, FakeError, fakeCaption, fakePostiz, isFakePostiz } from './fake.ts'
import { batchChoices, batchInfo, batchSpan, type BatchInfo } from './batch.ts'
import { handFields } from './hand.ts'
import { endOfDay, lastTimeToday, nextSlot, normalTimes, pickTime, spreadDay, timesFor, type OtherPost, type Spread, addDays, localDate, localTime, zoned } from './slots.ts'
import { cleanWindow, type PostingWindow } from './window.ts'
import { attachMove, summarise, type AttachMove } from './attach.ts'
import { cleanLimits, firstDayWithRoom, heldNote, releasable, split, usedOn, type Limits, type PostAccount } from './limits.ts'
import { PENDING_STATUSES, channelReport, isPending, type PendingPost } from './channels.ts'

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

async function postiz<T>(key: string, method: string, path: string, body?: unknown): Promise<T> {
  if (isFakePostiz(key)) {
    try {
      return (await fakePostiz(db, key, method, path, body)) as T
    } catch (error) {
      if (error instanceof FakeError) postizFailure(error.status, error.message)
      throw error
    }
  }
  let response: Response
  try {
    response = await fetch(`${POSTIZ}${path}`, {
      method,
      headers: { Authorization: key, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(5 * MINUTE),
    })
  } catch (error) {
    throw new Problem(`Postiz could not be reached (${error instanceof Error ? error.message : String(error)}).`, true)
  }
  const text = await response.text()
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  if (response.ok) return json as T
  postizFailure(response.status, postizMessage(json) ?? text.slice(0, 300))
}

function postizFailure(status: number, said: string): never {
  if (/unsupported file type/i.test(said)) {
    throw new Problem('Postiz only takes MP4 videos and this one is another format. Remove it and post it again - the app now turns it into an MP4 first.')
  }
  if (status === 401 || status === 403) {
    throw new Problem("Postiz didn't accept your key - paste it again in Settings, Posting.", false, 401)
  }
  if (status === 429) throw new Problem('Postiz says too many requests right now.', true, 429)
  if (status >= 500) throw new Problem(`Postiz had a problem (${status}${said ? `: ${said}` : ''}).`, true, 502)
  throw new Problem(`Postiz said: ${said || status}`, false, 400)
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
function settingsFor(platform: string, title: string): Record<string, unknown> {
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
      return { __type: platform, post_type: 'post', is_trial_reel: false, collaborators: [] }
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
  settings: { campaigns?: Record<string, { accounts?: string[]; times?: string[]; window?: PostingWindow }>; limits?: Limits }
  timezone: string
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
  release_urls: Record<string, string> | null
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
  }
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
    error: post.error,
    retryAt: post.retry_at,
    createdAt: post.created_at,
    byHand: post.by_hand,
    batch: post.batch ? { id: post.batch.id, date: post.batch.date, time: post.batch.time, size: post.batch.size } : null,
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
  const campaigns = { ...(profile.settings.campaigns ?? {}) }
  if (accounts.length === 0 && times.length === 0 && !window) delete campaigns[campaignId]
  else campaigns[campaignId] = window ? { accounts, times, window } : { accounts, times }
  const { data, error } = await db
    .from('cutter_profiles')
    .update({ settings: { ...profile.settings, campaigns }, updated_at: new Date().toISOString() })
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
                  settings: settingsFor(account.platform, finishTitle(text.title ?? '', [owned.headline ?? '', owned.campaign_name])),
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
                settings: settingsFor(account.platform, finishTitle(text.title ?? '', [owned.headline ?? '', owned.campaign_name])),
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
  const { data } = await db.from('cutter_posts').select('campaign_name').eq('profile_id', profileId).eq('status', 'waiting')
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

async function videoUrl(post: Post): Promise<string> {
  const expires = Date.now() + 60 * MINUTE
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

  let { data: post } = await db.from('cutter_posts').select('*').eq('profile_id', profile.id).eq('client_key', key).maybeSingle()
  if (!post) {
    const { data, error } = await db
      .from('cutter_posts')
      .insert({
        profile_id: profile.id,
        client_key: key,
        campaign_id: campaign.id,
        campaign_name: text(campaign.name, 200) ?? 'Campaign',
        // By hand: nothing to approve. A batch: always his approval.
        rules: hand ? { ...rules, approval: 'direct' } : batch ? { ...rules, approval: 'me' } : rules,
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

  if (!post.media) {
    const media = await postiz<Media>(keys.postiz, 'POST', '/upload-from-url', { url: await videoUrl(post) })
    if (!media?.id || !media?.path) throw new Problem('Postiz took the video but gave nothing back to post it with.', true)
    post = await update(post.id, { media: { id: media.id, path: media.path } })
    await removeParts(post).catch(() => {})
  }

  const chosen = profile.settings.campaigns?.[post.campaign_id]
  const accounts = (chosen?.accounts ?? [])
    .map((accountId) => profile.accounts.find((a) => a.id === accountId))
    .filter((a): a is Account => Boolean(a))
    .map((a) => ({ id: a.id, name: a.name, platform: a.platform, profile: a.profile }))
  if (accounts.length === 0) {
    throw new Problem(`No accounts are picked for ${post.campaign_name} - pick them in the campaign's Posting, then Try again.`)
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
  return update(post.id, { slot: null, post_at: choices[0].at.toISOString(), spread: null })
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
  const perDay = Math.max(...Object.values(waiting.reduce<Record<string, number>>((n, r) => ({ ...n, [r.batch!.date]: (n[r.batch!.date] ?? 0) + 1 }), {})))
  await notify(profileId, {
    title: `${rows[0].campaign_name}: ${waiting.length} video${waiting.length === 1 ? '' : 's'} ready to approve`,
    body: `${perDay} a day, ${batchSpan(waiting.map((r) => r.batch!.date))}. Approve them in Posts.`,
    tag: `batch-${batchId}`,
  })
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
      const choice = pickTime({ times, others, now, tz: profile.timezone, later: post.later, leadMinutes })
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
  const end = endOfDay(date, profile.timezone)
  const now = Date.now()
  for (const kind of ['late', 'extra'] as const) {
    const members = rows.filter((r) => r.spread === kind)
    if (members.length === 0) continue
    const start =
      kind === 'late'
        ? Math.min(...members.map((m) => Date.parse(m.created_at))) + 30 * MINUTE
        : (lastTimeToday(times, date, profile.timezone) ?? now)
    const placed = spreadDay(
      members.map((m) => ({
        id: m.id,
        at: m.post_at ? Date.parse(m.post_at) : null,
        locked: ['scheduled', 'posted', 'error'].includes(m.status) || Boolean(m.creating_at),
      })),
      { start, end, firstAtStart: kind === 'late', now, leadMs: 5 * MINUTE, minGapMs: 10 * MINUTE },
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
  if (!post.media) throw new Problem('The video never reached Postiz - Try again.')
  if (!post.caption?.trim()) throw new Problem(post.rules.caption === 'paste' ? 'Paste the caption first.' : 'Write the caption first.')

  const soon = Date.now() + 2 * MINUTE
  if (post.spread && post.rules.approval !== 'brand') {
    // Settled first, then at its place in the day's spread as it is now.
    if (post.rules.approval === 'direct' && !(await settled(post))) {
      return update(post.id, { retry_at: new Date(Date.now() + 5 * MINUTE).toISOString() })
    }
    await respread(profile, post.campaign_id, post.slot!.slice(0, 10))
    post = await reload(post.id)
  } else if (!post.post_at || new Date(post.post_at).getTime() < soon) {
    if (post.slot) {
      const brand = post.rules.approval === 'brand'
      post = await takeSlot(post, profile, { leadMinutes: 3, todayOnly: brand })
    } else {
      post = await update(post.id, { post_at: null })
    }
  }
  const now = !post.post_at
  const date = now ? new Date().toISOString() : post.post_at!

  // A paused or full account does not go in this group: it is held on the post
  // and goes out by itself once it is free (releaseHeld). The others go as
  // planned. Everything held keeps the post queued, untouched.
  const used = await usedForDay(profile, localDate(new Date(date), profile.timezone), post.id)
  const { send, held } = split(post.accounts, profile.settings.limits, used)
  if (send.length === 0) {
    return update(post.id, { accounts: held, error: heldNote(held), retry_at: new Date(Date.now() + 30 * MINUTE).toISOString(), attempts: 0 })
  }
  post = { ...post, accounts: send }

  if (post.creating_at) {
    // A run before this one may have got as far as creating it.
    const found = await findCreated(keys.postiz, post, date)
    if (found) return update(post.id, { status: 'scheduled', accounts: [...send, ...held], postiz_ids: found, creating_at: null, error: heldNote(held), attempts: 0, retry_at: null })
  }
  await update(post.id, { creating_at: new Date().toISOString() })
  const title = finishTitle(post.title ?? '', [post.headline ?? '', post.campaign_name])
  const created = await postiz<{ postId: string; integration: string }[]>(keys.postiz, 'POST', '/posts', {
    type: now ? 'now' : 'schedule',
    date,
    shortLink: false,
    tags: [],
    posts: post.accounts.map((account) => {
      const text = textFor(post, account.id)
      return {
        integration: { id: account.id },
        value: [{ content: text.caption, image: [{ id: post.media!.id, path: post.media!.path }] }],
        settings: settingsFor(account.platform, finishTitle(text.title ?? '', [post.headline ?? '', post.campaign_name])),
      }
    }),
  })
  return update(post.id, {
    status: 'scheduled',
    accounts: [...send, ...held],
    post_at: date,
    postiz_ids: Array.isArray(created) ? created : [],
    creating_at: null,
    error: heldNote(held),
    attempts: 0,
    retry_at: null,
    checks: 0,
    checked_at: null,
  })
}

interface PostizPost {
  id: string
  content?: string
  publishDate?: string
  releaseURL?: string
  state?: string
  integration?: { id?: string; providerIdentifier?: string; name?: string }
}

async function postsAround(key: string, from: number, to: number): Promise<PostizPost[]> {
  const query = `?startDate=${encodeURIComponent(new Date(from).toISOString())}&endDate=${encodeURIComponent(new Date(to).toISOString())}`
  const result = await postiz<{ posts?: PostizPost[] }>(key, 'GET', `/posts${query}`)
  return result?.posts ?? []
}

/** Posts to these accounts at this time already in Postiz - made by a run
 *  that stopped before it could record them. */
async function findCreated(key: string, post: Post, date: string): Promise<{ postId: string; integration: string }[] | null> {
  const at = new Date(date).getTime()
  const found = await postsAround(key, at - 60 * MINUTE, at + 60 * MINUTE)
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
  const attempts = post.attempts + 1
  // Postiz counts requests by the hour, so "too many" waits it out.
  const busy = problem.status === 429
  if (problem.later && attempts < (busy ? MAX_ATTEMPTS * 2 : MAX_ATTEMPTS)) {
    const wait = busy ? 15 * MINUTE : [2, 5, 10, 20, 30][Math.min(attempts - 1, 4)] * MINUTE
    await update(post.id, { error: `${problem.message} Trying again by itself.`, attempts, retry_at: new Date(Date.now() + wait).toISOString() })
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
  const { data, error } = await db
    .from('cutter_posts')
    .select('*')
    .eq('profile_id', profile.id)
    .or(`created_at.gt.${since},post_at.gt.${since},status.in.(uploading,writing,waiting,approved,failed)`)
    .order('created_at', { ascending: false })
    .limit(300)
  if (error) throw new Problem('The posts could not be read.', true, 500)
  const posts = (data ?? []) as Post[]
  // Anything stuck mid-way gets a nudge, without waiting for the scheduler.
  const stuck = posts.filter(
    (p) =>
      (p.status === 'writing' || p.status === 'approved') &&
      (!p.retry_at || new Date(p.retry_at).getTime() <= Date.now()) &&
      Date.now() - new Date(p.updated_at).getTime() > 2 * MINUTE,
  )
  for (const p of stuck.slice(0, 3)) later(advance(p.id))
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
      await postiz(key, 'DELETE', `/posts/${id}`)
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
      const approved = await update(post.id, { ...fields, status: 'approved', error: null, attempts: 0, retry_at: null })
      // Straight away when it can; if not, the scheduler keeps at it.
      await advance(approved.id)
      return reply({ post: postView(await ownPost(profile, post.id)) })
    }
    case 'reject': {
      if (post.status === 'scheduled' && post.postiz_ids?.[0]) {
        const { postiz: key } = await keysFor(profile.id)
        await deleteScheduled(key, post)
      }
      if (post.status === 'uploading' || post.status === 'writing' || post.status === 'failed') await removeParts(post).catch(() => {})
      return reply({ post: postView(await update(post.id, { status: 'rejected', error: null, retry_at: null })) })
    }
    case 'unschedule': {
      if (post.status !== 'scheduled') return reply({ post: postView(post) })
      if (post.post_at && new Date(post.post_at).getTime() < Date.now()) throw new Problem('It has already gone out.')
      const { postiz: key } = await keysFor(profile.id)
      if (post.postiz_ids?.[0]) await deleteScheduled(key, post)
      return reply({ post: postView(await update(post.id, { status: 'waiting', postiz_ids: null, error: null })) })
    }
    case 'retry': {
      if (post.status !== 'failed' && !(post.status === 'writing' || post.status === 'approved')) return reply({ post: postView(post) })
      const moved = await update(post.id, { status: post.status === 'approved' ? 'approved' : 'writing', error: null, attempts: 0, retry_at: null })
      await advance(moved.id)
      return reply({ post: postView(await ownPost(profile, post.id)) })
    }
  }
  throw new Problem('Unknown action.')
}

/** Every post of one campaign that has not gone out yet, stopped: taken out
 *  of Postiz when it is scheduled there, and marked rejected - the same as
 *  Reject on each one. For a finished campaign. Only this person's posts of
 *  that campaign; every other campaign's are untouched, and ones whose time
 *  has already come stay as they are (they have gone out, or are going). */
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
  const now = Date.now()
  const pending = ((data ?? []) as Post[]).filter((p) => isPending(p, now))
  let key: string | null = null
  let stopped = 0
  const failed: string[] = []
  for (const post of pending) {
    try {
      if (post.status === 'scheduled' && post.postiz_ids?.[0]) {
        key ??= (await keysFor(profile.id)).postiz
        await deleteScheduled(key, post)
      }
      if (post.status === 'uploading' || post.status === 'writing') await removeParts(post).catch(() => {})
      await update(post.id, { status: 'rejected', error: null, retry_at: null })
      stopped++
    } catch (error) {
      failed.push(`${post.file_name ?? 'A video'}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return reply({ stopped, failed })
}

// --- The scheduler ------------------------------------------------------------

async function tick(): Promise<void> {
  const now = Date.now()
  const iso = (ms: number) => new Date(ms).toISOString()

  // Whatever is due to be tried again, or was left half-way.
  const { data: due } = await db
    .from('cutter_posts')
    .select('id, retry_at, updated_at')
    .in('status', ['writing', 'approved'])
    .or(`retry_at.is.null,retry_at.lte.${iso(now)}`)
    .lt('updated_at', iso(now - 2 * MINUTE))
    .order('updated_at', { ascending: true })
    .limit(10)
  for (const row of due ?? []) await advance(row.id)

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
  await checkPosted(now)
  await remindReposts(now)
  await remind(now)

  // "Posts to approve" held back while he was told a moment ago.
  const { data: pending } = await db.from('cutter_profiles').select('id').eq('push_pending', true).limit(20)
  for (const row of pending ?? []) await sendWaiting(row.id)
}

/** Asks Postiz how the posts that were due went: posted (with links), or
 *  failed on the platform. One question per person, a few times at most. */
async function checkPosted(now: number): Promise<void> {
  const { data } = await db
    .from('cutter_posts')
    .select('*')
    .eq('status', 'scheduled')
    .lt('post_at', new Date(now - 2 * MINUTE).toISOString())
    .lt('checks', 6)
    .or(`checked_at.is.null,checked_at.lt.${new Date(now - 8 * MINUTE).toISOString()}`)
    .limit(100)
  const byProfile = new Map<string, Post[]>()
  for (const post of (data ?? []) as Post[]) byProfile.set(post.profile_id, [...(byProfile.get(post.profile_id) ?? []), post])
  for (const [profileId, posts] of byProfile) {
    try {
      const { postiz: key } = await keysFor(profileId)
      const times = posts.map((p) => new Date(p.post_at!).getTime())
      const found = await postsAround(key, Math.min(...times) - 60 * MINUTE, Math.max(...times) + 60 * MINUTE)
      const byId = new Map(found.map((p) => [p.id, p]))
      for (const post of posts) {
        const mine = (post.postiz_ids ?? []).map((ref) => byId.get(ref.postId)).filter((p): p is PostizPost => Boolean(p))
        const links: Record<string, string> = { ...(post.release_urls ?? {}) }
        for (const p of mine) if (p.releaseURL && p.integration?.name) links[p.integration.name] = p.releaseURL
        const errored = mine.filter((p) => p.state === 'ERROR')
        const published = mine.length > 0 && mine.every((p) => p.state === 'PUBLISHED' || p.state === 'ERROR') && errored.length < mine.length
        const fields: Partial<Post> = { checked_at: new Date().toISOString(), checks: post.checks + 1, release_urls: links }
        if (errored.length > 0 && !published) {
          fields.status = 'error'
          fields.error = `Postiz couldn't publish it to ${errored.map((p) => p.integration?.name ?? 'an account').join(', ')}. Open Postiz to see why.`
        } else if (published) {
          fields.status = 'posted'
          if (!post.repost_of) {
            const due = repostDueAt(Date.now(), post.rules.repost)
            if (due !== null && !post.reposted_at) fields.repost_at = new Date(due).toISOString()
          }
          if (errored.length > 0) fields.error = `Not posted to ${errored.map((p) => p.integration?.name ?? 'an account').join(', ')}.`
        }
        const saved = await update(post.id, fields)
        if (saved.status === 'error') {
          await notify(profileId, { title: `${post.campaign_name}: not posted`, body: saved.error ?? '', tag: `error-${post.id}` })
        }
      }
    } catch (error) {
      console.error('check failed', profileId, error instanceof Error ? error.message : String(error))
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
      case 'reject':
      case 'unschedule':
      case 'retry':
        return await act(profile, action, body)
      case 'stop-campaign':
        return await stopCampaign(profile, body)
      default:
        return reply({ error: 'Unknown action.' }, 400)
    }
  } catch (error) {
    if (error instanceof Problem) return reply({ error: error.message, later: error.later }, error.status)
    console.error(error)
    return reply({ error: `Something went wrong on the server (${error instanceof Error ? error.message : String(error)}).`, later: true }, 500)
  }
})

