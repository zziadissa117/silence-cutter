// Which pictures a video is going to show, so one he doesn't want (a photo
// that came up on a word he said in passing) can be left out of that video
// alone, without remaking the rest. A picture appears when its words are
// heard; this lists exactly those, with the same matching the render uses.

import { findMentions, firing } from './keywords'
import type { Angle, BankPicture } from './look'
import type { WordChunk } from '../media/fillerWords'

export interface PictureChoice {
  id: string
  /** What brought it up, for the label. */
  words: string
  image: Blob
}

/** The pictures this video will show: its angle's and the bank's, those whose
 *  words are in what was heard. `skipped` ids are still listed - they are the
 *  ones he can put back. */
export function picturesHeard(angle: Angle, bank: BankPicture[], heard: WordChunk[]): PictureChoice[] {
  const out: PictureChoice[] = []
  const heardIn = (words: string[]) => firing(findMentions(heard, words), angle.mentions).length > 0
  for (const picture of angle.pictures) {
    if (heardIn(picture.words)) out.push({ id: picture.id, words: picture.words.join(', '), image: picture.image })
  }
  if (angle.bank.use) {
    for (const picture of bank) {
      if (heardIn(picture.words)) out.push({ id: picture.id, words: picture.words.join(', '), image: picture.image })
    }
  }
  return out
}

/** The list without the ids he skipped. */
export function without<T extends { id: string }>(items: T[], skipped: readonly string[] | undefined): T[] {
  if (!skipped || skipped.length === 0) return items
  return items.filter((item) => !skipped.includes(item.id))
}
