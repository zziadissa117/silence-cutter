// Starting, keeping and ending the demo (flag.ts says which).

import { DEMO_KEY, type DemoAsk } from './flag'
import { mediaUrl, seedPhone } from './seed'
import { forgetWorld, installServer, loadWorld, makeServer } from './server'

let installed = false

/** The pretend server in front of fetch, for this page. */
export function keepDemoServer(): void {
  if (installed) return
  installed = true
  const server = makeServer(loadWorld(mediaUrl))
  installServer(server)
  // Kept now, so the next page reads the same world.
  localStorage.setItem('cutter.demo.state', JSON.stringify(server.world))
}

/** Everything the Cutter keeps in this browser, on this address. */
async function wipe(): Promise<void> {
  const names = (await indexedDB.databases?.().catch(() => [])) ?? []
  await Promise.all(
    names
      .map((d) => d.name)
      .filter((name): name is string => Boolean(name))
      .map(
        (name) =>
          new Promise<void>((resolve) => {
            const ask = indexedDB.deleteDatabase(name)
            ask.onsuccess = ask.onerror = ask.onblocked = () => resolve()
          }),
      ),
  )
  try {
    const root = await navigator.storage?.getDirectory?.()
    if (root) for await (const name of (root as unknown as { keys(): AsyncIterable<string> }).keys()) await root.removeEntry(name, { recursive: true }).catch(() => {})
  } catch {
    // No private files here.
  }
  localStorage.clear()
  sessionStorage.clear()
}

/** The address without `demo=`, so a reload doesn't start it over. */
function cleanAddress(): void {
  const url = new URL(window.location.href)
  url.searchParams.delete('demo')
  history.replaceState(null, '', url.pathname + url.search + url.hash)
}

/** A computer's Chrome on Linux writes no AAC: the same encoder the Cutter
 *  server loads (serverMode.ts), so the demo can make real videos there. */
async function soundEncoder(): Promise<void> {
  const { canEncodeAudio } = await import('mediabunny')
  if (!(await canEncodeAudio('aac').catch(() => false))) (await import('@mediabunny/aac-encoder')).registerAacEncoder()
}

export async function startDemo(ask: DemoAsk): Promise<void> {
  if (ask === 'leave') {
    await wipe()
    forgetWorld()
    cleanAddress()
    window.location.reload()
    await new Promise(() => {})
  }
  if (ask === 'enter') {
    await wipe()
    forgetWorld()
    localStorage.setItem(DEMO_KEY, 'on')
  }
  keepDemoServer()
  await soundEncoder()
  if (ask === 'enter') {
    const { loadWorld: read } = await import('./server')
    await seedPhone(read(mediaUrl))
    cleanAddress()
  }
  document.title = `Demo · ${document.title}`
}
