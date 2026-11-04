// A tiny fade at every cut, so the sound never clicks where two kept parts meet.
//
// The sound is read in chunks of about 20 ms, and a kept part takes whole
// chunks: the one already playing at its start and every one starting before
// its end. Butted together, the wave jumped from wherever the last part
// stopped to wherever the next one started - a little click at every cut, the
// sound "a video makes when it ends and starts". Now each part's sound fades
// in over its first few milliseconds and out over its last, and whatever a
// chunk holds from outside the part (a sliver of the pause that was cut) is
// silent. 8 ms is far too short to hear as a fade, and long enough that the
// wave never jumps.
//
// Only his voice goes through this; the music and the look's sounds are laid
// over it afterwards, on the finished video's own timeline, and play straight
// through the cuts.

import type { Range } from '../media/silenceMath'

export const CUT_FADE_SEC = 0.008

/** Two parts this close together are one stretch of sound, not a cut. */
const JOINED_SEC = 0.001

/** Which ends of a kept part are a cut, and so fade. */
export interface CutEdges {
  fadeIn: boolean
  fadeOut: boolean
}

/** For each kept part: a cut at its start and end - a gap before or after it,
 *  a video played in the middle right there, or the very start and end of
 *  him. Two parts with nothing between them play on as one. */
export function cutEdges(keep: readonly Range[], videosAfter: readonly number[] = []): CutEdges[] {
  const after = new Set(videosAfter)
  return keep.map((range, i) => ({
    fadeIn: i === 0 || range.start - keep[i - 1].end > JOINED_SEC || after.has(i - 1),
    fadeOut: i === keep.length - 1 || keep[i + 1].start - range.end > JOINED_SEC || after.has(i),
  }))
}

/** How loud the sound at time `t` (on the recording) is let through, for the
 *  kept part [start, end): nothing outside it, rising over the first
 *  CUT_FADE_SEC after a cut and falling over the last before one. */
export function edgeGain(t: number, start: number, end: number, edges: CutEdges, fade = CUT_FADE_SEC): number {
  let gain = 1
  if (edges.fadeIn) {
    if (t < start) return 0
    if (t < start + fade) gain = Math.min(gain, (t - start) / fade)
  }
  if (edges.fadeOut) {
    if (t >= end) return 0
    if (t > end - fade) gain = Math.min(gain, (end - t) / fade)
  }
  return gain
}

/** Whether a chunk of sound from `from` lasting `seconds` reaches into a fade
 *  - most chunks don't, and go through untouched. */
export function nearCut(from: number, seconds: number, start: number, end: number, edges: CutEdges, fade = CUT_FADE_SEC): boolean {
  return (edges.fadeIn && from < start + fade) || (edges.fadeOut && from + seconds > end - fade)
}

/** Fades the chunk in place: `planes` is one array per channel, its first
 *  frame at `from` seconds on the recording, `rate` frames a second. */
export function fadeAtCuts(
  planes: Float32Array[],
  from: number,
  rate: number,
  start: number,
  end: number,
  edges: CutEdges,
  fade = CUT_FADE_SEC,
): void {
  const length = planes[0]?.length ?? 0
  for (let i = 0; i < length; i++) {
    const gain = edgeGain(from + i / rate, start, end, edges, fade)
    if (gain === 1) continue
    for (const plane of planes) plane[i] *= gain
  }
}

// ---------------------------------------------------------------------------
// His voice across the cuts, joined like an editor joins it (2026-11-04).
//
// His words: "every single time there's a cut, there's a little noise ...
// that little dead noise". Each kept part used to take whole chunks of sound
// (about 21 ms each), silence what a chunk held from outside the part, and
// line the part up with its picture; the picture usually ran a frame longer,
// and the file filled that with silence. So at every cut his room went dead
// for 20-60 ms - the dropout he hears. Now the sound of each part is cut to
// the sample at the part's edges, the next part follows on with no gap, and
// at a cut the two overlap for a few ms, one fading out as the other fades
// in at equal loudness: no dip, no click, no dead air.

/** How long two parts overlap at a cut. Long enough to never click or dip,
 *  short enough not to smear a word. */
export const CROSS_FADE_SEC = 0.012

/** A block of joined sound: one array per channel, from `timestamp` seconds
 *  on the finished video. */
export interface JoinedBlock {
  planes: Float32Array[]
  timestamp: number
}

const quarter = Math.PI / 2

/** Joins his kept parts into one unbroken stream of sound. For each part:
 *  `begin` (where it starts on the finished video), `push` its sound in order,
 *  `end`. What comes out is contiguous, in order, ready to be written. */
export class VoiceJoin {
  private readonly fade: number
  /** Frames handed out so far. */
  private out = 0
  /** The last frames of the part being read, held back until its end is
   *  known: they fade out, or overlap the next part. */
  private delay: Float32Array[]
  /** The previous part's last frames, to overlap with this one's first. */
  private held: Float32Array[] | null = null
  /** How this part starts: overlapping the one before, out of silence, or
   *  carrying straight on. */
  private mode: 'cross' | 'in' | 'none' = 'none'
  /** Frames of this part read so far. */
  private read = 0

  private readonly rate: number
  private readonly channels: number

  constructor(rate: number, channels: number, fadeSec = CROSS_FADE_SEC) {
    this.rate = rate
    this.channels = channels
    this.fade = Math.max(1, Math.round(fadeSec * rate))
    this.delay = this.empty(0)
  }

  /** Where the next part starts, in seconds on the finished video. */
  get position(): number {
    return this.out / this.rate
  }

  /** Something else's sound (a video joined on) was written up to
   *  `seconds`: the next part starts there. */
  skipTo(seconds: number): void {
    this.out = Math.max(this.out, Math.round(seconds * this.rate))
  }

  /** Silence up to `seconds` (where a video joined on starts, or the
   *  picture ran on): nothing is ever left as a hole for the file to fill. */
  padTo(seconds: number): JoinedBlock[] {
    const frames = Math.round(seconds * this.rate) - this.out
    if (frames <= 0) return []
    return [this.emit(this.empty(frames))]
  }

  /** A part starts. `fadeIn`: there is a cut before it - it overlaps the part
   *  before if that one was held for it, else rises out of silence. Returns
   *  where it starts, in seconds. */
  begin(fadeIn: boolean): number {
    // (A held part is always followed by a cut - cutEdges is symmetric.)
    this.mode = this.held ? 'cross' : fadeIn ? 'in' : 'none'
    this.read = 0
    return this.position
  }

  /** The part's next sound, already cut to the part. */
  push(planes: Float32Array[]): JoinedBlock[] {
    const length = planes[0]?.length ?? 0
    if (length === 0) return []
    const input = this.fit(planes)
    if (this.mode !== 'none' && this.read < this.fade) {
      const until = Math.min(length, this.fade - this.read)
      for (let i = 0; i < until; i++) {
        const x = (this.read + i + 0.5) / this.fade
        const rise = Math.sin(x * quarter)
        const fall = Math.cos(x * quarter)
        const k = this.read + i
        for (let c = 0; c < this.channels; c++) {
          const before = this.mode === 'cross' && this.held && k < this.held[c].length ? this.held[c][k] : 0
          input[c][i] = input[c][i] * rise + before * fall
        }
      }
    }
    this.read += length
    if (this.mode === 'cross' && this.read >= (this.held?.[0].length ?? 0)) this.held = null
    const all = this.concat(this.delay, input)
    const keep = Math.min(this.fade, all[0].length)
    const ready = all[0].length - keep
    this.delay = all.map((p) => p.slice(ready))
    return ready > 0 ? [this.emit(all.map((p) => p.slice(0, ready)))] : []
  }

  /** The part ends. `fadeOut`: a cut after it. `joinsNext`: the next thing is
   *  another of his parts (not a video joined on, not the end), so its last
   *  frames are kept to overlap that part's first. */
  end(fadeOut: boolean, joinsNext: boolean): JoinedBlock[] {
    const blocks: JoinedBlock[] = []
    // A part shorter than the overlap: the rest of the one before, already
    // nearly faded out, is let go.
    this.held = null
    const tail = this.delay
    this.delay = this.empty(0)
    const n = tail[0].length
    if (n === 0) return blocks
    if (fadeOut && joinsNext) {
      this.held = tail
      return blocks
    }
    if (fadeOut) {
      for (let i = 0; i < n; i++) {
        const gain = Math.cos(((this.fade - n + i + 0.5) / this.fade) * quarter)
        for (const plane of tail) plane[i] *= gain
      }
    }
    blocks.push(this.emit(tail))
    return blocks
  }

  private emit(planes: Float32Array[]): JoinedBlock {
    const block = { planes, timestamp: this.out / this.rate }
    this.out += planes[0].length
    return block
  }

  private empty(length: number): Float32Array[] {
    return Array.from({ length: this.channels }, () => new Float32Array(length))
  }

  private fit(planes: Float32Array[]): Float32Array[] {
    return Array.from({ length: this.channels }, (_, c) => Float32Array.from(planes[Math.min(c, planes.length - 1)]))
  }

  private concat(a: Float32Array[], b: Float32Array[]): Float32Array[] {
    return a.map((p, c) => {
      const joined = new Float32Array(p.length + b[c].length)
      joined.set(p)
      joined.set(b[c], p.length)
      return joined
    })
  }
}

/** The frames of a chunk from `from` seconds that fall inside [start, end),
 *  cut to the sample - [first, last) indexes into the chunk. */
export function insidePart(from: number, length: number, rate: number, start: number, end: number): [number, number] {
  const first = Math.max(0, Math.min(length, Math.round((start - from) * rate)))
  const last = Math.max(first, Math.min(length, Math.round((end - from) * rate)))
  return [first, last]
}
