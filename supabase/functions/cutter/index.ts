// The silence cutter's shared login and sync.
//
// One login - a name and a password - that he and his friend both use, so
// their campaigns, angles and picture bank are the same on both phones and
// backed up. Videos never come here; only the setups and their pictures and
// sounds do.
//
// Deliberately not Supabase Auth: that is the planner's, needs an email, and
// sharing it would hand the friend the planner too - pay rates, account
// passwords. This is a separate, smaller thing, and the only way into the
// cutter_* tables and the cutter-files bucket (which have no policies at
// all). Deployed with verify_jwt off: the login is checked here instead.
//
// CLOSED: this backend does not create logins from a sign-in. There is the
// owner's login (the oldest space), the admin backup (below), and the logins
// the owner makes with a one-time link (invite.ts, his ask on 2026-10-29):
// only a signed-in owner can make one, the link works once within 48 hours,
// and the person who opens it gets their own space and picks the password.
// `create` is ignored. Anyone else who calls login gets the same answer a
// wrong password gets, so nothing says which names exist.
//
// The admin backup is a second way into the SAME space - not a second space,
// which would be empty and useless as a backup. Its name is `admin` and its
// password is the project secret CUTTER_ADMIN_PASSWORD, set in the Supabase
// dashboard: it is never stored in the database, never in this code, and with
// no secret set there is no admin at all. It has its own failure counter
// (cutter_config admin_failed / admin_locked_until), so locking the main login
// out never locks the admin out too.
//
// Actions, all POST with a JSON body:
//   login          { name, password }           -> { token, name }
//   invite         { token, name }              -> { code, until }  owner only: a one-time link's code
//   accept-invite  { code, password }           -> { token, name }  the link opened: once, within 48 h
//   people         { token }                    -> { people }       owner only: the logins he made, with their phones
//   pause          { token, name, paused }      -> { people }       owner only: a login stopped, or let go again
//   remove-device  { token, name, device }      -> { people }       owner only: a phone signed out of a login
// A login made with a link is tied to its phones (cutter_devices): every
// sign-in names the phone, its token carries it, at most MAX_DEVICES at once,
// and the owner is told of each new one. The owner's own login is not limited.
//   pull           { token, since? }            -> { items, until }
//   push           { token, items }             -> { accepted }
//   upload-urls    { token, files: [{ sha }] }  -> { uploads: [{ sha, url }] }
//   download-urls  { token, shas }              -> { urls: { [sha]: url } }
//   songs          { token }                    -> { songs }        the shared music bank (songs.ts)
//   song-upload    { token, sha }               -> { url | null }   null: the file is there already
//   add-song       { token, song }              -> { song }         the one kept: an earlier copy of it, if any
//   rename-song    { token, id, name }          -> { song }
//   remove-song    { token, id }                -> { removed }
//   song-urls      { token, shas }              -> { urls: { [sha]: url } }
//   report         { reports: [...] }            -> { stored }
//
// "report" needs no login: it is how a phone says a video failed, and a
// phone that is not signed in fails too. It only ever inserts, into a table
// nothing can read back through this function, and every field is capped.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

import { MUSIC_DIR, cleanSong, sameSong, songsFrom, type SharedSong } from './songs.ts'
import { INVITE_MS, MAX_DEVICES, cleanLoginName, deviceFrom, isActive, roomForDevice, songPrefix, type Device } from './invite.ts'
import webpush from 'npm:web-push@3.6.7'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const BUCKET = 'cutter-files'

const MIN_PASSWORD = 6
// Five wrong passwords lock that login for half an hour. It was ten and
// fifteen minutes: with a short password and a guessable name, that was still
// close to a thousand guesses a day.
const MAX_FAILS = 5
const LOCK_MINUTES = 30
const ITERATIONS = 100_000

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
const encoder = new TextEncoder()

function hex(bytes: ArrayBuffer | Uint8Array): string {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('')
}

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromB64url(text: string): Uint8Array {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4)
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))
}

async function hashPassword(password: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: encoder.encode(salt), iterations: ITERATIONS },
    key,
    256,
  )
  return hex(bits)
}

/** Equal without saying where they differ. */
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

async function signingKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(SERVICE_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ])
}

/** A token that keeps a phone signed in until it signs out. It names the
 *  space and a piece of its password hash, so changing the password signs
 *  every phone out. */
async function makeToken(spaceId: string, passHash: string, deviceId?: string): Promise<string> {
  const payload = b64url(encoder.encode(JSON.stringify({ s: spaceId, p: passHash.slice(0, 12), ...(deviceId ? { d: deviceId } : {}) })))
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', await signingKey(), encoder.encode(payload)))
  return `${payload}.${b64url(signature)}`
}

async function spaceFor(token: unknown): Promise<string | null> {
  if (typeof token !== 'string' || !token.includes('.')) return null
  const [payload, signature] = token.split('.')
  try {
    const valid = await crypto.subtle.verify('HMAC', await signingKey(), fromB64url(signature), encoder.encode(payload))
    if (!valid) return null
    const { s, p, d } = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as { s: string; p: string; d?: string }
    const { data } = await db.from('cutter_spaces').select('*').eq('id', s).maybeSingle()
    if (!data || !isActive(data) || !data.pass_hash.startsWith(p)) return null
    if (data.id === (await ownerSpace())) return data.id
    // Any other login: only on a phone it signed in on, not taken off.
    if (typeof d !== 'string') return null
    const { data: device } = await db.from('cutter_devices').select('last_seen, removed_at').eq('space_id', data.id).eq('device_id', d).maybeSingle()
    if (!device || device.removed_at) return null
    if (Date.now() - Date.parse(device.last_seen) > 10 * 60_000) {
      await db.from('cutter_devices').update({ last_seen: new Date().toISOString() }).eq('space_id', data.id).eq('device_id', d)
    }
    return data.id
  } catch {
    return null
  }
}

/** The one answer for "that did not work", whatever the reason: no such
 *  login, wrong password, or an admin name with the wrong password. */
const WRONG = { error: 'Wrong login or password.' }

async function configValues(keys: string[]): Promise<Record<string, string>> {
  const { data } = await db.from('cutter_config').select('key, value').in('key', keys)
  return Object.fromEntries((data ?? []).map((row: { key: string; value: string }) => [row.key, row.value]))
}

async function setConfig(key: string, value: string): Promise<void> {
  await db.from('cutter_config').upsert({ key, value }, { onConflict: 'key' })
}

const ADMIN_NAME = 'admin'

async function sha256Hex(text: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', encoder.encode(text)))
}

/** The admin backup: the same space, a different way in. Null for anything
 *  that is not the admin name with the admin password. */
async function adminLogin(name: string, password: string): Promise<{ id: string; pass_hash: string } | 'locked' | null> {
  const secret = Deno.env.get('CUTTER_ADMIN_PASSWORD') ?? ''
  // No secret set, or too short to be one: there is no admin.
  if (secret.length < 12 || name !== ADMIN_NAME) return null

  const c = await configValues(['admin_failed', 'admin_locked_until'])
  if (c.admin_locked_until && new Date(c.admin_locked_until) > new Date()) return 'locked'

  // Compared as hashes, so it does not matter where the two differ or how
  // long they are.
  if (!same(await sha256Hex(password), await sha256Hex(secret))) {
    const failed = (Number(c.admin_failed) || 0) + 1
    await setConfig('admin_failed', String(failed >= MAX_FAILS ? 0 : failed))
    if (failed >= MAX_FAILS) {
      await setConfig('admin_locked_until', new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString())
    }
    return null
  }

  if ((Number(c.admin_failed) || 0) > 0) await setConfig('admin_failed', '0')
  // Logins can no longer be created, so there is exactly one space: his.
  const { data } = await db.from('cutter_spaces').select('id, pass_hash').order('created_at').limit(1).maybeSingle()
  return data ?? null
}

async function login(body: Record<string, unknown>): Promise<Response> {
  const name = typeof body.name === 'string' ? body.name.trim().toLowerCase() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  if (!name) return reply({ error: 'Type the login name.' }, 400)
  if (password.length < MIN_PASSWORD) {
    return reply({ error: `The password needs at least ${MIN_PASSWORD} characters.` }, 400)
  }

  const { data: space, error } = await db.from('cutter_spaces').select('*').eq('name', name).maybeSingle()
  if (error) return reply({ error: 'The server could not check the login. Try again.' }, 500)

  // A link not opened yet, or a paused login: as if there were no such name.
  if (space && !isActive(space)) {
    await hashPassword(password, 'no-such-login')
    return reply(WRONG, 401)
  }
  if (space) {
    if (space.locked_until && new Date(space.locked_until) > new Date()) {
      return reply({ error: `Too many wrong passwords. Try again in ${LOCK_MINUTES} minutes.` }, 429)
    }
    const hash = await hashPassword(password, space.pass_salt)
    if (!same(hash, space.pass_hash)) {
      const failed = space.failed_count + 1
      await db
        .from('cutter_spaces')
        .update({
          failed_count: failed >= MAX_FAILS ? 0 : failed,
          locked_until: failed >= MAX_FAILS ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() : null,
        })
        .eq('id', space.id)
      return reply(WRONG, 401)
    }
    if (space.failed_count > 0) await db.from('cutter_spaces').update({ failed_count: 0 }).eq('id', space.id)
    if (space.id === (await ownerSpace())) return reply({ token: await makeToken(space.id, space.pass_hash), name })
    const device = deviceFrom(body.device)
    if (!device) return reply({ error: 'Close the Cutter and open it again to update it, then sign in.' }, 400)
    const refused = await onDevice(space, device)
    if (refused) return reply({ error: refused }, 403)
    return reply({ token: await makeToken(space.id, space.pass_hash, device.id), name })
  }

  const admin = await adminLogin(name, password)
  if (admin === 'locked') {
    return reply({ error: `Too many wrong passwords. Try again in ${LOCK_MINUTES} minutes.` }, 429)
  }
  if (admin) return reply({ token: await makeToken(admin.id, admin.pass_hash), name })

  // No such login. Spend the time a real check would have, so how long the
  // answer takes does not say whether the name exists.
  await hashPassword(password, 'no-such-login')
  return reply(WRONG, 401)
}

/** The owner's space: the oldest - the one login there was before links. */
let ownerId: string | null = null
async function ownerSpace(): Promise<string | null> {
  if (ownerId) return ownerId
  const { data } = await db.from('cutter_spaces').select('id').order('created_at').limit(1).maybeSingle()
  ownerId = data?.id ?? null
  return ownerId
}

const NOT_OWNER = { error: 'Only the main login can do that.' }

/** A one-time sign-in link for a new login, `name`: its code (only the
 *  hash is kept). A name with a link not opened yet gets a new one - the old
 *  one stops working. */
async function invite(spaceId: string, body: Record<string, unknown>): Promise<Response> {
  if (spaceId !== (await ownerSpace())) return reply(NOT_OWNER, 403)
  const name = cleanLoginName(body.name)
  if (!name) return reply({ error: 'Pick a login name: 3 to 30 letters or digits, no spaces.' }, 400)
  const code = b64url(crypto.getRandomValues(new Uint8Array(32)))
  const until = new Date(Date.now() + INVITE_MS).toISOString()
  const link = { invite_hash: await sha256Hex(code), invite_until: until }
  const { data: taken } = await db.from('cutter_spaces').select('*').eq('name', name).maybeSingle()
  if (taken) {
    if (taken.status !== 'invited') return reply({ error: 'That login name is taken - pick another.' }, 409)
    const { error } = await db.from('cutter_spaces').update(link).eq('id', taken.id).eq('status', 'invited')
    if (error) return reply({ error: 'The server could not make the link. Try again.' }, 500)
    return reply({ code, until })
  }
  // No password yet: an unguessable one that nobody knows, until the link.
  const salt = b64url(crypto.getRandomValues(new Uint8Array(16)))
  const { error } = await db.from('cutter_spaces').insert({
    name,
    pass_salt: salt,
    pass_hash: await hashPassword(b64url(crypto.getRandomValues(new Uint8Array(32))), salt),
    status: 'invited',
    ...link,
  })
  if (error) return reply({ error: 'The server could not make the link. Try again.' }, 500)
  return reply({ code, until })
}

const LINK_DEAD = { error: 'This link has already been used or has expired. Ask for a new one.' }

/** The link opened: the password he chose, and his login is his. In one
 *  update that only an invited space with this code, in time, matches - so
 *  the link works once. */
async function acceptInvite(body: Record<string, unknown>): Promise<Response> {
  const code = typeof body.code === 'string' && /^[\w-]{20,100}$/.test(body.code) ? body.code : null
  const password = typeof body.password === 'string' ? body.password : ''
  const device = deviceFrom(body.device)
  if (!code) return reply(LINK_DEAD, 410)
  if (!device) return reply({ error: 'Close the page and open the link again.' }, 400)
  if (password.length < MIN_PASSWORD) return reply({ error: `The password needs at least ${MIN_PASSWORD} characters.` }, 400)
  const salt = b64url(crypto.getRandomValues(new Uint8Array(16)))
  const passHash = await hashPassword(password, salt)
  const { data, error } = await db
    .from('cutter_spaces')
    .update({ status: 'active', pass_salt: salt, pass_hash: passHash, invite_hash: null, invite_until: null, failed_count: 0, locked_until: null })
    .eq('invite_hash', await sha256Hex(code))
    .eq('status', 'invited')
    .gt('invite_until', new Date().toISOString())
    .select('id, name, pass_hash')
    .maybeSingle()
  if (error) return reply({ error: 'The server could not check the link. Try again.' }, 500)
  if (!data) return reply(LINK_DEAD, 410)
  await onDevice({ id: data.id, name: data.name }, device, 'opened their sign-in link')
  return reply({ token: await makeToken(data.id, data.pass_hash, device.id), name: data.name })
}

/** A phone signing in to a login made with a link: let in if it is one of
 *  its phones or there is room - the owner told of every new one - or the
 *  reason it isn't. */
async function onDevice(space: { id: string; name: string }, device: Device, did = 'signed in on a new phone'): Promise<string | null> {
  const { data } = await db.from('cutter_devices').select('device_id').eq('space_id', space.id).is('removed_at', null)
  const room = roomForDevice((data ?? []) as { device_id: string }[], device)
  if (room === 'full') {
    await notifyOwner(`${space.name} tried a ${MAX_DEVICES + 1}th phone`, `Refused: ${device.name}. ${space.name} is on ${MAX_DEVICES} phones already - Settings, People to see them.`)
    return `This login is on ${MAX_DEVICES} phones already. Ask Ziad to take one off.`
  }
  const now = new Date().toISOString()
  // A phone taken off and signing in again is a new phone again.
  await db.from('cutter_devices').upsert({ space_id: space.id, device_id: device.id, name: device.name, last_seen: now, removed_at: null, ...(room === 'new' ? { first_seen: now } : {}) })
  if (room === 'new') await notifyOwner(`${space.name} ${did}`, `${device.name}. Settings, People shows every phone ${space.name} uses.`)
  return null
}

let vapidReady: Promise<boolean> | null = null
function vapid(): Promise<boolean> {
  vapidReady ??= (async () => {
    const c = await configValues(['vapid_public', 'vapid_private'])
    if (!c.vapid_public || !c.vapid_private) return false
    webpush.setVapidDetails('https://silence-cutter.netlify.app', c.vapid_public, c.vapid_private)
    return true
  })()
  return vapidReady
}

/** A notification to the owner's phones - every posting profile of his login. */
async function notifyOwner(title: string, body: string): Promise<void> {
  try {
    if (!(await vapid())) return
    const owner = await ownerSpace()
    const { data: profiles } = await db.from('cutter_profiles').select('id').eq('space_id', owner)
    const ids = ((profiles ?? []) as { id: string }[]).map((p) => p.id)
    if (ids.length === 0) return
    const { data } = await db.from('cutter_push').select('endpoint, keys').in('profile_id', ids)
    for (const row of data ?? []) {
      await webpush
        .sendNotification(
          { endpoint: row.endpoint, keys: row.keys as { p256dh: string; auth: string } },
          JSON.stringify({ title, body, tag: `people-${Date.now()}`, url: '/campaign.html#settings' }),
          { TTL: 24 * 60 * 60, urgency: 'high' },
        )
        .catch(() => {})
    }
  } catch (error) {
    console.error('telling the owner failed', error)
  }
}

/** The logins he made: name, whether the link was opened, until when it
 *  works, paused or not, and the phones each is on. */
async function people(spaceId: string): Promise<Response> {
  const owner = await ownerSpace()
  if (spaceId !== owner) return reply(NOT_OWNER, 403)
  const { data, error } = await db.from('cutter_spaces').select('*').neq('id', owner).order('created_at')
  if (error) return reply({ error: 'The server could not read the logins.' }, 500)
  const rows = data ?? []
  const { data: devices } = rows.length > 0
    ? await db.from('cutter_devices').select('*').in('space_id', rows.map((r) => r.id)).is('removed_at', null).order('first_seen')
    : { data: [] }
  return reply({
    people: rows.map((row) => ({
      name: row.name,
      status: row.status ?? 'active',
      until: row.status === 'invited' ? row.invite_until : null,
      since: row.created_at,
      devices: ((devices ?? []) as { space_id: string; device_id: string; name: string; first_seen: string; last_seen: string }[])
        .filter((d) => d.space_id === row.id)
        .map((d) => ({ id: d.device_id, name: d.name, firstSeen: d.first_seen, lastSeen: d.last_seen })),
    })),
  })
}

/** The owner's own lever on a login he made: pause it (every call refused,
 *  its data kept) or let it go again. */
async function pause(spaceId: string, body: Record<string, unknown>): Promise<Response> {
  const owner = await ownerSpace()
  if (spaceId !== owner) return reply(NOT_OWNER, 403)
  const name = cleanLoginName(body.name)
  if (!name) return reply({ error: 'Which login?' }, 400)
  const { error } = await db
    .from('cutter_spaces')
    .update({ status: body.paused === true ? 'paused' : 'active' })
    .eq('name', name)
    .neq('id', owner)
    .in('status', ['active', 'paused'])
  if (error) return reply({ error: 'The server could not change the login.' }, 500)
  return people(spaceId)
}

/** A phone taken off a login he made: signed out at once, a place free. */
async function removeDevice(spaceId: string, body: Record<string, unknown>): Promise<Response> {
  const owner = await ownerSpace()
  if (spaceId !== owner) return reply(NOT_OWNER, 403)
  const name = cleanLoginName(body.name)
  const device = typeof body.device === 'string' ? body.device : ''
  if (!name || !device) return reply({ error: 'Which phone?' }, 400)
  const { data: space } = await db.from('cutter_spaces').select('id').eq('name', name).neq('id', owner).maybeSingle()
  if (!space) return reply({ error: 'Which login?' }, 400)
  const { error } = await db.from('cutter_devices').update({ removed_at: new Date().toISOString() }).eq('space_id', space.id).eq('device_id', device)
  if (error) return reply({ error: 'The server could not take the phone off.' }, 500)
  return people(spaceId)
}

async function pull(spaceId: string, body: Record<string, unknown>): Promise<Response> {
  let query = db
    .from('cutter_items')
    .select('kind, id, data, updated_at, deleted, server_at')
    .eq('space_id', spaceId)
    .order('server_at', { ascending: true })
    .limit(1000)
  if (typeof body.since === 'string' && body.since) query = query.gt('server_at', body.since)
  const { data, error } = await query
  if (error) return reply({ error: 'The server could not read the shared setups.' }, 500)
  return reply({ items: data, until: data.length > 0 ? data[data.length - 1].server_at : (body.since ?? null) })
}

interface IncomingItem {
  kind: 'campaign' | 'bank'
  id: string
  data: unknown
  updated_at: number
  deleted: boolean
}

async function push(spaceId: string, body: Record<string, unknown>): Promise<Response> {
  const items = (Array.isArray(body.items) ? body.items : []) as IncomingItem[]
  const valid = items.filter(
    (i) =>
      (i.kind === 'campaign' || i.kind === 'bank') &&
      typeof i.id === 'string' &&
      i.id.length > 0 &&
      i.id.length < 200 &&
      Number.isFinite(i.updated_at),
  )
  if (valid.length === 0) return reply({ accepted: [] })
  const { data: existing, error } = await db
    .from('cutter_items')
    .select('kind, id, updated_at')
    .eq('space_id', spaceId)
    .in('id', valid.map((i) => i.id))
  if (error) return reply({ error: 'The server could not read the shared setups.' }, 500)
  const known = new Map((existing ?? []).map((e) => [`${e.kind}:${e.id}`, Number(e.updated_at)]))
  // The newer edit wins; an older one arriving late is ignored.
  const newer = valid.filter((i) => (known.get(`${i.kind}:${i.id}`) ?? -Infinity) < i.updated_at)
  if (newer.length > 0) {
    const { error: writeError } = await db.from('cutter_items').upsert(
      newer.map((i) => ({
        space_id: spaceId,
        kind: i.kind,
        id: i.id,
        data: i.deleted ? null : i.data,
        updated_at: Math.round(i.updated_at),
        deleted: Boolean(i.deleted),
        server_at: new Date().toISOString(),
      })),
    )
    if (writeError) return reply({ error: 'The server could not save the shared setups.' }, 500)
  }
  return reply({ accepted: valid.map((i) => `${i.kind}:${i.id}`) })
}

const SHA = /^[0-9a-f]{64}$/

async function uploadUrls(spaceId: string, body: Record<string, unknown>): Promise<Response> {
  const files = (Array.isArray(body.files) ? body.files : []) as { sha: string }[]
  const uploads: { sha: string; url: string }[] = []
  for (const { sha } of files.slice(0, 50)) {
    if (!SHA.test(sha)) continue
    const { data } = await db.storage.from(BUCKET).createSignedUploadUrl(`${spaceId}/${sha}`)
    // No URL means the file is already there - files are named by their
    // contents, so there is nothing to replace.
    if (data?.signedUrl) uploads.push({ sha, url: data.signedUrl })
  }
  return reply({ uploads })
}

async function downloadUrls(spaceId: string, body: Record<string, unknown>): Promise<Response> {
  const shas = (Array.isArray(body.shas) ? body.shas : []).filter((s): s is string => typeof s === 'string' && SHA.test(s))
  if (shas.length === 0) return reply({ urls: {} })
  const { data, error } = await db.storage
    .from(BUCKET)
    .createSignedUrls(
      shas.slice(0, 200).map((sha) => `${spaceId}/${sha}`),
      3600,
    )
  if (error) return reply({ error: 'The server could not find the shared pictures.' }, 500)
  const urls: Record<string, string> = {}
  for (const entry of data ?? []) {
    if (entry.signedUrl && entry.path) urls[entry.path.split('/').pop()!] = entry.signedUrl
  }
  return reply({ urls })
}

// --- The shared music bank (songs.ts) ------------------------------------------
//
// Every login's phones see the same songs: rows `song:<id>` in cutter_config,
// files at music/<sha> in the bucket. Only reached after a valid login.

/** A space's songs: the owner's bank as it always was; any other login has
 *  its own (invite.ts songPrefix). */
async function allSongs(spaceId: string): Promise<SharedSong[]> {
  const prefix = songPrefix(spaceId, await ownerSpace())
  const { data, error } = await db.from('cutter_config').select('value').like('key', `${prefix}%`)
  if (error) throw new Error('The server could not read the music bank.')
  return songsFrom((data ?? []) as { value: string }[])
}

async function songFileThere(sha: string): Promise<boolean> {
  const { data } = await db.storage.from(BUCKET).list(MUSIC_DIR, { search: sha, limit: 1 })
  return (data ?? []).some((f: { name: string }) => f.name === sha)
}

async function songs(spaceId: string): Promise<Response> {
  return reply({ songs: await allSongs(spaceId) })
}

async function songUpload(body: Record<string, unknown>): Promise<Response> {
  const sha = typeof body.sha === 'string' && SHA.test(body.sha) ? body.sha : null
  if (!sha) return reply({ error: 'Which song?' }, 400)
  const { data } = await db.storage.from(BUCKET).createSignedUploadUrl(`${MUSIC_DIR}/${sha}`)
  // No URL: it is there already - named by what is in it, nothing to replace.
  return reply({ url: data?.signedUrl ?? null })
}

async function addSong(spaceId: string, body: Record<string, unknown>): Promise<Response> {
  const song = cleanSong(body.song)
  if (!song) return reply({ error: 'That song could not be added.' }, 400)
  const same = sameSong(await allSongs(spaceId), song)
  if (same) return reply({ song: same })
  // Only once its file is up, so no phone ever sees a song it can't play.
  if (!(await songFileThere(song.sha))) return reply({ error: "The song's file hasn't arrived yet.", later: true }, 409)
  const key = `${songPrefix(spaceId, await ownerSpace())}${song.id}`
  const { error } = await db.from('cutter_config').upsert({ key, value: JSON.stringify(song) }, { onConflict: 'key' })
  if (error) return reply({ error: 'The server could not keep the song.' }, 500)
  return reply({ song })
}

async function renameSong(spaceId: string, body: Record<string, unknown>): Promise<Response> {
  const id = typeof body.id === 'string' ? body.id : ''
  const song = (await allSongs(spaceId)).find((s) => s.id === id)
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : ''
  if (!song || !name) return reply({ song: song ?? null })
  const renamed = { ...song, name }
  const { error } = await db.from('cutter_config').update({ value: JSON.stringify(renamed) }).eq('key', `${songPrefix(spaceId, await ownerSpace())}${song.id}`)
  if (error) return reply({ error: 'The server could not rename the song.' }, 500)
  return reply({ song: renamed })
}

async function removeSong(spaceId: string, body: Record<string, unknown>): Promise<Response> {
  const id = typeof body.id === 'string' ? body.id : ''
  const song = (await allSongs(spaceId)).find((s) => s.id === id)
  if (!song) return reply({ removed: false })
  const { error } = await db.from('cutter_config').delete().eq('key', `${songPrefix(spaceId, await ownerSpace())}${song.id}`)
  if (error) return reply({ error: 'The server could not take the song out.' }, 500)
  // Its file too, unless another song - any login's - is the same file.
  const { data: rows } = await db.from('cutter_config').select('value').like('key', 'song%')
  const everyone = songsFrom((rows ?? []) as { value: string }[])
  if (!everyone.some((s) => s.sha === song.sha)) await db.storage.from(BUCKET).remove([`${MUSIC_DIR}/${song.sha}`])
  return reply({ removed: true })
}

async function songUrls(spaceId: string, body: Record<string, unknown>): Promise<Response> {
  // Only this login's own songs.
  const mine = new Set((await allSongs(spaceId)).map((s) => s.sha))
  const shas = (Array.isArray(body.shas) ? body.shas : []).filter((s): s is string => typeof s === 'string' && SHA.test(s) && mine.has(s))
  if (shas.length === 0) return reply({ urls: {} })
  const { data, error } = await db.storage.from(BUCKET).createSignedUrls(
    shas.slice(0, 100).map((sha) => `${MUSIC_DIR}/${sha}`),
    3600,
  )
  if (error) return reply({ error: 'The server could not find the songs.' }, 500)
  const urls: Record<string, string> = {}
  for (const entry of data ?? []) {
    if (entry.signedUrl && entry.path) urls[entry.path.split('/').pop()!] = entry.signedUrl
  }
  return reply({ urls })
}

const KINDS = new Set(['failed', 'retried', 'fallback', 'interrupted', 'lost-pick', 'empty-pick', 'check', 'crash'])
const MAX_REPORTS = 20

function text(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.trim() ? value.slice(0, max) : null
}

/** A small plain object, or null - never anything big enough to matter. */
function smallObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const json = JSON.stringify(value)
  return json.length <= 2000 ? (value as Record<string, unknown>) : null
}

async function report(body: Record<string, unknown>): Promise<Response> {
  const incoming = Array.isArray(body.reports) ? body.reports.slice(0, MAX_REPORTS) : []
  const rows = incoming
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .map((r) => ({
      page: r.page === 'cut' ? 'cut' : 'campaign',
      kind: typeof r.kind === 'string' && KINDS.has(r.kind) ? r.kind : 'failed',
      phase: text(r.phase, 40),
      message: text(r.message, 2000) ?? '(no message)',
      version: text(r.version, 40),
      login: text(r.login, 80),
      happened_at: typeof r.at === 'string' && !Number.isNaN(Date.parse(r.at)) ? r.at : null,
      device: smallObject(r.device),
      video: smallObject(r.video),
    }))
  if (rows.length === 0) return reply({ stored: 0 })
  const { error } = await db.from('cutter_errors').insert(rows)
  if (error) return reply({ error: 'Could not store the report.' }, 500)
  return reply({ stored: rows.length })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return reply({ error: 'POST only.' }, 405)
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return reply({ error: 'Not JSON.' }, 400)
  }
  if (body.action === 'login') return login(body)
  if (body.action === 'accept-invite') return acceptInvite(body)
  if (body.action === 'report') return report(body)

  const spaceId = await spaceFor(body.token)
  if (!spaceId) return reply({ error: 'signed-out' }, 401)
  switch (body.action) {
    case 'pull':
      return pull(spaceId, body)
    case 'push':
      return push(spaceId, body)
    case 'upload-urls':
      return uploadUrls(spaceId, body)
    case 'download-urls':
      return downloadUrls(spaceId, body)
    case 'whoami':
      // The engine (engine/) checks a phone's login with this: a valid token
      // gets its space's id back, nothing more.
      return reply({ space: spaceId })
    case 'invite':
      return invite(spaceId, body)
    case 'people':
      return people(spaceId)
    case 'pause':
      return pause(spaceId, body)
    case 'remove-device':
      return removeDevice(spaceId, body)
    case 'songs':
      return songs(spaceId).catch((error) => reply({ error: (error as Error).message }, 500))
    case 'song-upload':
      return songUpload(body)
    case 'add-song':
      return addSong(spaceId, body).catch((error) => reply({ error: (error as Error).message }, 500))
    case 'rename-song':
      return renameSong(spaceId, body).catch((error) => reply({ error: (error as Error).message }, 500))
    case 'remove-song':
      return removeSong(spaceId, body).catch((error) => reply({ error: (error as Error).message }, 500))
    case 'song-urls':
      return songUrls(spaceId, body).catch((error) => reply({ error: (error as Error).message }, 500))
    default:
      return reply({ error: 'Unknown action.' }, 400)
  }
})
