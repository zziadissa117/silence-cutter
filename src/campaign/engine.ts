// The engine (engine/ in this repo, on Railway): Le plateau's renders on a
// server, so a big batch is made with the phone closed. The phone sets it up
// and sends it the footage; the engine makes the videos - many from each take,
// each a little different, never a near-copy - and sends them through the same
// posting pipeline, so they wait in Posts like any batch: watch one, then
// Approve all.
//
// Every call carries this phone's Cutter login; the engine checks it with the
// login function. Its address is set in Settings and kept on this phone.

import { currentSession } from './cloud'

const URL_KEY = 'cutter.engine'
const SENT_KEY = 'cutter.engineSent'

export interface EngineFile {
  name: string
  size: number
}

export interface EngineJob {
  id: string
  status: 'waiting' | 'making' | 'done' | 'failed' | 'stopped'
  campaign: string
  batchId: string
  total: number
  sent: number
  rejected: number
  skipped: number
  error?: string | null
  at: number
}

export interface EngineStatus {
  series: { campaign: string; settings: { hooks: string[] }; files: { hook: EngineFile[]; product: EngineFile[] } }[]
  songs: { name: string; start: number; seconds: number }[]
  jobs: EngineJob[]
  disk: { usedGB: number; freeGB: number }
  claude: boolean
}

export class EngineError extends Error {}

export function engineUrl(): string | null {
  try {
    return localStorage.getItem(URL_KEY)
  } catch {
    return null
  }
}

/** The engine's address as he typed it, made into one: https, no trailing slash. */
export function cleanEngineUrl(typed: string): string | null {
  let url = typed.trim().replace(/\/+$/, '')
  if (!url) return null
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.hostname === 'localhost' ? parsed.origin : null
  } catch {
    return null
  }
}

export function setEngineUrl(url: string | null): void {
  try {
    if (url) localStorage.setItem(URL_KEY, url)
    else localStorage.removeItem(URL_KEY)
  } catch {
    // Kept for this visit only.
  }
}

async function call<T>(method: string, path: string, body?: unknown, raw?: Blob): Promise<T> {
  const base = engineUrl()
  if (!base) throw new EngineError('Connect the engine in Settings first.')
  const session = currentSession()
  if (!session) throw new EngineError('Sign in with the shared login first, in Settings.')
  let response: Response
  try {
    response = await fetch(`${base}${path}`, {
      method,
      headers: { authorization: `Bearer ${session.token}`, ...(raw ? {} : body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
    })
  } catch {
    throw new EngineError("The engine can't be reached. Check the signal, and that it's running on Railway.")
  }
  const json = (await response.json().catch(() => ({}))) as T & { error?: string }
  if (!response.ok) {
    if (json.error === 'signed-out') throw new EngineError('The engine did not accept this login. Sign in again in Settings.')
    throw new EngineError(json.error ?? `The engine said ${response.status}.`)
  }
  return json
}

export const engineStatus = () => call<EngineStatus>('GET', '/status')

export const saveEngineSeries = (campaignId: string, settings: { name?: string; hooks?: string[] }) =>
  call<{ settings: unknown }>('PUT', `/series/${encodeURIComponent(campaignId)}`, settings)

/** Sends one file in pieces; a dropped connection costs one piece, tried again. */
export async function uploadToEngine(
  kind: 'hook' | 'product' | 'song',
  campaignId: string,
  file: Blob,
  name: string,
  onProgress?: (fraction: number) => void,
): Promise<string> {
  const started = await call<{ id: string; parts: number; partBytes: number }>('POST', '/uploads', {
    kind,
    campaign: campaignId,
    name,
    size: file.size,
  })
  for (let part = 0; part < started.parts; part++) {
    const piece = file.slice(part * started.partBytes, (part + 1) * started.partBytes)
    for (let attempt = 1; ; attempt++) {
      try {
        await call('PUT', `/uploads/${started.id}/${part}`, undefined, piece)
        break
      } catch (error) {
        if (attempt >= 3) throw error
        await new Promise((resolve) => setTimeout(resolve, attempt * 2000))
      }
    }
    onProgress?.((part + 1) / started.parts)
  }
  const done = await call<{ clip?: string; song?: string }>('POST', `/uploads/${started.id}/finish`)
  return done.clip ?? done.song ?? name
}

export const makeOnEngine = (request: {
  campaign: { id: string; name: string; posting: unknown }
  profile: string
  batchId: string
  slots: { date: string; time: string }[]
}) => call<{ job: EngineJob }>('POST', '/make', request).then((r) => r.job)

export const engineJob = (id: string) => call<{ job: EngineJob }>('GET', `/jobs/${id}`).then((r) => r.job)

export const stopEngineJob = (id: string) => call<{ stopped: boolean }>('POST', `/jobs/${id}/stop`)

/** A batch the engine stopped (a restart, a failure) carried on: what already went is not made again. */
export const carryOnEngineJob = (id: string) => call<{ job: EngineJob }>('POST', `/jobs/${id}/again`).then((r) => r.job)

// --- Which of the bank's files are on the engine already ---------------------

function sentMap(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(SENT_KEY) ?? '{}') as Record<string, string>
  } catch {
    return {}
  }
}

function rememberSent(key: string, name: string): void {
  try {
    localStorage.setItem(SENT_KEY, JSON.stringify({ ...sentMap(), [key]: name }))
  } catch {
    // Sent again next time - the engine keeps both, harmless.
  }
}

export const sentKey = (kind: string, campaignId: string, fileId: string) => (kind === 'song' ? `song:${fileId}` : `${campaignId}:${kind}:${fileId}`)

/** The bank files the engine doesn't have yet: never sent from here, or
 *  sent but no longer there. */
export function stillToSend<T extends { id: string }>(
  files: T[],
  kind: 'hook' | 'product' | 'song',
  campaignId: string,
  onEngine: string[],
  sent: Record<string, string> = sentMap(),
): T[] {
  const there = new Set(onEngine)
  return files.filter((f) => {
    const name = sent[sentKey(kind, campaignId, f.id)]
    return !name || !there.has(name)
  })
}

/** Sends what the engine is missing of a campaign's bank, saying how far it got. */
export async function sendFootage(
  campaignId: string,
  bank: { reactions: { id: string; name: string }[]; products: { id: string; name: string }[]; music: { id: string; name: string }[] },
  load: (file: { id: string; name: string }) => Promise<Blob | null>,
  say: (line: string) => void,
): Promise<void> {
  const status = await engineStatus()
  const here = status.series.find((s) => s.campaign === campaignId)
  const groups: { kind: 'hook' | 'product' | 'song'; files: { id: string; name: string }[]; onEngine: string[] }[] = [
    { kind: 'hook', files: bank.reactions, onEngine: (here?.files.hook ?? []).map((f) => f.name) },
    { kind: 'product', files: bank.products, onEngine: (here?.files.product ?? []).map((f) => f.name) },
    { kind: 'song', files: bank.music, onEngine: status.songs.map((s) => s.name) },
  ]
  const todo = groups.flatMap((g) => stillToSend(g.files, g.kind, campaignId, g.onEngine).map((file) => ({ kind: g.kind, file })))
  for (const [i, { kind, file }] of todo.entries()) {
    const blob = await load(file)
    if (!blob) continue
    const counting = `${i + 1} of ${todo.length}`
    say(`Sending ${counting} to the engine - ${file.name}…`)
    const name = await uploadToEngine(kind, campaignId, blob, file.name, (p) => say(`Sending ${counting} to the engine - ${Math.round(p * 100)}%`))
    rememberSent(sentKey(kind, campaignId, file.id), name)
  }
}
