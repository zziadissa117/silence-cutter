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
