// One video, new songs (batch.CopySource): whether he talks in the video -
// heard once, when it goes in. Talking: his voice stays, the song low under
// it. Not: the song takes the place of its sound. Shown on its card, one tap
// to turn it round when it heard wrong (a song's lyrics can sound like talk).

import { isFillerWordDetectionSupported } from '../media/fillerWords'
import { BALANCED_SETTINGS } from '../media/silenceMath'
import { listen } from './pipeline'

/** Fewer real words than this is no talking: a word or two caught in a song. */
export const TALK_WORDS = 5

/** Whether the words heard are talking: enough real words - not the speech
 *  model's "[Music]" or "♪" for a song. */
export function talksFrom(words: readonly { text: string }[]): boolean {
  const real = words.filter((w) => {
    const text = w.text.trim()
    return /\p{L}/u.test(text) && !/[[\]()♪♫]/.test(text) && !/^(music|applause|laughter)$/i.test(text.replace(/[^\p{L}]/gu, ''))
  })
  return real.length >= TALK_WORDS
}

/** Heard on this phone; false where it can't run the speech model. */
export async function hearsTalking(video: Blob, onProgress?: (p: number) => void): Promise<boolean> {
  if (!isFillerWordDetectionSupported()) return false
  const plan = await listen(
    video,
    BALANCED_SETTINGS,
    { cleanSpeech: false, hear: true, names: [], quietIsFine: true, keepWhole: true, cutNoise: false },
    { onModelDownload: onProgress, onTranscribeProgress: onProgress },
  )
  return talksFrom(plan.spoken ?? plan.words)
}
