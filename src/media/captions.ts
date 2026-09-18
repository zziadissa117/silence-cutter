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

/** Maps a moment on the original (uncut) timeline to where it lands in the
 *  output, or null if that moment was itself cut out - silence, or a removed
 *  filler word - and so has no equivalent in the output at all. */
function toOutputTime(t: number, keep: Range[]): number | null {
  let offset = 0
  for (const range of keep) {
    if (t < range.start) return null
    if (t <= range.end) return offset + (t - range.start)
    offset += range.end - range.start
  }
  return null
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
export function buildCaptionCues(words: WordChunk[], keep: Range[]): CaptionCue[] {
  const cues: CaptionCue[] = []
  let current: CaptionCue | null = null

  for (const word of words) {
    const start = toOutputTime(word.start, keep)
    const end = toOutputTime(word.end, keep)
    if (start === null || end === null) continue

    const text = word.text.trim()
    if (!text) continue

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
