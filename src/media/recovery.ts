// The phone's video decoder giving up partway through a video, and picking up
// again from the last frame written. Shared by the plain cutter
// (silenceCut.ts) and the campaign renders (campaign/clipParts.ts).

import { SilenceCutError } from './errors'

/** How many times one video may bring up a fresh decoder after the phone's
 *  gives up partway, before the failure is passed on - the plain cutter's
 *  number and every campaign render's. */
export const MAX_RECOVERIES = 4

/** The phone's storage is full: the file being written could not grow. */
function outOfStorage(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'QuotaExceededError'
}

/** The phone's video decoder giving up - "Decoder failure" on an iPhone.
 *  Not storage running out, which is a DOMException too and used to send a
 *  render through four pointless decoder restarts. */
export function decoderGaveUp(error: unknown): boolean {
  if (error instanceof SilenceCutError || outOfStorage(error)) return false
  return error instanceof DOMException || /decod/i.test(String(error))
}

/** A render's failure as it should be read: storage running out said
 *  plainly; anything else as it came. */
export function asRenderError(error: unknown): unknown {
  return outOfStorage(error)
    ? new SilenceCutError(
        'The phone ran out of storage while the video was being written. Clear some space - finished videos still on the list count - and try again.',
      )
    : error
}

/** The video encoder refusing to go on - the only failure worth a second
 *  cut without HDR (silenceCut.ts): a decoder giving up, a full disk or a
 *  timestamp error would fail again, after the whole cut had been made twice. */
export function encoderGaveUp(error: unknown): boolean {
  if (error instanceof SilenceCutError || outOfStorage(error) || decoderGaveUp(error)) return false
  if (error instanceof DOMException) return error.name === 'EncodingError' || error.name === 'NotSupportedError' || error.name === 'OperationError'
  return /encod|codec/i.test(String(error))
}

/** The decoder stopped handing frames over before the part's end - with no
 *  error at all. The render held the last frame and went on: his face froze
 *  while his voice, the captions and the pictures carried on (VAZA,
 *  2026-11-06, "at exactly 2.5 seconds, the video simply froze"). Treated as
 *  the decoder giving up: a fresh one picks up from the last frame. */
export class StoppedEarly extends Error {
  readonly at: number
  constructor(at: number) {
    super(`The video decoder stopped handing frames over at ${at.toFixed(2)} s`)
    this.at = at
  }
}

/** Frames missing for longer than this, where the video has them, is the
 *  decoder having stopped - a recording's frames are never this far apart. */
export const STALL_SEC = 0.5

/** Whether frames stopped coming before the part's end: the last one read is
 *  more than STALL_SEC before the end of the part - or of the video's own
 *  frames, whichever comes first. */
export function stoppedEarly(lastFrame: number, partStart: number, partEnd: number, videoEnd: number): boolean {
  const until = Math.min(partEnd, videoEnd)
  return until - partStart > STALL_SEC && Math.max(lastFrame, partStart) < until - STALL_SEC
}

/** What he is told when the decoder keeps stopping at the same moment: the
 *  video is not made rather than made frozen. */
export function stalledProblem(at: number): SilenceCutError {
  const time = `${Math.floor(at / 60)}:${String(Math.floor(at % 60)).padStart(2, '0')}`
  return new SilenceCutError(
    `The phone kept stopping reading this video at ${time} - it wasn't made, rather than made with the picture frozen from there. Tap Try again; if it stops at the same moment again, that part of the recording is damaged - record it again or cut it out.`,
  )
}

export const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Resolves once the page is in front again. iOS takes the decoder away
 *  from a page in the background - sending a finished video to TikTok does
 *  it - so a fresh one is only worth starting once the app is back in front. */
export function visibleAgain(): Promise<void> {
  if (document.visibilityState === 'visible') return Promise.resolve()
  return new Promise((resolve) => {
    const onChange = () => {
      if (document.visibilityState !== 'visible') return
      document.removeEventListener('visibilitychange', onChange)
      resolve()
    }
    document.addEventListener('visibilitychange', onChange)
  })
}
