// The Cutter server (server/ in this repo, on Railway), from the phone's
// side: this same app, running on a server, makes the batches day and night
// with the phone closed - the same videos it would make here. Once its
// address is in Settings, every batch is made there by itself: the phone sends
// it the clips (once each) and his settings (each time they change), and reads
// back what it has made, to show in the Batch tab. Nothing waits on it: the
// bank is kept on the phone first, as always, and goes up when there is signal.
//
// Every call carries this phone's Cutter login; the server checks it with the
// login function, and makes videos for that login and posting profile only.

import { fromPhone, PROGRESS_FIELDS, type BankFile, type BatchBank } from './batch'
import { handOver, oneAtATime } from './batchRun'
import { currentSession } from './cloud'
import { drawEmoji, drawsAppleEmoji, emojiSpritesFor } from './emojiSprites'
import type { Job } from './jobs'
import { listPosts, postingHere, type ServerPost } from './posting'
import { loadBankFile, loadBatchBank, saveBankFile, saveBatchBank } from './store'
import { SERVER_URL_KEY } from './serverFlag'
import type { ServerMaking, ServerProgress } from './serverMode'

const URL_KEY = SERVER_URL_KEY
/** Whether this app's login and posting profile went to the server since it opened. */
let connectedOnce = false
const SENT_KEY = 'cutter.serverSent'
const STATUS_KEY = 'cutter.serverStatus'
/** The server takes files in pieces this size at most (server/main.mjs). */
const PIECE = 8 * 1024 * 1024
/** Fired with { campaignId, changed } as clips go up, and with changed true
 *  when its bank changed here because of the server: handed over, or what it
 *  made read back. */
export const SERVER_LINK_EVENT = 'cutter:server-link'

export class ServerError extends Error {}

/** The server's disk and memory (server/main.mjs `room`). */
export interface ServerRoom {
  freeGB: number | null
  /** The whole disk (the Railway volume). */
  diskGB?: number | null
  /** The memory the server may use, when its machine says. */
  memoryGB?: number | null
}

/** What is wrong with the server's room, in his words - a free Railway plan
 *  (0.5 GB of disk and of memory) fills up in a batch's first minutes - or
 *  null when it is fine. */
export function roomProblem(room: ServerRoom | null | undefined): string | null {
  if (!room) return null
  const small = (room.diskGB ?? Infinity) < 1 || (room.memoryGB ?? Infinity) < 1
  if (small) {
    return `The server is too small to make videos (${room.diskGB ?? '?'} GB of disk, ${room.memoryGB ?? '?'} GB of memory) - that is Railway's free plan. Take the Hobby plan on Railway, then give the server a 5 GB volume.`
  }
  if (room.freeGB !== null && room.freeGB < 0.5) {
    return `The server's disk is almost full (${room.freeGB} GB free). Make its volume bigger on Railway (the Pro plan goes past 5 GB).`
  }
  return null
}

export interface ServerStatus extends ServerRoom {
  version: string
  chrome: 'running' | 'starting' | 'off'
  /** When this phone asked (its own clock): the server's page is quiet only
   *  if it had said nothing for a while at that moment - not because the
   *  phone hasn't asked lately. */
  askedAt?: string
  /** What the app on the server last said, and when. */
  page: (ServerProgress & { at: string }) | null
}

export function serverUrl(): string | null {
  try {
    return localStorage.getItem(URL_KEY)
  } catch {
    return null
  }
}

/** Fired on window when the server's address is set or taken out. */
export const SERVER_URL_EVENT = 'cutter:server-url'

export function setServerUrl(url: string | null): void {
  try {
    if (url) localStorage.setItem(URL_KEY, url)
    else localStorage.removeItem(URL_KEY)
    localStorage.removeItem(SENT_KEY)
    localStorage.removeItem(STATUS_KEY)
  } catch {
    // Kept for this visit only.
  }
  connectedOnce = false
  window.dispatchEvent(new Event(SERVER_URL_EVENT))
}

async function call<T>(method: string, path: string, body?: unknown, raw?: Blob): Promise<T> {
  const base = serverUrl()
  if (!base) throw new ServerError('Connect the server in Settings first.')
  const session = currentSession()
  if (!session) throw new ServerError('Sign in with the shared login first, in Settings.')
  let response: Response
  try {
    response = await fetch(`${base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${session.token}`,
        ...(raw ? {} : body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
    })
  } catch {
    throw new ServerError("The server can't be reached. Check the signal, and that it's running on Railway.")
  }
  const json = (await response.json().catch(() => ({}))) as T & {
    error?: string
  }
  if (!response.ok) throw new ServerError(json.error ?? `The server said ${response.status}.`)
  return json
}

/** Hands the server this phone's login and posting profile; it starts making. */
export function connectServer(): Promise<ServerRoom & { version: string }> {
  const session = currentSession()
  return call('POST', '/connect', {
    name: session?.name ?? null,
    posting: postingHere(),
  })
}

export async function serverStatus(): Promise<ServerStatus> {
  const status = { ...(await call<ServerStatus>('GET', '/status')), askedAt: new Date().toISOString() }
  try {
    localStorage.setItem(STATUS_KEY, JSON.stringify(status))
  } catch {
    // Shown from memory this visit.
  }
  return status
}

/** The server as it last said, for the screens while it is asked again. */
export function lastServerStatus(): ServerStatus | null {
  try {
    return JSON.parse(localStorage.getItem(STATUS_KEY) ?? 'null') as ServerStatus | null
  } catch {
    return null
  }
}

/** What the server is making for a campaign, as it last said. */
export function serverMaking(campaignId: string, status = lastServerStatus()): ServerMaking | null {
  return status?.page?.making?.[campaignId] ?? null
}

/** Start over, or hand the batch back to the phone: carried out on the server. */
export const serverCommand = (campaignId: string, command: 'start-over' | 'back-to-phone') =>
  call<{ ok: true }>('POST', `/banks/${encodeURIComponent(campaignId)}/${command}`)

/** Every file a bank's videos are made from. */
export function bankFiles(bank: BatchBank): BankFile[] {
  const all = [
    ...bank.reactions,
    ...bank.products,
    ...bank.music,
    ...(bank.steps ?? []).flatMap((s) => s.files),
    ...(bank.formula?.left ? [bank.formula.left] : []),
    ...(bank.formula?.right ? [bank.formula.right] : []),
    ...(bank.emojis ?? []),
  ]
  return [...new Map(all.map((f) => [f.id, f])).values()]
}

/** His settings, without what the making has done: what is sent again when it changes. */
export function settingsKey(bank: BatchBank): string {
  const rest: Record<string, unknown> = { ...bank }
  for (const key of PROGRESS_FIELDS) delete rest[key]
  return JSON.stringify(rest)
}

interface Sent {
  key: string
  at: number
}

function sentBanks(): Record<string, Sent> {
  try {
    return (JSON.parse(localStorage.getItem(SENT_KEY) ?? '{}') as Record<string, Sent>) ?? {}
  } catch {
    return {}
  }
}

function markSent(campaignId: string, sent: Sent | null): void {
  const all = sentBanks()
  if (sent) all[campaignId] = sent
  else delete all[campaignId]
  try {
    localStorage.setItem(SENT_KEY, JSON.stringify(all))
  } catch {
    // Sent again next time: harmless, the server merges it.
  }
}

/** What is being sent up for each campaign right now, and why the last try
 *  didn't go, for the Batch tab. */
const lines = new Map<string, string>()
const problems = new Map<string, string>()
export function sendingLine(campaignId: string): string | null {
  return lines.get(campaignId) ?? null
}
export function linkProblem(campaignId: string): string | null {
  return problems.get(campaignId) ?? null
}

export interface LinkEvent {
  campaignId: string
  changed: boolean
}

function tell(campaignId: string, changed: boolean): void {
  window.dispatchEvent(
    new CustomEvent<LinkEvent>(SERVER_LINK_EVENT, {
      detail: { campaignId, changed },
    }),
  )
}

function say(campaignId: string, line: string | null): void {
  if (line) lines.set(campaignId, line)
  else lines.delete(campaignId)
  tell(campaignId, false)
}

/** One file up, in pieces; a dropped connection costs one piece, tried again. */
async function sendFile(file: BankFile, blob: Blob, onPiece: (fraction: number) => void): Promise<void> {
  const total = Math.max(1, Math.ceil(blob.size / PIECE))
  const query = (n: number) =>
    `/files/${encodeURIComponent(file.id)}/${n}?total=${total}&size=${blob.size}&name=${encodeURIComponent(file.name)}&type=${encodeURIComponent(file.type || blob.type)}`
  for (let n = 0; n < total; n++) {
    for (let attempt = 1; ; attempt++) {
      try {
        await call('PUT', query(n), undefined, blob.slice(n * PIECE, (n + 1) * PIECE))
        break
      } catch (error) {
        if (attempt >= 3) throw error
        await new Promise((resolve) => setTimeout(resolve, 2000 * attempt))
      }
    }
    onPiece((n + 1) / total)
  }
}

/** The bank's files the server doesn't have yet, sent from this phone. */
async function sendFiles(bank: BatchBank): Promise<void> {
  const { files: there } = await call<{
    files: Record<string, { size: number }>
  }>('GET', '/files')
  const missing = bankFiles(bank).filter((f) => !there[f.id])
  const bytes = missing.reduce((n, f) => n + f.size, 0)
  let done = 0
  try {
    for (const [i, file] of missing.entries()) {
      const blob = await loadBankFile(file)
      // Gone from this phone: the video that needs it says so when it is made.
      if (!blob) continue
      await sendFile(file, blob, (fraction) => {
        const pct = Math.round(((done + fraction * file.size) / Math.max(1, bytes)) * 100)
        say(bank.campaignId, `Sending your clips to the server: ${i + 1} of ${missing.length} · ${pct}%`)
      })
      done += file.size
    }
  } finally {
    say(bank.campaignId, null)
  }
}

let running: Promise<void> | null = null
let again = false

/**
 * Every batch to the server: one still on this phone is handed over (its
 * clips sent, then the videos the phone had queued for it left to the server
 * - handOver), one there gets his latest settings, and what the server has
 * made is read back into the phone's copy (batch.fromPhone). One run at a
 * time; a call while one runs makes it go round once more.
 */
export function linkBatches(ctx: { campaignIds: string[]; jobs: () => readonly Job[]; removeJob: (id: string) => void }): Promise<void> {
  if (running) {
    again = true
    // A run can take many minutes - all the clips going up again after the
    // server's disk was new (2026-10-25) - and the Batch tab said "the server
    // went quiet" meanwhile: how the server is doing is still asked each time.
    if (serverUrl() && currentSession()) {
      void serverStatus()
        .then(() => ctx.campaignIds.forEach((id) => tell(id, false)))
        .catch(() => {})
    }
    return running
  }
  running = (async () => {
    try {
      do {
        again = false
        await linkOnce(ctx)
      } while (again)
    } finally {
      running = null
    }
  })()
  return running
}

async function linkOnce({
  campaignIds,
  jobs,
  removeJob,
}: {
  campaignIds: string[]
  jobs: () => readonly Job[]
  removeJob: (id: string) => void
}): Promise<void> {
  if (!serverUrl() || !currentSession() || !postingHere()) return
  // Once each time the app opens: a new login or posting profile reaches it.
  if (!connectedOnce) {
    await connectServer()
    connectedOnce = true
  }
  const status = await serverStatus()
  // Read once, and only if a batch is handed over.
  let posts: Promise<ServerPost[]> | null = null
  for (const campaignId of campaignIds) {
    try {
      await linkBank(campaignId, status, () => (posts ??= listPosts()), jobs, removeJob)
      if (problems.delete(campaignId)) tell(campaignId, false)
    } catch (error) {
      problems.set(campaignId, error instanceof Error ? error.message : String(error))
      tell(campaignId, false)
    }
  }
}

/** The emoji of his headlines drawn by this iPhone (emojiSprites.ts) and
 *  kept with the bank, so they go up with the clips and the server's videos
 *  show Apple's emoji, not Linux's. Only an iPhone's (or a Mac's) are drawn. */
async function withEmojis(campaignId: string, bank: BatchBank): Promise<BatchBank> {
  if (!drawsAppleEmoji()) return bank
  const emojis = await emojiSpritesFor(bank, saveBankFile, drawEmoji)
  if (!emojis) return bank
  // Read again right before: a change he made meanwhile is kept.
  const next = { ...((await loadBatchBank(campaignId)) ?? bank), emojis }
  await saveBatchBank(next)
  return next
}

async function linkBank(
  campaignId: string,
  status: ServerStatus,
  postsNow: () => Promise<ServerPost[]>,
  jobs: () => readonly Job[],
  removeJob: (id: string) => void,
): Promise<void> {
  const loaded = await loadBatchBank(campaignId)
  // The engine makes its own; an empty bank goes up once there is something in it.
  if (!loaded || loaded.layout === 'engine') return
  const bank = await withEmojis(campaignId, loaded)
  if (bank.where !== 'server') {
    if (bankFiles(bank).length === 0 && !bank.running) return
    await sendFiles(bank)
    const posts = await postsNow()
    // Inside the lock: never while this phone is topping the batch up.
    const handed = await oneAtATime(campaignId, async () => {
      const latest = (await loadBatchBank(campaignId)) ?? bank
      if (latest.where === 'server') return latest
      const next: BatchBank = {
        ...handOver({
          bank: latest,
          campaignId,
          jobs: jobs(),
          posts,
          removeJob,
        }),
        where: 'server',
        movedAt: new Date().toISOString(),
      }
      await saveBatchBank(next)
      return next
    })
    if (!handed) return
    tell(campaignId, true)
  }
  const here = await loadBatchBank(campaignId)
  if (!here || here.where !== 'server') return
  const there = status.page?.banks?.[campaignId] ?? null
  if (there && JSON.stringify(fromPhone(there, here)) !== JSON.stringify(here)) {
    // Read again right before: a change he made a moment ago is kept.
    const fresh = (await loadBatchBank(campaignId)) ?? here
    await saveBatchBank(fromPhone(there, fresh))
    tell(campaignId, true)
  }
  const latest = (await loadBatchBank(campaignId)) ?? here
  const sent = sentBanks()[campaignId]
  const key = settingsKey(latest)
  // Not seen there a minute after it went (a new server, its disk lost): again.
  const lost = !there && status.page !== null && Boolean(sent) && Date.parse(status.page.at) > sent.at + 60_000
  if (sent?.key === key && !lost) return
  await sendFiles(latest)
  await call('PUT', `/banks/${encodeURIComponent(campaignId)}`, {
    bank: latest,
  })
  markSent(campaignId, { key, at: Date.now() })
}

/**
 * The batch back on this phone (the server disconnected): the server is
 * asked to stop and drop what it hasn't started, and the phone takes over
 * from what the server last said it made, its days counted from the posts.
 */
export async function bringBack(campaignId: string, ctx: { jobs: () => readonly Job[]; removeJob: (id: string) => void }): Promise<void> {
  const bank = await loadBatchBank(campaignId)
  if (!bank || bank.where !== 'server') return
  await serverCommand(campaignId, 'back-to-phone').catch(() => {})
  const there = lastServerStatus()?.page?.banks?.[campaignId] ?? null
  const posts = await listPosts()
  await oneAtATime(campaignId, async () => {
    const latest = (await loadBatchBank(campaignId)) ?? bank
    const merged = fromPhone(there, latest)
    const next: BatchBank = {
      ...handOver({
        bank: merged,
        campaignId,
        jobs: ctx.jobs(),
        posts,
        removeJob: ctx.removeJob,
      }),
      where: undefined,
      movedAt: undefined,
    }
    await saveBatchBank(next)
  })
  markSent(campaignId, null)
  tell(campaignId, true)
}
