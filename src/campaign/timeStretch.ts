// His voice faster or slower with its pitch kept, for a clip set to another
// speed in the edit screen (cuts.Part.speed): not a chipmunk at 2x, not a
// growl at 0.5x.
//
// WSOLA (waveform-similarity overlap-add): the sound is cut into short
// overlapping windows; windows are taken from the recording at the new pace
// and laid down at the old one, each one nudged - within a few milliseconds -
// to where its waveform lines up best with what is already laid down, so the
// overlaps add up without the warble or clicks of laying them blindly. Good
// for speech, which is all a talking video has; no library needed.

/** One window: 30 ms - a few periods of a voice, short against a syllable. */
const WINDOW_SEC = 0.03
/** How far a window may move to line up with what is laid down. */
const SEEK_SEC = 0.012
/** Lining up is judged on every this-many samples: as good, much faster. */
const SEEK_STEP = 2

/** `planes` (one per channel, same length) played `speed` times as fast, their
 *  pitch kept. Speed 1 gives them back as they are. */
export function stretch(planes: readonly Float32Array[], sampleRate: number, speed: number): Float32Array[] {
  const length = planes[0]?.length ?? 0
  if (speed === 1 || length === 0 || !(speed > 0)) return planes.map((p) => p)
  const outLength = Math.max(1, Math.round(length / speed))
  const size = 2 * Math.max(16, Math.round((WINDOW_SEC * sampleRate) / 2))
  if (length < size * 2) return planes.map((p) => resample(p, outLength))

  const hop = size / 2
  const seek = Math.max(1, Math.round(SEEK_SEC * sampleRate))
  const window = new Float32Array(size)
  for (let i = 0; i < size; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size)

  // What the windows are lined up on: all channels together.
  const mono = new Float32Array(length)
  for (const p of planes) for (let i = 0; i < length; i++) mono[i] += p[i] / planes.length

  const out = planes.map(() => new Float32Array(outLength + size))
  const weight = new Float32Array(outLength + size)
  const last = length - size
  let previous = 0
  for (let k = 0; k * hop < outLength; k++) {
    const nominal = Math.round(k * hop * speed)
    let from = Math.min(Math.max(0, nominal), last)
    if (k > 0) {
      // What would have followed the window laid down last: the next window
      // is moved to look most like it.
      const natural = Math.min(previous + hop, last)
      const lo = Math.max(0, from - seek)
      const hi = Math.min(last, from + seek)
      let best = from
      let bestScore = -Infinity
      for (let at = lo; at <= hi; at++) {
        let dot = 0
        let energy = 1e-9
        for (let i = 0; i < hop; i += SEEK_STEP) {
          const a = mono[at + i]
          dot += a * mono[natural + i]
          energy += a * a
        }
        const score = dot / Math.sqrt(energy)
        if (score > bestScore) {
          bestScore = score
          best = at
        }
      }
      from = best
    }
    const to = k * hop
    for (let c = 0; c < planes.length; c++) {
      const src = planes[c]
      const dst = out[c]
      for (let i = 0; i < size; i++) dst[to + i] += src[from + i] * window[i]
    }
    for (let i = 0; i < size; i++) weight[to + i] += window[i]
    previous = from
  }
  return out.map((plane) => {
    const done = new Float32Array(outLength)
    for (let i = 0; i < outLength; i++) done[i] = weight[i] > 1e-3 ? plane[i] / weight[i] : plane[i]
    return done
  })
}

/** Too short to stretch window by window: simply resampled. */
function resample(plane: Float32Array, outLength: number): Float32Array {
  const out = new Float32Array(outLength)
  const ratio = plane.length / outLength
  for (let i = 0; i < outLength; i++) {
    const at = i * ratio
    const k = Math.floor(at)
    const f = at - k
    out[i] = (plane[k] ?? 0) * (1 - f) + (plane[Math.min(plane.length - 1, k + 1)] ?? 0) * f
  }
  return out
}
