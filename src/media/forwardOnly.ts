// Output timestamps that can only move forward.
//
// The MP4 writer throws "Timestamps cannot be smaller than the largest
// timestamp of the previous GOP" the moment a frame lands before one already
// written, and every audio packet counts as a GOP of its own, so for audio even
// a few milliseconds of overlap is fatal. Chrome's decoders hand frames back in
// tidy order, but Safari on an iPhone passes on whatever the file says - and
// videos saved from TikTok and some editors say frames a few milliseconds out
// of order. So the order is enforced here rather than trusted. Well-ordered
// footage comes through unchanged.

/** Smallest step, in seconds, between two consecutive video frames. */
const MIN_STEP = 0.0005

/** Video: each timestamp strictly after the one before it. */
export function forwardOnly() {
  let last = -Infinity
  return (timestamp: number): number => {
    const next = timestamp > last ? timestamp : last + MIN_STEP
    last = next
    return next
  }
}

/** Audio: each sample starts no earlier than the previous one ended, so no two
 *  ever overlap. A sample that starts late is left late - the encoder fills
 *  that gap with silence - so the audio never drifts ahead of the video. */
export function contiguousAudio() {
  let end = -Infinity
  return (timestamp: number, duration: number): number => {
    const start = Math.max(timestamp, end)
    end = start + duration
    return start
  }
}
