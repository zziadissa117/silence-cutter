// Puts each heard word exactly where it is said, for captions that land on
// the word.
//
// The speech model (whisper-tiny.en) gets the words right but their times
// rough: measured on his takes against where his voice starts, its starts
// run a median 0.22 s late and scatter a further ±0.2 s. Worst of all it runs
// the last word before a pause on into the pause - "rules." said at 22.6 s,
// heard at 23.2 s - and a word placed in a pause that was cut out never gets
// a caption at all. That is the "it drops the last words of a phrase", and
// they are usually the words that matter.
//
// So a second, small model listens again for letters alone (wav2vec2, which
// scores every 20 ms of audio against every letter) and the words already
// heard are laid along that, in order - a forced alignment, the standard way
// subtitles are timed. The words stay exactly as heard; only their times
// change. On his takes the aligned starts sit within about 30 ms of where
// his voice visibly starts.
//
// This file is the arithmetic: spelling words the way they are said, and the
// alignment itself. align.worker.ts runs the model.

/** wav2vec2-base-960h's letters. Index 0 is the "nothing new" blank. */
export const CTC_LETTERS = [
  '<pad>', '<s>', '</s>', '<unk>', '|', 'E', 'T', 'A', 'O', 'N', 'I', 'H', 'S', 'R', 'D', 'L', 'U', 'M', 'W', 'C',
  'F', 'G', 'Y', 'P', 'B', 'V', 'K', "'", 'X', 'J', 'Q', 'Z',
]
const BLANK = 0
const SPACE = 4
const LETTER = new Map(CTC_LETTERS.map((l, i) => [l, i]))

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']
const SCALES: [number, string][] = [[1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand'], [100, 'hundred']]

/** A whole number as it is said: 20000 → "twenty thousand". */
export function numberWords(n: number): string {
  if (!Number.isFinite(n) || n < 0) return ''
  n = Math.floor(n)
  if (n < 20) return ONES[n]
  if (n < 100) return `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`
  for (const [size, name] of SCALES) {
    if (n >= size) return `${numberWords(Math.floor(n / size))} ${name}${n % size ? ` ${numberWords(n % size)}` : ''}`
  }
  return ''
}

/** A word the way it sounds, in the aligner's letters: "$20,000" →
 *  "TWENTY THOUSAND DOLLARS", "2.8%" → "TWO POINT EIGHT PERCENT". Empty for
 *  something that isn't said, like a lone dash. */
export function spellForAlignment(text: string): string {
  let said = text
    .replace(/(\d),(\d{3})/g, '$1$2')
    .replace(/\$(\d+(?:\.\d+)?)/g, '$1 dollars')
    .replace(/(\d)\s*-\s*(\d)/g, '$1 to $2')
    .replace(/%/g, ' percent ')
    .replace(/&/g, ' and ')
  said = said.replace(/(\d+)\.(\d+)/g, (_, whole: string, part: string) =>
    `${numberWords(Number(whole))} point ${[...part].map((d) => ONES[Number(d)]).join(' ')}`,
  )
  said = said.replace(/\d+/g, (digits) => ` ${numberWords(Number(digits))} `)
  return said
    .toUpperCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^A-Z' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** The first and last 20 ms frame each word was said in, or null for a word
 *  with nothing to say. */
export type Span = { first: number; last: number } | null

/** Lays `words` (spelled as spellForAlignment gives them) along the frames,
 *  in order, the most likely way (CTC Viterbi). `logProbs` is frames ×
 *  letters of log-probabilities. Every word gets a span unless the audio is
 *  too short to hold them all, when every span is null. */
export function forceAlign(logProbs: Float32Array, frames: number, letters: number, words: string[]): Span[] {
  // The letters to find in order, with a word gap between words, each
  // remembering its word.
  const tokens: number[] = []
  const owner: number[] = []
  words.forEach((word, w) => {
    for (const part of word.split(' ').filter(Boolean)) {
      if (tokens.length > 0) {
        tokens.push(SPACE)
        owner.push(-1)
      }
      for (const ch of part) {
        const id = LETTER.get(ch)
        if (id === undefined) continue
        tokens.push(id)
        owner.push(w)
      }
    }
  })
  const spans: Span[] = words.map(() => null)
  const states = 2 * tokens.length + 1
  // A letter repeated needs a blank between, so the shortest path is longer
  // than the letters themselves.
  let needed = tokens.length
  for (let i = 1; i < tokens.length; i++) if (tokens[i] === tokens[i - 1]) needed++
  if (tokens.length === 0 || frames < needed) return spans

  const label = (s: number) => (s % 2 === 0 ? BLANK : tokens[(s - 1) / 2])
  const NEG = -1e30
  let previous = new Float64Array(states).fill(NEG)
  let current = new Float64Array(states)
  const back = new Uint8Array(frames * states)
  previous[0] = logProbs[BLANK]
  if (states > 1) previous[1] = logProbs[label(1)]
  for (let t = 1; t < frames; t++) {
    const row = t * letters
    for (let s = 0; s < states; s++) {
      let best = previous[s]
      let step = 0
      if (s > 0 && previous[s - 1] > best) {
        best = previous[s - 1]
        step = 1
      }
      if (s > 1 && s % 2 === 1 && label(s) !== label(s - 2) && previous[s - 2] > best) {
        best = previous[s - 2]
        step = 2
      }
      current[s] = best + logProbs[row + label(s)]
      back[t * states + s] = step
    }
    ;[previous, current] = [current, previous]
  }
  let s = states > 1 && previous[states - 2] > previous[states - 1] ? states - 2 : states - 1
  for (let t = frames - 1; t >= 0; t--) {
    if (s % 2 === 1) {
      const w = owner[(s - 1) / 2]
      if (w >= 0) {
        const span = spans[w]
        spans[w] = span ? { first: t, last: span.last } : { first: t, last: t }
      }
    }
    s -= back[t * states + s]
  }
  return spans
}

/** Log-probabilities from the model's raw scores, row by row, in place. */
export function logSoftmax(scores: Float32Array, frames: number, letters: number): Float32Array {
  for (let t = 0; t < frames; t++) {
    const row = t * letters
    let max = -Infinity
    for (let v = 0; v < letters; v++) max = Math.max(max, scores[row + v])
    let sum = 0
    for (let v = 0; v < letters; v++) sum += Math.exp(scores[row + v] - max)
    const log = max + Math.log(sum)
    for (let v = 0; v < letters; v++) scores[row + v] -= log
  }
  return scores
}

export interface TimedWord {
  text: string
  start: number
  end: number
}

/** The words with their aligned times, `offset` seconds being frame 0 and
 *  each frame `frameSec` long. A word that got no span keeps its place
 *  between its neighbours. */
export function placeWords(words: TimedWord[], spans: Span[], frameSec: number, offset: number): TimedWord[] {
  return place(
    words,
    spans,
    (frame) => offset + frame * frameSec,
    (frame) => offset + (frame + 1) * frameSec,
  )
}

/** The same, for frames with times of their own: `starts[f]` and `ends[f]`
 *  are when frame f begins and ends on the video (see joinPieces). */
export function placeWordsAt(words: TimedWord[], spans: Span[], starts: readonly number[], ends: readonly number[]): TimedWord[] {
  return place(
    words,
    spans,
    (frame) => starts[frame],
    (frame) => ends[frame],
  )
}

function place(words: TimedWord[], spans: Span[], startOf: (frame: number) => number, endOf: (frame: number) => number): TimedWord[] {
  const placed = words.map((w, i) => {
    const span = spans[i]
    return span ? { text: w.text, start: startOf(span.first), end: endOf(span.last) } : null
  })
  return words.map((w, i) => {
    const got = placed[i]
    if (got) return got
    const before = placed.slice(0, i).reverse().find(Boolean)
    const after = placed.slice(i + 1).find(Boolean)
    const start = before ? before.end : after ? after.start : w.start
    return { text: w.text, start, end: Math.max(start, after ? after.start : start) }
  })
}

/** The longest stretch the letter model hears in one go. What it needs - its
 *  memory, and the time before it can say anything - grows with the length
 *  of what it hears, and a whole listening window (up to 25 s) was too much
 *  for a phone: on the friend's iPhone it ran out of memory or went quiet for
 *  over a minute, again and again, and every time the captions fell back to
 *  the speech model's rough times - words coming up late, or on the wrong
 *  word. */
export const ALIGN_PIECE_SEC = 8

/** Where to cut a listening window into pieces for the letter model: always
 *  in the middle of a pause, never in a word, so each piece is at most
 *  `maxSec` where the pauses allow it (talk with no pause in it stays whole),
 *  and none is shorter than `minSec`. The letters heard in the pieces are put
 *  back together (joinPieces) before the words are laid along them, so the
 *  words are still placed over the whole window at once, as before. */
export function pieceCuts(
  window: { start: number; end: number },
  silences: readonly { start: number; end: number }[],
  maxSec = ALIGN_PIECE_SEC,
  minSec = 1,
): number[] {
  const points = silences
    .filter((s) => s.start > window.start && s.end < window.end)
    .map((s) => (s.start + s.end) / 2)
    .sort((a, b) => a - b)
  const cuts: number[] = []
  let from = window.start
  while (window.end - from > maxSec) {
    const usable = points.filter((p) => p >= from + minSec && window.end - p >= minSec)
    const within = usable.filter((p) => p <= from + maxSec)
    // The furthest pause it can reach; failing that, the first one after.
    const next = within.length > 0 ? within[within.length - 1] : usable[0]
    if (next === undefined) break
    cuts.push(next)
    from = next
  }
  return cuts
}

/** What the letter model heard in each piece of a window, as one: the
 *  letters' scores frame after frame, and when each frame starts and ends on
 *  the video. Each piece's frames share its length out evenly, as a whole
 *  window's did. */
export function joinPieces(
  pieces: readonly { logProbs: Float32Array; frames: number; start: number; end: number }[],
  letters: number,
): { logProbs: Float32Array; frames: number; starts: number[]; ends: number[] } {
  const frames = pieces.reduce((n, p) => n + p.frames, 0)
  const logProbs = new Float32Array(frames * letters)
  const starts: number[] = []
  const ends: number[] = []
  let at = 0
  for (const piece of pieces) {
    logProbs.set(piece.logProbs.subarray(0, piece.frames * letters), at * letters)
    const frameSec = piece.frames > 0 ? (piece.end - piece.start) / piece.frames : 0
    for (let f = 0; f < piece.frames; f++) {
      starts.push(piece.start + f * frameSec)
      ends.push(piece.start + (f + 1) * frameSec)
    }
    at += piece.frames
  }
  return { logProbs, frames, starts, ends }
}
