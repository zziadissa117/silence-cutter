// Turns a video's transcribed words into caption lines and writes them out
// as an .srt file. Re-timed onto the CUT video's timeline, not the original's
// - a word that survived a silence cut lands earlier in the output than it
// did in the source, and a word that was cut out entirely (a removed pause,
// a removed "um") must not appear as a caption over footage that no longer
// exists.

import type { WordChunk } from './fillerWords'
import type { Range } from './silenceMath'

export interface CaptionCue {
  start: number
  end: number
  text: string
}

/** Which kept range a moment on the original timeline falls in, or -1 when
 *  it was cut out - silence, or a removed filler word. */
function rangeAt(t: number, keep: Range[]): number {
  return keep.findIndex((range) => t >= range.start && t <= range.end)
}

/** Where a word lands on the cut video. A word's times are the speech
 *  model's, good to a fifth of a second or so, and the cut starts only a
 *  breath after the last word before a pause - so the end of that word is
 *  routinely reported inside the cut. It is clamped to the edge of the kept
 *  part it belongs to, not dropped: dropping it lost the last word of most
 *  sentences. Only a word whose whole span was cut out (a removed "um") has
 *  no place in the output. `shifts` says where each kept range actually
 *  landed; without it the plan's own arithmetic is used. */
function placeWord(word: WordChunk, keep: Range[], shifts?: number[]): { start: number; end: number } | null {
  const offsets: number[] = []
  let offset = 0
  for (const range of keep) {
    offsets.push(offset)
    offset += range.end - range.start
  }
  const out = (t: number, k: number) => (shifts ? t + shifts[k] : offsets[k] + (t - keep[k].start))
  const i = rangeAt(word.start, keep)
  const j = rangeAt(word.end, keep)
  if (i >= 0 && j >= 0) return { start: out(word.start, i), end: out(word.end, j) }
  if (i >= 0) return { start: out(word.start, i), end: out(keep[i].end, i) }
  if (j >= 0) return { start: out(keep[j].start, j), end: out(word.end, j) }
  // Neither end is kept: the word may still run right across a kept part.
  const k = keep.findIndex((range) => range.start >= word.start && range.end <= word.end)
  return k >= 0 ? { start: out(keep[k].start, k), end: out(keep[k].end, k) } : null
}

/** A line longer than this many characters is hard to read in the time it's
 *  on screen - the same rule of thumb every caption tool uses. */
const MAX_LINE_CHARS = 42
/** Or on screen longer than this many seconds, even if the words would fit. */
const MAX_LINE_SEC = 6
/** A gap this long between two words is a natural break in speech, so a new
 *  line starts there rather than mid-thought. */
const NEW_LINE_GAP_SEC = 0.7

/** Turns transcribed words into caption cues on the CUT video's timeline.
 *  Words cut out of the video (a removed silence, a removed "um") are
 *  dropped rather than shown as text with no matching audio underneath. */
export function buildCaptionCues(words: WordChunk[], keep: Range[], shifts?: number[]): CaptionCue[] {
  const cues: CaptionCue[] = []
  let current: CaptionCue | null = null

  for (const word of words) {
    const text = word.text.trim()
    if (!text) continue
    const placed = placeWord(word, keep, shifts)
    if (!placed) continue
    const { start, end } = placed

    const endsSentence = current ? /[.!?]$/.test(current.text) : false
    const breaksLine =
      current !== null &&
      (endsSentence ||
        start - current.end > NEW_LINE_GAP_SEC ||
        end - current.start > MAX_LINE_SEC ||
        current.text.length + 1 + text.length > MAX_LINE_CHARS)

    if (!current || breaksLine) {
      if (current) cues.push(current)
      current = { start, end, text }
    } else {
      current.text += ` ${text}`
      current.end = end
    }
  }
  if (current) cues.push(current)
  // Lines never overlap, though the model's word spans do: two lines on
  // screen at once is what an overlapping .srt gives in the editor.
  for (let i = 0; i + 1 < cues.length; i++) {
    if (cues[i].end > cues[i + 1].start) cues[i].end = Math.max(cues[i].start, cues[i + 1].start)
  }
  return cues
}

function srtTimestamp(seconds: number): string {
  const ms = Math.round(Math.max(0, seconds) * 1000)
  const pad = (n: number, len = 2) => String(n).padStart(len, '0')
  return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor((ms % 3_600_000) / 60_000))}:${pad(Math.floor((ms % 60_000) / 1000))},${pad(ms % 1000, 3)}`
}

/** Standard SubRip format: one numbered block per cue, blank line between. */
export function cuesToSrt(cues: CaptionCue[]): string {
  return cues
    .map((cue, i) => `${i + 1}\n${srtTimestamp(cue.start)} --> ${srtTimestamp(cue.end)}\n${cue.text}\n`)
    .join('\n')
}
