// Watching the Cutter server (server/main.mjs) from here (his ask,
// 2026-11-01: a notification when it stops making videos - his friend's
// server lost a day on 2026-10-25). Every 10 minutes it says "still here" to
// the login function (`server:<space>:<profile>` in cutter_config); this
// works out what is wrong, if anything, so he hears once when it goes wrong
// and once when it is right again.
//
// Plain TypeScript with no imports, for Deno and the tests.

export interface ServerPing {
  at: string
  chrome: 'running' | 'off'
  freeGB: number | null
  /** When the page inside last said where it is. */
  pageAt: string | null
  signedIn: boolean | null
  posting: boolean | null
}

export type ServerTrouble = 'quiet' | 'page' | 'disk' | 'signed-out'

/** Gone this long without a word: something is wrong. */
export const QUIET_MS = 30 * 60 * 1000
/** Less room than this on its disk: it may stop making videos. */
export const LOW_GB = 0.5
/** A server not heard from in this long was taken away: no more about it. */
export const GONE_MS = 7 * 24 * 60 * 60 * 1000

/** What is wrong with the server, as its last word says - or null. */
export function serverTrouble(ping: ServerPing, now: number): ServerTrouble | null {
  if (now - Date.parse(ping.at) > QUIET_MS) return 'quiet'
  if (ping.chrome !== 'running' || !ping.pageAt || now - Date.parse(ping.pageAt) > QUIET_MS) return 'page'
  if (ping.freeGB !== null && ping.freeGB < LOW_GB) return 'disk'
  if (ping.signedIn === false || ping.posting === false) return 'signed-out'
  return null
}

/** What he is told: when it goes wrong, and when it is right again. */
export function troubleNote(trouble: ServerTrouble | null, ping: ServerPing, now: number): { title: string; body: string } {
  const minutes = Math.round((now - Date.parse(ping.at)) / 60_000)
  switch (trouble) {
    case 'quiet':
      return {
        title: 'The Cutter server went quiet',
        body: `Not heard from in ${minutes < 120 ? `${minutes} minutes` : `${Math.round(minutes / 60)} hours`} - no batch videos are being made. Open Railway and check it's running.`,
      }
    case 'page':
      return { title: 'The Cutter server stopped making videos', body: "It's on, but the Cutter inside it has stopped. It restarts by itself; if this stays, restart it in Railway." }
    case 'disk':
      return { title: 'The Cutter server is nearly full', body: `Under ${LOW_GB} GB left (${ping.freeGB} GB) - it may stop making videos. Take old clips out of the Batch bank, or give it more space in Railway.` }
    case 'signed-out':
      return { title: 'The Cutter server is signed out', body: 'Connect it again: Settings, Server, on your phone.' }
    default:
      return { title: 'The Cutter server is making videos again', body: 'All good now.' }
  }
}
