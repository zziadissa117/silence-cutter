// The speech model's words for one window, put on the video's timeline -
// kept apart from transcribe.worker.ts so it can be tested without the model.

import type { WordChunk } from '../media/fillerWords'
import type { Range } from '../media/silenceMath'

/** Mirrors the library's own (unexported) `Chunk` shape. */
export interface TimestampedChunk {
  text: string
  timestamp: [number | null, number | null]
}

/** The words of one window on the video's timeline. A word the model gives
 *  no end - most often the last one in the window, the one he finished on -
 *  is kept, ending where the next begins or a moment after it starts, never
 *  past the window; one with no start begins where the last one ended. It
 *  used to be dropped, and it was the last word of a phrase that went
 *  missing from the captions. */
export function timedWords(chunks: TimestampedChunk[], offset: number, length: number): WordChunk[] {
  const out: WordChunk[] = []
  chunks.forEach((chunk, i) => {
    if (!chunk.text.trim() || isNonSpeech(chunk.text)) return
    const previousEnd = out.length > 0 ? out[out.length - 1].end - offset : 0
    const from = chunk.timestamp[0] ?? previousEnd
    const nextStart = chunks.slice(i + 1).find((c) => c.timestamp[0] != null)?.timestamp[0] ?? null
    const to = chunk.timestamp[1] ?? Math.min(length, nextStart ?? from + 0.5, from + 0.5)
    out.push({ text: chunk.text, start: offset + from, end: offset + Math.max(from, to) })
  })
  return out
}

/** Quiet put either side of each stretch before the speech model hears it.
 *  A take that starts the moment he talks, or stops the moment he finishes,
 *  gives the model no pause before the first word or after the last, and
 *  whisper-tiny then tends to leave that word out - the first word of the
 *  video, the last one. Digital quiet, not the take's own sound, so nothing
 *  from the next stretch is heard twice. */
export const QUIET_PAD_SEC = 0.5

export function padWithQuiet(slice: Float32Array, sampleRate: number, padSec = QUIET_PAD_SEC): Float32Array {
  const pad = Math.round(padSec * sampleRate)
  const out = new Float32Array(slice.length + 2 * pad)
  out.set(slice, pad)
  return out
}

/** Words heard in a padded stretch, kept on the stretch itself: one timed
 *  into the quiet (the model often puts the first word at its very start)
 *  is moved to the edge, never dropped. */
export function keepInWindow(words: WordChunk[], start: number, end: number): WordChunk[] {
  return words.map((w) => {
    const from = Math.min(Math.max(w.start, start), end)
    return { ...w, start: from, end: Math.max(from, Math.min(w.end, end)) }
  })
}

/** How far back in what was heard a word can share a moment with a new one:
 *  words come in time order, window by window, so only the last ones can. */
const LOOK_BACK_SEC = 1

/** The next window's words put after those heard so far. Two windows cut
 *  out of one pause-free stretch share half a second
 *  (silenceMath.WINDOW_OVERLAP_SEC), so the word at the seam is heard whole
 *  by one of them instead of in two halves - and whatever is said in that
 *  half second is heard by both. A word the last window already heard - the
 *  same word, at the same moment - is kept once: the fuller hearing of it,
 *  since the one cut short by a window's edge is the half. */
export function addHeard(heard: WordChunk[], next: WordChunk[]): WordChunk[] {
  const out = heard.slice()
  for (const word of next) {
    const [text] = bareWords([word.text])
    let twin = -1
    for (let i = out.length - 1; i >= 0 && out[i].end > word.start - LOOK_BACK_SEC; i--) {
      if (out[i].start < word.end && word.start < out[i].end && bareWords([out[i].text])[0] === text) {
        twin = i
        break
      }
    }
    if (twin < 0) out.push(word)
    else if (word.end - word.start > out[twin].end - out[twin].start) out[twin] = word
  }
  return out
}

/** Windows that share a stretch (speechWindows gives a pause-free stretch's
 *  neighbours WINDOW_OVERLAP_SEC in common) parted again, between two words:
 *  at the gap between words nearest the middle of what they share, or the
 *  middle itself with no words there. For the letter model, which times a
 *  window's words against that window's sound alone - the sound of words on
 *  the next window's list would throw its first words off. Windows parted
 *  by a pause are left as they are. */
export function partWindows(windows: Range[], words: WordChunk[]): Range[] {
  const out = windows.map((w) => ({ ...w }))
  const sorted = [...words].sort((a, b) => a.start - b.start)
  for (let i = 1; i < out.length; i++) {
    const before = out[i - 1]
    const after = out[i]
    if (after.start >= before.end) continue
    const middle = (after.start + before.end) / 2
    let seam = middle
    let nearest = Infinity
    for (let k = 0; k + 1 < sorted.length; k++) {
      const gap = (sorted[k].end + sorted[k + 1].start) / 2
      if (gap < after.start || gap > before.end || Math.abs(gap - middle) >= nearest) continue
      nearest = Math.abs(gap - middle)
      seam = gap
    }
    before.end = seam
    after.start = seam
  }
  return out
}

/** What the model writes for a sound that is not a word: "[Music]",
 *  "[inaudible]", "(laughs)", "♪". Not a word he said, so never a caption
 *  and never a word to cut around. */
export function isNonSpeech(text: string): boolean {
  const t = text.trim()
  return /^[([][^)\]]*[)\]][.,!?]*$/.test(t) || /^♪+$/.test(t)
}

/** How many times in a row a phrase has to come back before it is the model
 *  stuck, not him repeating himself ("no, no, no" is three). */
const STUCK_REPEATS = 5

const bareWords = (words: readonly string[]) => words.map((w) => w.toLowerCase().replace(/[^a-z0-9']/g, ''))

/** A run of the same word or short phrase this many times is the model gone
 *  round in a loop ("okay, okay, okay, okay, ..." over a whole stretch): it
 *  happens with a prompt and without, on noisy sound, and the window is then
 *  heard again. Returns the length of the phrase that loops, or 0. */
export function stuckOn(words: readonly string[]): number {
  const bare = bareWords(words)
  for (let n = 1; n <= 3; n++) {
    let run = 1
    for (let i = n; i + n <= bare.length; i++) {
      const same = bare.slice(i, i + n).every((b, k) => b === bare[i - n + k])
      run = same ? run + 1 : 1
      if (run >= STUCK_REPEATS) return n
    }
  }
  return 0
}

/** The words with a loop folded: a phrase that repeats STUCK_REPEATS times
 *  or more in a row is kept twice (he may really have said it twice), the
 *  rest dropped. The last resort when hearing a window again still loops. */
export function unstuck(words: WordChunk[]): WordChunk[] {
  const n = stuckOn(words.map((w) => w.text))
  if (n === 0) return words
  const bare = bareWords(words.map((w) => w.text))
  const copyAt = (i: number) => i >= n && i + n <= bare.length && bare.slice(i, i + n).every((b, k) => b === bare[i - n + k])
  const out: WordChunk[] = []
  let i = 0
  while (i < words.length) {
    let copies = 1
    while (copyAt(i + copies * n)) copies++
    if (copies < STUCK_REPEATS) {
      out.push(words[i])
      i++
      continue
    }
    out.push(...words.slice(i, i + 2 * n))
    i += copies * n
  }
  return out
}
