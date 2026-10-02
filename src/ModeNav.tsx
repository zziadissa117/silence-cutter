// The two sections of the app, one tap apart: the plain cutter, which stays
// exactly as it was, and campaign videos, which cut and brand in one pass.
//
// They are separate pages rather than tabs so only one of them is ever
// running: two queues of video on a phone at once is how a tab gets killed
// for memory, and each page's update banner only knows about its own work.
// Leaving a page stops its work, so leaving asks first when there is
// anything to lose.

import type { MouseEvent } from 'react'

export type Mode = 'cut' | 'campaign'

const PAGES: { mode: Mode; href: string; label: string }[] = [
  // "/" on its own opens Campaign videos (src/opening.ts); #cut stays here.
  { mode: 'cut', href: '/#cut', label: 'Cut only' },
  { mode: 'campaign', href: '/campaign.html', label: 'Campaign videos' },
]

export function ModeNav({ current, workToLose }: { current: Mode; workToLose?: () => Promise<string | null> }) {
  const go = async (event: MouseEvent<HTMLAnchorElement>, href: string) => {
    if (!workToLose) return
    event.preventDefault()
    const warning = await workToLose().catch(() => null)
    if (warning && !window.confirm(warning)) return
    window.location.href = href
  }

  return (
    <nav className="modes seg" aria-label="Sections">
      {PAGES.map((page) =>
        page.mode === current ? (
          <span key={page.mode} className="active" aria-current="page">
            {page.label}
          </span>
        ) : (
          <a key={page.mode} href={page.href} onClick={(e) => void go(e, page.href)}>
            {page.label}
          </a>
        ),
      )}
    </nav>
  )
}

/** Whether the plain cutter has anything that leaving would stop or clear,
 *  read from the outside so its own code is not touched: a queued or running
 *  video is a row in its queue, and a finished one holds a Web Lock named
 *  after its file until it is cleared (see media/outputSink.ts). */
export async function plainCutterWorkToLose(): Promise<string | null> {
  const { loadPendingJobs } = await import('./media/jobStore')
  const pending = (await loadPendingJobs()).length
  let finished = 0
  if (navigator.locks) {
    const held = (await navigator.locks.query()).held ?? []
    finished = held.filter((lock) => lock.name?.startsWith('silence-cutter-cut:')).length
  }
  if (pending === 0 && finished === 0) return null
  return pending > 0
    ? 'A video is still being cut or waiting here. It starts again when you come back, but finished videos on this page are cleared. Leave anyway?'
    : 'Leaving clears the finished videos on this page. Send them first if you haven\'t. Leave anyway?'
}
