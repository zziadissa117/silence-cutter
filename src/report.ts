// Tells whoever fixes this app when something goes wrong on his phone, so a
// failure is seen without him having to type it out - at exactly the moment
// he has no time to.
//
// Only ever the error: what it said, the step it happened at, the version,
// the phone (browser and screen) and the video's size and type. Never the
// video, never anything in it. He agreed to exactly this.
//
// Reports wait in localStorage until they are sent, so one written with no
// signal goes out the next time there is some.

const FUNCTION_URL = 'https://uykuoibqdxmpbbrsmyad.supabase.co/functions/v1/cutter'
// Public by design: it only lets a request reach the function.
const PUBLISHABLE_KEY = 'sb_publishable_UhAfC6SJRmnDOR5Y10CmPg_DFepNyVA'
const QUEUE_KEY = 'reports.pending'
const MAX_WAITING = 20

export type ReportKind = 'failed' | 'retried' | 'fallback' | 'interrupted' | 'lost-pick' | 'empty-pick' | 'check' | 'crash'

export interface Report {
  /** Which section; worked out from the address when not given. */
  page?: 'cut' | 'campaign'
  kind: ReportKind
  message: string
  phase?: string
  video?: File | Blob | null
}

type Waiting = Record<string, unknown>

function waiting(): Waiting[] {
  try {
    const stored = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]') as unknown
    return Array.isArray(stored) ? (stored as Waiting[]) : []
  } catch {
    return []
  }
}

function keep(list: Waiting[]): void {
  try {
    if (list.length === 0) localStorage.removeItem(QUEUE_KEY)
    else localStorage.setItem(QUEUE_KEY, JSON.stringify(list.slice(-MAX_WAITING)))
  } catch {
    // Storage blocked: this report is simply not kept for later.
  }
}

/** The shared login's name, when signed in, so his reports and his
 *  friend's can be told apart. Read directly: cloud.ts belongs to the
 *  campaign page. */
function loginName(): string | null {
  try {
    const session = JSON.parse(localStorage.getItem('cutter.session') ?? 'null') as { name?: string } | null
    return session?.name ?? null
  } catch {
    return null
  }
}

let sending = false

/** Sends everything waiting. Quietly does nothing without a signal. */
export async function sendReports(): Promise<void> {
  if (sending) return
  const list = waiting()
  if (list.length === 0) return
  sending = true
  try {
    const response = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: PUBLISHABLE_KEY },
      body: JSON.stringify({ action: 'report', reports: list }),
      keepalive: true,
    })
    if (response.ok) {
      // Anything added while this was on its way stays for next time.
      const sent = new Set(list.map((r) => r.id))
      keep(waiting().filter((r) => !sent.has(r.id)))
    }
  } catch {
    // No signal. They stay for the next try.
  } finally {
    sending = false
  }
}

function thisPage(): 'cut' | 'campaign' {
  return location.pathname.includes('campaign') ? 'campaign' : 'cut'
}

/** How much this app keeps on the phone and how much it may, in MB - a full
 *  phone is behind more than one silent failure. */
async function storageNumbers(): Promise<{ usedMB: number; quotaMB: number } | null> {
  try {
    const { usage, quota } = await navigator.storage.estimate()
    if (usage === undefined || quota === undefined) return null
    return { usedMB: Math.round(usage / 1e6), quotaMB: Math.round(quota / 1e6) }
  } catch {
    return null
  }
}

/** Records what went wrong and sends it when it can. Never throws. */
export function report(details: Report): void {
  void storageNumbers()
    .catch(() => null)
    .then((storage) => record(details, storage))
}

function record({ page = thisPage(), kind, message, phase, video }: Report, storage: { usedMB: number; quotaMB: number } | null): void {
  try {
    const file = video instanceof File ? video : null
    keep([
      ...waiting(),
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        at: new Date().toISOString(),
        page,
        kind,
        phase,
        message: message.slice(0, 2000),
        version: __APP_VERSION__,
        login: loginName(),
        device: {
          agent: navigator.userAgent,
          screen: `${screen.width}x${screen.height}@${window.devicePixelRatio}`,
          installed: window.matchMedia?.('(display-mode: standalone)').matches ?? false,
          visible: document.visibilityState,
          storage,
        },
        video: video
          ? { size: video.size, type: video.type || null, extension: file?.name.split('.').pop()?.toLowerCase() ?? null }
          : null,
      },
    ])
    void sendReports()
  } catch {
    // Reporting must never be the thing that breaks.
  }
}

// Anything nothing else caught - including whatever would leave the page
// blank - is reported too, a few per visit at most.
let uncaught = 0
function reportUncaught(message: string): void {
  if (uncaught++ >= 5) return
  report({ kind: 'crash', phase: 'uncaught', message })
}

if (typeof window !== 'undefined') {
  window.addEventListener('error', (event) => {
    reportUncaught(`${event.message} (${event.filename?.split('/').pop() ?? '?'}:${event.lineno ?? '?'})`)
  })
  window.addEventListener('unhandledrejection', (event) => {
    const reason: unknown = event.reason
    reportUncaught(`Unhandled: ${reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason)}`)
  })
  window.addEventListener('online', () => void sendReports())
  // Whatever was left from last time.
  window.setTimeout(() => void sendReports(), 3000)
}
