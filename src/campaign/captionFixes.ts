// When he types a first or last word back into the captions, which step lost
// it: the speech model never heard it, or it was heard and then left out of
// the captions. Sent as a "check" report, so the next fix goes to the right
// place instead of guessing.

import type { WordChunk } from '../media/fillerWords'
import { bareWord, type CaptionWord } from './captions'

export interface TypedBack {
  where: 'first' | 'last'
  word: string
  /** The speech model heard it, close to where it belongs. */
  heard: boolean
}

/** How far before the first caption (or after the last) a heard word may be
 *  and still be the one he typed. */
const NEAR_SEC = 2.5
/** He typed a word or two, not a new sentence. */
const MOST_TYPED = 2

const bare = (text: string) => bareWord(text).toLowerCase()

/** The words he added in front of the captions he was shown, or after them,
 *  and whether each was heard. Nothing when the edges are as shown. */
export function typedBack(shown: CaptionWord[], approved: CaptionWord[], heard: WordChunk[]): TypedBack[] {
  const was = shown.map((w) => bare(w.text)).filter(Boolean)
  const now = approved.map((w) => bare(w.text)).filter(Boolean)
  if (was.length === 0 || now.length <= was.length) return []
  const near = (word: string, from: number, to: number) => heard.some((h) => bare(h.text) === word && h.start >= from && h.start <= to)
  const out: TypedBack[] = []
  const firstAt = now.indexOf(was[0])
  if (firstAt > 0 && firstAt <= MOST_TYPED) {
    const at = shown[0].start
    for (const word of now.slice(0, firstAt)) out.push({ where: 'first', word, heard: near(word, at - NEAR_SEC, at) })
  }
  const lastAt = now.lastIndexOf(was[was.length - 1])
  const after = now.length - 1 - lastAt
  if (lastAt >= 0 && after > 0 && after <= MOST_TYPED && lastAt >= firstAt) {
    const at = shown[shown.length - 1].end
    for (const word of now.slice(lastAt + 1)) out.push({ where: 'last', word, heard: near(word, at, at + NEAR_SEC) })
  }
  return out
}
