// The Cutter on the server (server/main.mjs): this same app, opened headless
// in Chrome, makes the batches of the campaigns the phone moved there - the
// same top-ups, mixing, rendering and sending as on the phone, so the same
// videos; only the phone is left out of it.
//
// What is different here, and only here (SERVER_MODE):
//   - signed in as the phone that connected the server, with its posting
//     profile (the server hands both over at /local/session);
//   - always "on screen": the app makes and sends only while it is;
//   - Chrome on Linux writes no AAC, so mediabunny's own AAC encoder does;
//   - the bank's clips are read from the server's disk (store.loadBankFile);
//   - the phone's settings and asks arrive in the server's inbox, and the
//     progress goes back to it (/local/status) for the phone to show.

import { canEncodeAudio } from 'mediabunny'

import { fromPhone, type BatchBank } from './batch'
import { SERVER_MODE } from './serverFlag'
import { loadBatchBank, saveBatchBank } from './store'

/** A bank arrived or changed: make what is due now rather than at the next half hour. */
export const SERVER_BANKS_EVENT = 'cutter:server-banks'
/** Start over, or hand back to the phone: CampaignApp has the jobs to do it with. */
export const SERVER_COMMAND_EVENT = 'cutter:server-command'

export interface ServerCommand {
  id: string
  campaignId: string
  command: 'start-over' | 'back-to-phone'
  /** Called by whoever carried it out. */
  done: () => void
}

const CAMPAIGNS_KEY = 'server.campaigns'
const INBOX_EVERY_MS = 10_000
const STATUS_EVERY_MS = 30_000

function serverCampaigns(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(CAMPAIGNS_KEY) ?? '[]') as unknown
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function keepServerCampaigns(ids: string[]): void {
  localStorage.setItem(CAMPAIGNS_KEY, JSON.stringify([...new Set(ids)]))
}

/** A line in the server's log. */
export function serverLog(line: string): void {
  if (!SERVER_MODE) return
  void fetch('/local/log', { method: 'POST', body: line.slice(0, 4000) }).catch(() => {})
}

/** Everything the app needs before it starts, on the server; nothing on a phone. */
export async function startServerMode(): Promise<void> {
  if (!SERVER_MODE) return
  for (const [key, value] of [
    ['visibilityState', 'visible'],
    ['hidden', false],
  ] as const) {
    Object.defineProperty(document, key, { get: () => value, configurable: true })
  }
  // Loaded only here, never on a phone (vite.config.ts keeps it out of what a
  // phone downloads).
  if (!(await canEncodeAudio('aac'))) (await import('@mediabunny/aac-encoder')).registerAacEncoder()

  const res = await fetch('/local/session')
  if (!res.ok) throw new Error('This server is not connected yet: connect it from the Cutter on the phone, in Settings.')
  const session = (await res.json()) as { token: string; name?: string; posting?: unknown }
  localStorage.setItem('cutter.session', JSON.stringify({ name: session.name ?? 'server', token: session.token }))
  if (session.posting && typeof session.posting === 'object') {
    localStorage.setItem('cutter.posting', JSON.stringify({ ...(session.posting as object), sendHere: true }))
  }

  window.addEventListener('error', (e) => serverLog(`error: ${e.message}`))
  window.addEventListener('unhandledrejection', (e) => serverLog(`unhandled: ${e.reason instanceof Error ? e.reason.message : String(e.reason)}`))
  serverLog(`started, version ${__APP_VERSION__}`)

  void inboxLoop()
  void statusLoop()
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function inboxLoop(): Promise<void> {
  for (;;) {
    try {
      await takeInbox()
    } catch (error) {
      serverLog(`inbox: ${error instanceof Error ? error.message : String(error)}`)
    }
    await wait(INBOX_EVERY_MS)
  }
}

/** The phone's latest settings, merged into what the server has made so far
 *  (batch.fromPhone), and its asks, handed to CampaignApp. */
async function takeInbox(): Promise<void> {
  const box = (await (await fetch('/local/inbox')).json()) as {
    banks: Record<string, { bank: BatchBank; at: string }>
    commands: { id: string; campaignId: string; command: ServerCommand['command'] }[]
  }
  const taken: { banks: Record<string, string>; commands: string[] } = { banks: {}, commands: [] }
  let changed = false
  for (const [campaignId, { bank, at }] of Object.entries(box.banks ?? {})) {
    const here = await loadBatchBank(campaignId)
    await saveBatchBank(fromPhone(here, { ...bank, campaignId }))
    keepServerCampaigns([...serverCampaigns(), campaignId])
    taken.banks[campaignId] = at
    changed = true
  }
  for (const command of box.commands ?? []) {
    const carried = await new Promise<boolean>((resolve) => {
      window.dispatchEvent(new CustomEvent<ServerCommand>(SERVER_COMMAND_EVENT, { detail: { ...command, done: () => resolve(true) } }))
      // Nobody listening yet (the app still starting): asked again next time.
      setTimeout(() => resolve(false), 120_000)
    })
    if (!carried) continue
    taken.commands.push(command.id)
    if (command.command === 'back-to-phone') keepServerCampaigns(serverCampaigns().filter((id) => id !== command.campaignId))
    changed = true
  }
  if (taken.commands.length > 0 || Object.keys(taken.banks).length > 0) {
    await fetch('/local/inbox/done', { method: 'POST', body: JSON.stringify(taken) })
  }
  if (changed) window.dispatchEvent(new Event(SERVER_BANKS_EVENT))
}

export interface ServerMaking {
  queued: number
  now: string | null
}

/** What the server is doing, for the phone's Batch tab. */
export interface ServerProgress {
  /** Per campaign: its bank as the server has it. */
  banks: Record<string, BatchBank>
  /** Per campaign: its videos waiting to be made, and the one being made. */
  making?: Record<string, ServerMaking>
  version: string
  signedIn: boolean
  posting: boolean
}

/** Set by CampaignApp: the jobs it has, for the status. */
let makingNow: () => ServerProgress['making'] = () => undefined
export function reportMaking(read: () => ServerProgress['making']): void {
  makingNow = read
}

async function statusLoop(): Promise<void> {
  for (;;) {
    try {
      const banks: Record<string, BatchBank> = {}
      for (const id of serverCampaigns()) {
        const bank = await loadBatchBank(id)
        if (bank) banks[id] = bank
      }
      const status: ServerProgress = {
        banks,
        making: makingNow(),
        version: __APP_VERSION__,
        signedIn: Boolean(localStorage.getItem('cutter.session')),
        posting: Boolean(localStorage.getItem('cutter.posting')),
      }
      await fetch('/local/status', { method: 'POST', body: JSON.stringify(status) })
    } catch (error) {
      serverLog(`status: ${error instanceof Error ? error.message : String(error)}`)
    }
    await wait(STATUS_EVERY_MS)
  }
}
