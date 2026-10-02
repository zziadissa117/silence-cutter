// Watches over videos between the tap that opens the picker and the moment
// they are saved on the phone, so a restart in that gap is never silent.
//
// On an iPhone the picker first prepares a copy of each video - the bar that
// fills after choosing - and only then hands it to the page. If the page
// restarts inside that gap the video never arrives: the list still says it
// is empty, and nothing said why. Two things restart it there. iOS does,
// when it needs the memory or the phone is out of space. And this app's own
// update did: a new version finishing its download while he was choosing
// reloaded the page straight away, because an empty list looked like there
// was nothing to lose.
//
// So each page notes a pick in localStorage until its videos are safe, the
// next load says what happened if one was lost, and an update waits for the
// pick to finish before it reloads.

import { report } from './report'

type Stage = 'choosing' | 'arrived'

interface Note {
  stage: Stage
  at: number
}

/** A note older than this is from some earlier visit, not a restart. */
const NOTE_MS = 10 * 60 * 1000
/** How long an update waits on a picker that never said it closed. Preparing
 *  a long 4K video takes a minute or two; this is well past that. */
const WAIT_MS = 5 * 60 * 1000

let page: 'cut' | 'campaign' = 'cut'
let busySince: number | null = null
let stage: Stage | null = null
const waiting = new Set<() => void>()

/** How long after the picker closes a video has to arrive before the page
 *  says it did not. Generous: the iPhone can still be preparing it. */
const ARRIVE_MS = 15_000
let arriveTimer = 0
let onTrouble: (message: string | null) => void = () => {}

/** Where the page shows what went wrong with a pick. */
export function whenPickGoesWrong(listener: (message: string | null) => void): void {
  onTrouble = listener
}

// The picker converts each video before handing it over unless it is set to
// Current (see pickFormat.ts), and a conversion needs free space - so a pick
// that comes to nothing is most often that.
const NOTHING_ARRIVED =
  "Your iPhone closed the picker but didn't hand the video over. It converts videos first, and that needs free space. In the picker tap ⋯ → Options → Format → Current to skip it, or free some space, then add it again."

function key(): string {
  return `pick.${page}`
}

function write(note: Note | null): void {
  try {
    if (note) localStorage.setItem(key(), JSON.stringify(note))
    else localStorage.removeItem(key())
  } catch {
    // Storage blocked: the restart just won't be explained.
  }
}

function settle(): void {
  busySince = null
  stage = null
  window.clearTimeout(arriveTimer)
  write(null)
  for (const done of waiting) done()
  waiting.clear()
}

// The picker has closed when the page is back in front. If no video has
// arrived a while after that - and it was not cancelled - the iPhone never
// handed it over. That failure has no error anywhere; this is the only way
// to see it.
function pickerClosed(): void {
  if (document.visibilityState !== 'visible' || stage !== 'choosing' || busySince === null) return
  if (Date.now() - busySince < 800) return
  const started = busySince
  window.clearTimeout(arriveTimer)
  arriveTimer = window.setTimeout(() => {
    if (stage !== 'choosing' || busySince !== started) return
    onTrouble(NOTHING_ARRIVED)
    report({ page, kind: 'empty-pick', message: `The picker closed and no video arrived within ${ARRIVE_MS / 1000} s` })
  }, ARRIVE_MS)
}

// "cancel" does not bubble, so React never sees it on an input; a capturing
// listener on the document does.
if (typeof document !== 'undefined') {
  window.addEventListener('focus', pickerClosed)
  document.addEventListener('visibilitychange', pickerClosed)
  document.addEventListener(
    'cancel',
    (event) => {
      const target = event.target
      if (target instanceof HTMLInputElement && target.type === 'file' && busySince !== null) settle()
    },
    true,
  )
}

/** Names the page, and returns what to tell him if the last visit lost a
 *  video he had picked. Call once, on load. */
export function lostPick(pageName: 'cut' | 'campaign'): string | null {
  page = pageName
  let note: Note | null = null
  try {
    note = JSON.parse(localStorage.getItem(key()) ?? 'null') as Note | null
  } catch {
    note = null
  }
  write(null)
  if (!note || Date.now() - note.at > NOTE_MS) return null
  report({ page, kind: 'lost-pick', message: `Page restarted with a pick ${note.stage}`, phase: note.stage })
  return note.stage === 'choosing'
    ? "If you just picked a video and it isn't here, the page restarted while your iPhone was handing it over. Add it again - if it keeps happening, add fewer at once or free up some iPhone storage."
    : 'The page restarted before the video you added was saved. Add it again.'
}

/** The picker is about to open. */
export function pickStarted(): void {
  busySince = Date.now()
  stage = 'choosing'
  window.clearTimeout(arriveTimer)
  write({ stage: 'choosing', at: busySince })
}

/** The picker handed over these files. Says what to tell him when it handed
 *  over nothing - otherwise the pick stays open until `pickSaved`. */
export function pickArrived(files: File[]): string | null {
  if (files.length > 0) {
    busySince = Date.now()
    stage = 'arrived'
    window.clearTimeout(arriveTimer)
    // It came after all - late, but here.
    onTrouble(null)
    write({ stage: 'arrived', at: busySince })
    return null
  }
  settle()
  report({ page, kind: 'empty-pick', message: 'The picker handed over no files' })
  return "Nothing came through from the picker. In the picker tap ⋯ → Options → Format → Current so it doesn't have to convert them, or free some space, and try again."
}

/** The picked videos are saved, or as saved as they will get. */
export function pickSaved(): void {
  if (busySince !== null) settle()
}

/** Resolves once no pick is under way, so an update never reloads the page
 *  under one. */
export function pickQuiet(): Promise<void> {
  if (busySince === null || Date.now() - busySince > WAIT_MS) return Promise.resolve()
  return new Promise((resolve) => {
    waiting.add(resolve)
    window.setTimeout(resolve, WAIT_MS - (Date.now() - busySince!))
  })
}
