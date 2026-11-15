// Demo mode: the Cutter filled with a made-up creator, campaigns, posts and
// numbers - for the guide's screenshots and for trying it out - on a
// computer's own dev server only (`npm run dev`, then `?demo=1`).
//
// Never in the real app: every use of this file sits behind
// `import.meta.env.DEV`, which a build replaces with `false`, so the build
// leaves the demo out altogether (checked in demo.test.ts). And on the dev
// server it only runs on this computer's own address.
//
// `?demo=1` starts it (this browser's Cutter storage on that address is
// wiped and filled with the made-up data), it stays on across reloads and
// pages, and `?demo=0` ends it (wiped again), so made-up campaigns can never
// be sent to a real login from that browser.

export const DEMO_KEY = 'cutter.demo'

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

export type DemoAsk = 'enter' | 'stay' | 'leave'

/** What the address and this browser ask of the demo: start it, keep it on,
 *  end it - or nothing (null), the app as it is. */
export function demoAsked(where: Pick<Location, 'hostname' | 'search'> = location, storage: Pick<Storage, 'getItem'> | null = safeStorage()): DemoAsk | null {
  if (!LOCAL_HOSTS.has(where.hostname)) return null
  const asked = new URLSearchParams(where.search).get('demo')
  if (asked === '1') return 'enter'
  const on = storage?.getItem(DEMO_KEY) === 'on'
  if (asked === '0') return on ? 'leave' : null
  return on ? 'stay' : null
}

function safeStorage(): Storage | null {
  try {
    return localStorage
  } catch {
    return null
  }
}
