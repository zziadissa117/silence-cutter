// This page is the Cutter server's (server/main.mjs, serverMode.ts): the app
// itself, headless in Chrome on a server, making the batches the phone moved
// there. Only ever true on that machine: the server opens the app at its own
// localhost with ?server=1.

export const SERVER_MODE =
  typeof location !== 'undefined' &&
  new URLSearchParams(location.search).get('server') === '1' &&
  (location.hostname === 'localhost' || location.hostname === '127.0.0.1')

/** Where the phone keeps the server's address (serverLink.ts). */
export const SERVER_URL_KEY = 'cutter.server'

/** On a phone: a Cutter server is connected, so the batches are made there. */
export function serverConnected(): boolean {
  if (SERVER_MODE) return false
  try {
    return Boolean(localStorage.getItem(SERVER_URL_KEY))
  } catch {
    return false
  }
}
