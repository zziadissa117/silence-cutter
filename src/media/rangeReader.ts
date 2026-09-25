// Reads the kept ranges of a track out of ONE decoder, front to back.
//
// The cut used to call `sink.samples(start, end)` once per kept range, and
// each call builds a fresh hardware decoder, seeks back to the key frame
// before `start`, decodes forward to it, and tears the decoder down. For a
// plain silence cut that is a dozen or so decoders and it holds up. Cutting
// "um"s and stumbles as well splits a video into many more, much shorter
// ranges, and on an iPhone 15 that burst of back-to-back 4K HDR decoders was
// more than Safari's GPU process could take: it went down mid-cut and the
// job failed with "decoding task did not complete" - which is why "Also cut
// um's and stumbles" never once finished on the phone, while captions (same
// speech model, no extra ranges) always did.
//
// This keeps one decoder for the whole cut and walks it through the ranges
// in order, dropping the frames that fall in the gaps. What each range gets
// is exactly what `samples(start, end)` would have given it, so the output
// timeline does not move:
//
//   - the frame already on screen at `start` (the last one starting at or
//     before it), unless a frame starts exactly at `start`
//   - then every frame starting before `end`
//
// with one refinement that per-range decoding made implicit: that decoder
// only ever saw frames from the key frame it seeked to, so a frame before
// that key frame could never be "the frame on screen". It matters when a
// range starts a hair before a key frame - mediabunny rounds the lookup onto
// the key frame, and the range begins cleanly on it rather than opening on
// one stale frame. The caller passes that key frame's timestamp in.
//
// including the edge case where a gap is shorter than one frame, so the same
// frame belongs to both neighbours - then, as before, it goes into both.

/** What the reader needs of a decoded sample: VideoSample and AudioSample
 *  both fit. */
export interface TimedSample {
  timestamp: number
  close(): void
  clone(): TimedSample
}

/** How many decoded frames may be held back to put them in order. Frames
 *  only ever arrive a frame or two out of place, and four 4K frames is a few
 *  tens of MB at most. */
const REORDER_DEPTH = 4

/** Hands samples on in timestamp order. Chrome's decoders already do, but
 *  Safari on an iPhone passes frames on as some files store them - videos
 *  saved from TikTok arrive with neighbours swapped - and a frame written
 *  after a later one is exactly what the MP4 writer refuses. A few samples are
 *  held back and the earliest always goes first, so the picture comes out in
 *  its real order rather than with one frame jumping back. */
export async function* inTimestampOrder<T extends TimedSample>(
  source: AsyncIterable<T>,
  depth = REORDER_DEPTH,
): AsyncGenerator<T> {
  const held: T[] = []
  try {
    for await (const sample of source) {
      let at = held.length
      while (at > 0 && held[at - 1].timestamp > sample.timestamp) at--
      held.splice(at, 0, sample)
      if (held.length > depth) yield held.shift()!
    }
    while (held.length > 0) yield held.shift()!
  } finally {
    for (const sample of held) sample.close()
  }
}

export class RangeReader<T extends TimedSample> {
  private readonly source: AsyncIterator<T>
  /** The next sample, already pulled, that belongs to a later range. */
  private lookahead: T | null = null
  /** A copy of the most recent sample seen - the frame on screen at the start
   *  of the next range, if no frame starts exactly there. */
  private previous: T | null = null

  constructor(source: AsyncIterable<T>) {
    this.source = source[Symbol.asyncIterator]()
  }

  private async pull(): Promise<T | null> {
    if (this.lookahead) {
      const sample = this.lookahead
      this.lookahead = null
      return sample
    }
    const next = await this.source.next()
    return next.done ? null : next.value
  }

  private remember(sample: T): void {
    this.previous?.close()
    this.previous = sample
  }

  /** The samples of [start, end), in presentation order. Ranges must be asked
   *  for in order and must not overlap. `decodeFrom` is the timestamp of the
   *  key packet a decoder seeking to `start` would begin at; nothing before
   *  it is used. The caller owns - and closes - every sample yielded. */
  async *range(start: number, end: number, decodeFrom = -Infinity): AsyncGenerator<T> {
    let yieldedAny = false
    const onScreenAtStart = () =>
      this.previous !== null && this.previous.timestamp <= start && this.previous.timestamp >= decodeFrom
    while (true) {
      const sample = await this.pull()
      if (sample === null || sample.timestamp >= end) {
        // Kept for the range it belongs to.
        if (sample) this.lookahead = sample
        // A range shorter than a frame still gets the frame on screen.
        if (!yieldedAny && onScreenAtStart()) {
          yield this.previous!.clone() as T
        }
        return
      }
      if (sample.timestamp < start) {
        // In the gap before this range. Dropped, but remembered: it may be
        // the frame on screen when the range starts.
        this.remember(sample)
        continue
      }
      if (!yieldedAny && sample.timestamp > start && onScreenAtStart()) {
        // Nothing starts exactly at `start`, so the frame before is the one
        // showing then.
        yield this.previous!.clone() as T
      }
      yieldedAny = true
      this.remember(sample.clone() as T)
      yield sample
    }
  }

  /** Lets go of the decoder and anything still held. */
  async dispose(): Promise<void> {
    this.previous?.close()
    this.previous = null
    this.lookahead?.close()
    this.lookahead = null
    await this.source.return?.()
  }
}
