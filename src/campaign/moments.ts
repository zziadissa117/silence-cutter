// When the things that come up on a word come up: the logo, the pictures (the
// angle's own and the bank's), the brand-hit zoom and the sounds.
//
// Timed from the captions' own words - placed by the letter model when it ran,
// within a frame or two of his voice (align.ts) - not from the speech model's
// rough times, which run about 0.2 s late and wander 0.2 s either way, worst
// in the middle of a sentence where nothing pulls them back onto his voice.
// On those, he said "Hershey's" and the picture came up a good part of a
// second later, while the caption was already on the word.

import type { WordChunk } from '../media/fillerWords'
import { findMentions, firing } from './keywords'
import type { VideoLook } from './look'

/** How long before its word a picture or the logo starts to come up. Its pop
 *  takes a moment to be seen - it fades in over 0.12 s - and a picture that
 *  arrives with the sound reads as late, which is why the captions lead too.
 *  Sounds and the brand-hit zoom land on the word itself. */
export const PICTURE_LEAD_SEC = 0.1

export interface WordMoments {
  logo: number[]
  brand: number[]
  /** One list per picture in `look.pictures`, in order. */
  pictures: number[][]
  /** Only the bank's pictures that were said - a big bank costs nothing for
   *  the pictures a video never uses. */
  bank: { image: Blob; moments: number[] }[]
  /** One list per sound in `look.sounds`, in order. */
  sounds: number[][]
  /** Words the look listens for that were never heard. */
  notHeard: string[]
}

/** Every moment, in seconds on the raw recording. `handAt` holds the pictures
 *  he put on by hand, at the moment he picked - those keep it exactly. */
export function wordMoments(
  plan: { words: WordChunk[]; spoken?: WordChunk[] },
  look: VideoLook,
  handAt: ReadonlyMap<string, number> = new Map(),
): WordMoments {
  const exact = plan.spoken ?? plan.words
  const notHeard: string[] = []
  // On the exact words. A name only the rough words make out - spelled across
  // pieces the captions joined back into one - still comes up, as before.
  const said = (words: string[]) => {
    const found = firing(findMentions(exact, words), look.mentions)
    return found.length > 0 ? found : firing(findMentions(plan.words, words), look.mentions)
  }
  const heard = (words: string[]) => {
    const found = said(words)
    if (found.length === 0) notHeard.push(...words)
    return found
  }
  const early = (moments: number[]) => moments.map((t) => Math.max(0, t - PICTURE_LEAD_SEC))

  const logo = look.logo.image ? early(heard(look.logo.words)) : []
  const brand = look.effects.brandHit === 'off' ? [] : heard(look.brandWords)
  const pictures = look.pictures.map((picture) => {
    const at = handAt.get(picture.id)
    return at !== undefined ? [at] : early(heard(picture.words))
  })
  const bank = look.bankPictures
    .map((picture) => ({ image: picture.image, moments: early(said(picture.words)) }))
    .filter((cue) => cue.moments.length > 0)
  // A sound that goes with the pictures comes with them.
  const anyPicture = [...pictures.flat(), ...bank.flatMap((c) => c.moments)].sort((a, b) => a - b)
  const sounds = look.sounds.map((sound) => {
    if (sound.trigger.kind === 'picture') return anyPicture
    if (sound.trigger.kind !== 'words') return []
    return heard(sound.trigger.words)
  })
  return { logo, brand, pictures, bank, sounds, notHeard }
}
