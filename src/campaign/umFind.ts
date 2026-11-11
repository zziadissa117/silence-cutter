// "Um"s found by their sound (his ask, 2026-11-11: "in each video, when it
// maybe notices an 'um' and anything like that, then try to fix it ... and
// point it out to me in the captions"). The speech model was trained to
// leave "um"s out of what it writes - which is why cutting the ones it wrote
// never worked. So the other way round: with every word timed exactly (the
// letter model), his voice sounding steadily where no word is - between two
// words - is an "um", an "uh", a held "euh". Each one found is heard a second
// time on its own; a real word heard there (one the model missed) stays.
// Each one cut is listed in the captions and the cuts, to listen to and put
// back with a tap.

import type { Level, Range } from '../media/silenceMath'

/** Shortest and longest sound taken for an "um". */
export const UM_MIN_SEC = 0.16
export const UM_MAX_SEC = 1.6
/** How even an "um" is: a held vowel, its loudness steady, unlike a word. */
const STEADY_DB = 5
/** Kept clear of the words either side. */
const CLEAR_SEC = 0.04

export interface UmVoice {
  /** The line under which is quiet. */
  lineDb: number
  /** His talking: its loudest tenth. */
  speechDb: number
  /** His "um" (voiceProfile), when he recorded some. */
  umDb?: number
}

const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
const spread = (xs: readonly number[]) => {
  const m = mean(xs)
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)))
}

/** The stretches between two of his exactly timed words where his voice
 *  sounds steadily on its own - each an "um" to cut, after a second listen.
 *  `words` in order, the "um"s and stumbles the model did write left out. */
export function findUms(words: readonly Range[], levels: readonly Level[], voice: UmVoice): Range[] {
  if (levels.length < 2 || words.length < 2) return []
  const step = levels[1].time - levels[0].time
  // Voice: well above the quiet line, and not much quieter than his talking -
  // a breath sits far under it.
  const voicedDb = Math.max(voice.lineDb + 6, voice.speechDb - 20)
  const out: Range[] = []
  let li = 0
  for (let i = 0; i + 1 < words.length; i++) {
    const from = words[i].end + CLEAR_SEC
    const to = words[i + 1].start - CLEAR_SEC
    if (to - from < UM_MIN_SEC) continue
    while (li < levels.length && levels[li].time < from) li++
    // The longest run of voice in the gap.
    let best: { start: number; end: number; dbs: number[] } | null = null
    let run: { start: number; end: number; dbs: number[] } | null = null
    for (let k = li; k < levels.length && levels[k].time + step <= to; k++) {
      const l = levels[k]
      if (l.db >= voicedDb) {
        run ??= { start: l.time, end: l.time + step, dbs: [] }
        run.end = l.time + step
        run.dbs.push(l.db)
      } else if (run) {
        if (!best || run.end - run.start > best.end - best.start) best = run
        run = null
      }
    }
    if (run && (!best || run.end - run.start > best.end - best.start)) best = run
    if (!best) continue
    const length = best.end - best.start
    if (length < UM_MIN_SEC || length > UM_MAX_SEC) continue
    // Held and even, as an "um" is.
    if (spread(best.dbs) > STEADY_DB) continue
    // As loud as his own "um", when he recorded some.
    if (voice.umDb !== undefined && Math.abs(mean(best.dbs) - voice.umDb) > 9) continue
    // Cut whole: from just after the word before to just before the next,
    // as far as the sound goes - never into either word.
    out.push({ start: Math.max(from, best.start - CLEAR_SEC), end: Math.min(to, best.end + CLEAR_SEC) })
  }
  return out
}

/** What a second listen to a stretch heard: nothing, or only a filler -
 *  it was an "um". A real word - it stays. */
export function heardOnlyFiller(heard: readonly { text: string }[], isFiller: (text: string) => boolean): boolean {
  return heard.every((w) => {
    const bare = w.text.trim().replace(/[^\p{L}\p{N}']/gu, '')
    return !bare || isFiller(w.text)
  })
}
