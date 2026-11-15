// The one way into the demo, called by the two pages' entry files only
// inside `if (import.meta.env.DEV)` - so a build never contains it. With no
// demo asked for (flag.ts) it does nothing and the page starts as always.

import { demoAsked } from './flag'

/** Before the campaign page shows anything. */
export async function beforeApp(): Promise<void> {
  const ask = demoAsked()
  if (!ask) return
  const { startDemo } = await import('./start')
  await startDemo(ask)
}

/** Before the plain cutter ("Cut only") starts: the same pretend server, so
 *  nothing it sends (an error report) reaches the real one. Starting or
 *  ending the demo is the campaign page's. */
export async function beforePlainPage(): Promise<void> {
  const ask = demoAsked()
  if (!ask) return
  if (ask !== 'stay') {
    window.location.replace(`/campaign.html?demo=${ask === 'enter' ? '1' : '0'}`)
    await new Promise(() => {})
  }
  const { keepDemoServer, soundEncoder } = await import('./start')
  keepDemoServer()
  await soundEncoder()
}
