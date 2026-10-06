// The phone's video decoder giving up partway through a video, and picking up
// again from the last frame written. Shared by the plain cutter
// (silenceCut.ts) and the campaign renders (campaign/clipParts.ts).

import { SilenceCutError } from './errors'

/** The phone's video decoder giving up - "Decoder failure" on an iPhone. */
export function decoderGaveUp(error: unknown): boolean {
  return !(error instanceof SilenceCutError) && (error instanceof DOMException || /decod/i.test(String(error)))
}

export const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Resolves once the page is in front again. iOS takes the decoder away
 *  from a page in the background - sending a finished video to TikTok does
 *  it - so a fresh one is only worth starting on his return. */
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
