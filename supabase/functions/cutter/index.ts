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
// CLOSED: this backend does not create logins. There is the one that already
// exists, plus one admin backup (below). `create` is ignored. Anyone else who
// calls login gets the same answer a wrong password gets, so nothing says
// which names exist.
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
//   pull           { token, since? }            -> { items, until }
//   push           { token, items }             -> { accepted }
//   upload-urls    { token, files: [{ sha }] }  -> { uploads: [{ sha, url }] }
//   download-urls  { token, shas }              -> { urls: { [sha]: url } }
//   report         { reports: [...] }            -> { stored }
//
// "report" needs no login: it is how a phone says a video failed, and a
// phone that is not signed in fails too. It only ever inserts, into a table
// nothing can read back through this function, and every field is capped.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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
async function makeToken(spaceId: string, passHash: string): Promise<string> {
  const payload = b64url(encoder.encode(JSON.stringify({ s: spaceId, p: passHash.slice(0, 12) })))
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', await signingKey(), encoder.encode(payload)))
  return `${payload}.${b64url(signature)}`
}

async function spaceFor(token: unknown): Promise<string | null> {
  if (typeof token !== 'string' || !token.includes('.')) return null
  const [payload, signature] = token.split('.')
  try {
    const valid = await crypto.subtle.verify('HMAC', await signingKey(), fromB64url(signature), encoder.encode(payload))
    if (!valid) return null
    const { s, p } = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as { s: string; p: string }
    const { data } = await db.from('cutter_spaces').select('id, pass_hash').eq('id', s).maybeSingle()
    return data && data.pass_hash.startsWith(p) ? data.id : null
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
    return reply({ token: await makeToken(space.id, space.pass_hash), name })
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
    default:
      return reply({ error: 'Unknown action.' }, 400)
  }
})
