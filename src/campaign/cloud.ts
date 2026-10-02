// The shared login: one name and password that he and his friend both sign
// in with, so their campaigns, angles and picture bank are the same on both
// phones, and backed up.
//
// Local first, like everything else here: every change lands on the phone
// and is usable at once, then goes to the shared login in the background -
// and waits in a queue when there is no signal. Coming the other way, a
// change is taken when it is newer than what the phone has. Two edits to the
// same campaign: the later one wins.
//
// Videos never go anywhere. Only the setups, and the logos, pictures and
// sounds in them - which travel as files named by the hash of their contents,
// so the same picture is only ever uploaded once.
//
// Signed in stays signed in: the token is kept on the phone until he signs
// out, however often the app is closed.

import {
  applyRemote,
  cacheFile,
  cachedFile,
  enqueueEverything,
  getMeta,
  markSent,
  markUploaded,
  outboxEntries,
  setMeta,
  storedRow,
  type OutboxEntry,
  type StoredFile,
  type StoredRow,
} from './store'

const FUNCTION_URL = 'https://uykuoibqdxmpbbrsmyad.supabase.co/functions/v1/cutter'
/** The project's publishable key - public by design; the function checks the
 *  login itself. */
export const PUBLISHABLE_KEY = 'sb_publishable_UhAfC6SJRmnDOR5Y10CmPg_DFepNyVA'

const SESSION_KEY = 'cutter.session'
const LAST_PULL = 'lastPull'

export interface Session {
  name: string
  token: string
}

export function currentSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    return raw ? (JSON.parse(raw) as Session) : null
  } catch {
    return null
  }
}

function keepSession(session: Session | null): void {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session))
    else localStorage.removeItem(SESSION_KEY)
  } catch {
    // Storage blocked: signed in for this visit only.
  }
}

export class CloudError extends Error {}

/** fetch, with a lost connection said plainly. */
async function reach(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init)
  } catch {
    throw new CloudError('No connection. Your changes are kept and go when there is signal.')
  }
}

async function call<T>(action: string, body: Record<string, unknown>): Promise<T> {
  let response: Response
  try {
    response = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: PUBLISHABLE_KEY },
      body: JSON.stringify({ action, ...body }),
    })
  } catch {
    throw new CloudError('No connection. Your changes are kept and go when there is signal.')
  }
  const json = (await response.json().catch(() => ({}))) as T & { error?: string }
  if (!response.ok) {
    if (json.error === 'signed-out') {
      keepSession(null)
      throw new CloudError('signed-out')
    }
    throw new CloudError(json.error ?? `The server said ${response.status}.`)
  }
  return json
}

/** Signs in, or - with `create` - makes the login first. The first sign-in
 *  on a phone also sends everything already on it, so nothing set up before
 *  signing in is left behind. */
export async function signIn(name: string, password: string, create = false): Promise<Session> {
  const { token, name: signedAs } = await call<{ token: string; name: string }>('login', { name, password, create })
  const session = { name: signedAs, token }
  keepSession(session)
  await setMeta(LAST_PULL, null)
  await enqueueEverything()
  return session
}

export function signOut(): void {
  keepSession(null)
  void setMeta(LAST_PULL, null)
}

// --- Files -------------------------------------------------------------------

type FileRef = { ref: string; type: string }

function isStoredFile(value: unknown): value is StoredFile {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as StoredFile).bytes instanceof ArrayBuffer &&
    typeof (value as StoredFile).type === 'string'
  )
}

function isFileRef(value: unknown): value is FileRef {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as FileRef).ref === 'string' &&
    /^[0-9a-f]{64}$/.test((value as FileRef).ref) &&
    typeof (value as FileRef).type === 'string'
  )
}

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** A copy of `value` with every file swapped for a reference to it, and the
 *  files it referred to. */
async function toWire(value: unknown, files: Map<string, StoredFile>): Promise<unknown> {
  if (isStoredFile(value)) {
    const sha = await sha256(value.bytes)
    files.set(sha, value)
    return { ref: sha, type: value.type }
  }
  if (Array.isArray(value)) return Promise.all(value.map((v) => toWire(v, files)))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = await toWire(v, files)
    return out
  }
  return value
}

function refsIn(value: unknown, into = new Set<string>()): Set<string> {
  if (isFileRef(value)) into.add(value.ref)
  else if (Array.isArray(value)) value.forEach((v) => refsIn(v, into))
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => refsIn(v, into))
  return into
}

function fromWire(value: unknown, files: Map<string, StoredFile>): unknown {
  if (isFileRef(value)) {
    const file = files.get(value.ref)
    if (!file) throw new CloudError('A shared picture or sound could not be fetched.')
    return file
  }
  if (Array.isArray(value)) return value.map((v) => fromWire(v, files))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = fromWire(v, files)
    return out
  }
  return value
}

async function upload(token: string, files: Map<string, StoredFile>): Promise<void> {
  const waiting: { sha: string; file: StoredFile }[] = []
  for (const [sha, file] of files) {
    const cached = await cachedFile(sha)
    if (cached?.uploaded) continue
    if (!cached) await cacheFile({ sha, bytes: file.bytes, type: file.type, uploaded: false })
    waiting.push({ sha, file })
  }
  if (waiting.length === 0) return
  const { uploads } = await call<{ uploads: { sha: string; url: string }[] }>('upload-urls', {
    token,
    files: waiting.map((w) => ({ sha: w.sha })),
  })
  const urls = new Map(uploads.map((u) => [u.sha, u.url]))
  for (const { sha, file } of waiting) {
    const url = urls.get(sha)
    if (url) {
      const form = new FormData()
      form.append('cacheControl', '31536000')
      form.append('', new Blob([file.bytes], { type: file.type }))
      const response = await reach(url, { method: 'PUT', body: form, headers: { apikey: PUBLISHABLE_KEY, 'x-upsert': 'false' } })
      if (!response.ok) {
        // A file already there answers "Duplicate" / "already exists" - and,
        // named by its contents, it is the same file. Anything else is a
        // real failure, and the picture is tried again next time.
        const said = await response.text().catch(() => '')
        if (!/duplicate|already exists/i.test(said)) {
          throw new CloudError(`A picture could not be sent (${response.status}).`)
        }
      }
    }
    await markUploaded(sha)
  }
}

async function download(token: string, shas: Set<string>): Promise<Map<string, StoredFile>> {
  const files = new Map<string, StoredFile>()
  const missing: string[] = []
  for (const sha of shas) {
    const cached = await cachedFile(sha)
    if (cached) files.set(sha, { bytes: cached.bytes, type: cached.type })
    else missing.push(sha)
  }
  if (missing.length === 0) return files
  const { urls } = await call<{ urls: Record<string, string> }>('download-urls', { token, shas: missing })
  for (const sha of missing) {
    const url = urls[sha]
    if (!url) continue
    const response = await reach(url)
    if (!response.ok) continue
    const blob = await response.blob()
    const bytes = await blob.arrayBuffer()
    if ((await sha256(bytes)) !== sha) continue
    const file = { bytes, type: blob.type }
    await cacheFile({ sha, ...file, uploaded: true })
    files.set(sha, file)
  }
  return files
}

// --- Sync --------------------------------------------------------------------

interface WireItem {
  kind: 'campaign' | 'bank'
  id: string
  data: unknown
  updated_at: number
  deleted: boolean
}

async function pushAll(token: string): Promise<void> {
  const entries = await outboxEntries()
  for (let i = 0; i < entries.length; i += 20) {
    const batch = entries.slice(i, i + 20)
    const files = new Map<string, StoredFile>()
    const items: WireItem[] = []
    const sent: OutboxEntry[] = []
    for (const entry of batch) {
      if (entry.deleted) {
        items.push({ kind: entry.kind, id: entry.id, data: null, updated_at: entry.updatedAt, deleted: true })
        sent.push(entry)
        continue
      }
      const row: StoredRow | undefined = await storedRow(entry.kind, entry.id)
      if (!row) {
        // Deleted since it was queued; the deletion has its own entry.
        await markSent(entry)
        continue
      }
      items.push({ kind: entry.kind, id: entry.id, data: await toWire(row, files), updated_at: entry.updatedAt, deleted: false })
      sent.push(entry)
    }
    // Files first, so a campaign never arrives before its pictures.
    await upload(token, files)
    if (items.length > 0) await call('push', { token, items })
    for (const entry of sent) await markSent(entry)
  }
}

async function pullAll(token: string): Promise<boolean> {
  let since = await getMeta(LAST_PULL)
  let changed = false
  for (;;) {
    const { items, until } = await call<{
      items: (WireItem & { server_at: string })[]
      until: string | null
    }>('pull', { token, since })
    for (const item of items) {
      const updatedAt = Number(item.updated_at)
      if (item.deleted || item.data === null) {
        changed = (await applyRemote(item.kind, item.id, updatedAt, null)) || changed
        continue
      }
      const files = await download(token, refsIn(item.data))
      const row = fromWire(item.data, files) as StoredRow
      changed = (await applyRemote(item.kind, item.id, updatedAt, row)) || changed
    }
    since = until
    if (since) await setMeta(LAST_PULL, since)
    if (items.length < 1000) break
  }
  return changed
}

export type SyncState =
  | { kind: 'signed-out' }
  | { kind: 'syncing' }
  | { kind: 'synced'; at: number }
  | { kind: 'waiting'; reason: string }

let running: Promise<boolean> | null = null
let again = false

/** Sends what is waiting and takes what is new. Says whether anything on
 *  this phone changed. One at a time; a call while one runs makes it go
 *  round once more. */
export function syncNow(): Promise<boolean> {
  if (running) {
    again = true
    return running
  }
  running = (async () => {
    let changed = false
    try {
      do {
        again = false
        const session = currentSession()
        if (!session) return changed
        await pushAll(session.token)
        changed = (await pullAll(session.token)) || changed
      } while (again)
      return changed
    } finally {
      running = null
    }
  })()
  return running
}
