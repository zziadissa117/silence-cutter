// The speech model's words for one window, put on the video's timeline -
// kept apart from transcribe.worker.ts so it can be tested without the model.

import type { WordChunk } from '../media/fillerWords'

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
    if (!chunk.text.trim()) return
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
