// A video that plays in the middle of his, when he says its phrase: "I'm
// going to show you how" - and the clip showing how plays, whole, with its own
// sound, then he carries on. Not over him like a pop-up (popVideo.ts): in the
// timeline, so the video gets that much longer.
//
// Set on an angle, like the videos before and after (clips.ts). Here: finding
// where each phrase is said in what is kept of the take, and splitting the cut
// there, so the render puts the clip in between two kept parts - everything
// timed after it (captions, pictures, sounds) then moves on by itself.

import type { Range } from '../media/silenceMath'
import type { CaptionWord } from './captions'

export interface ClipCue {
  /** What he says, as he typed it. */
  phrase: string
  /** The clip, by id (clips.ts). */
  clip: string
}

/** Where one cue goes in a video: after kept part `after` of the new cut,
 *  `at` on the raw take. */
export interface PlacedCue {
  cue: number
  at: number
  after: number
}

/** A word as it is compared: no case, no punctuation - "I'm" is "im". */
const plain = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

export const phraseWords = (phrase: string) => phrase.split(/\s+/).map(plain).filter(Boolean)

/** The speech model mishears a word now and then: a phrase of four words or
 *  more may have one wrong and still count. */
const allowedMisses = (n: number) => (n >= 4 ? 1 : 0)

/** Where `phrase` is first said in `words`, as the index of its last word -
 *  or -1 when it isn't. */
export function findPhrase(words: CaptionWord[], phrase: string): number {
  const want = phraseWords(phrase)
  if (want.length === 0) return -1
  const said = words.map((w) => plain(w.text))
  const misses = allowedMisses(want.length)
  for (let i = 0; i + want.length <= said.length; i++) {
    // The first and last words must be right: they say where it starts and ends.
    if (said[i] !== want[0] || said[i + want.length - 1] !== want[want.length - 1]) continue
    let wrong = 0
    for (let k = 1; k < want.length - 1 && wrong <= misses; k++) if (said[i + k] !== want[k]) wrong++
    if (wrong <= misses) return i + want.length - 1
  }
  return -1
}

/** A pause this close after the phrase is where the clip goes, rather than
 *  splitting him mid-breath. */
const TO_PAUSE_SEC = 0.35
/** A moment after the last word, so its end isn't clipped. */
const AFTER_WORD_SEC = 0.06
/** The least either side of a split: a sliver of a part is a flash. */
const MIN_PART_SEC = 0.1

/** Places each cue whose phrase is said in what is kept, splitting the cut
 *  where one has to go in the middle of a kept part. `words` are the video's
 *  words on the raw take (the captions as checked, or as heard). Returns the
 *  new cut, where each clip goes, and the phrases not said. */
export function placeCues(words: CaptionWord[], keep: Range[], cues: Pick<ClipCue, 'phrase'>[]): { keep: Range[]; placed: PlacedCue[]; notSaid: string[] } {
  let cut = keep.map((r) => ({ ...r }))
  const times: { cue: number; at: number }[] = []
  const notSaid: string[] = []
  cues.forEach((cue, index) => {
    const last = findPhrase(words, cue.phrase)
    if (last < 0) {
      notSaid.push(cue.phrase)
      return
    }
    const end = words[last].end
    const inside = cut.findIndex((r) => end >= r.start && end < r.end)
    if (inside < 0) {
      // Said at the very end of a part, or in a pause that was cut: after the
      // part it was said in.
      const before = cut.filter((r) => r.end <= end + TO_PAUSE_SEC)
      const part = before[before.length - 1] ?? cut[0]
      if (part) times.push({ cue: index, at: part.end })
      return
    }
    const part = cut[inside]
    if (part.end - end <= TO_PAUSE_SEC) {
      times.push({ cue: index, at: part.end })
      return
    }
    const at = Math.min(part.end - MIN_PART_SEC, Math.max(part.start + MIN_PART_SEC, end + AFTER_WORD_SEC))
    cut = [...cut.slice(0, inside), { start: part.start, end: at }, { start: at, end: part.end }, ...cut.slice(inside + 1)]
    times.push({ cue: index, at })
  })
  const placed = times
    .map(({ cue, at }) => ({ cue, at, after: cut.findIndex((r) => r.end === at) }))
    .filter((p) => p.after >= 0)
    .sort((a, b) => a.at - b.at || a.cue - b.cue)
  return { keep: cut, placed, notSaid }
}
