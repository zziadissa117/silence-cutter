/** Smallest step, in seconds, between two consecutive output frames. */
const MIN_STEP = 0.0005

/** Hands out timestamps that only ever move forward. Phone and TikTok-saved
 *  videos can have frames a few milliseconds out of order, and after the cut
 *  shifts each range that made the muxer throw "Timestamps cannot be smaller
 *  than the largest timestamp of the previous GOP". Well-ordered footage is
 *  returned unchanged. */
export function forwardOnly() {
  let last = -Infinity
  return (timestamp: number): number => {
    const next = timestamp > last ? timestamp : last + MIN_STEP
    last = next
    return next
  }
}
