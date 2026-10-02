// The small pieces of a reaction video that need no browser: fitting two
// clips' sound to one rate, where each part lands on the finished video, and
// whether he talks in the product clip at all.
//
// A reaction video is two clips he filmed apart - him reacting, then the
// product - so their sound can come at different rates (a camera clip at
// 48 kHz, a screen recording at 44.1). Everything is brought to one rate
// before the voice, the music and the switch sound are mixed in.

import { totalDuration, type Range } from '../media/silenceMath'
import type { WordChunk } from '../media/fillerWords'

/** Linear resampling, a chunk at a time, with nothing lost at the seams. */
export class Resampler {
  private readonly step: number
  private readonly same: boolean
  /** Where the next output frame falls, in input frames from the start of
   *  the carried frame (or of the chunk, before the first). */
  private position = 0
  private carried: number[] | null = null

  constructor(fromRate: number, toRate: number) {
    this.step = fromRate / toRate
    this.same = fromRate === toRate
  }

  push(planes: Float32Array[]): Float32Array[] {
    if (this.same || planes.length === 0) return planes
    const length = planes[0].length
    if (length === 0) return planes
    const carried = this.carried
    const offset = carried ? 1 : 0
    const last = length + offset - 1
    const at = (c: number, i: number) => (i < offset ? carried![c] : planes[c][i - offset])
    const count = Math.max(0, Math.floor((last - this.position) / this.step) + 1)
    const out = planes.map(() => new Float32Array(count))
    let position = this.position
    for (let k = 0; k < count; k++) {
      const i = Math.floor(position)
      const fraction = position - i
      for (let c = 0; c < planes.length; c++) {
        const a = at(c, i)
        out[c][k] = fraction === 0 || i + 1 > last ? a : a + (at(c, i + 1) - a) * fraction
      }
      position += this.step
    }
    this.carried = planes.map((p) => p[length - 1])
    this.position = position - last
    return out
  }
}

/** Mono becomes both sides; anything past stereo is left out. */
export function toStereo(planes: Float32Array[]): Float32Array[] {
  return fitChannels(planes, 2)
}

/** A clip's sound with as many channels as the video it joins: mono spread
 *  to every side, stereo folded to mono, extra channels left out. */
export function fitChannels(planes: Float32Array[], channels: number): Float32Array[] {
  if (planes.length === 0 || planes.length === channels) return planes
  if (planes.length === 1) return Array.from({ length: channels }, (_, c) => (c === 0 ? planes[0] : planes[0].slice()))
  if (channels === 1) {
    const [left, right] = planes
    return [left.map((v, i) => (v + right[i]) / 2)]
  }
  if (planes.length > channels) return planes.slice(0, channels)
  return Array.from({ length: channels }, (_, c) => (c < planes.length ? planes[c] : planes[c % planes.length].slice()))
}

export interface Segment {
  part: 'reaction' | 'product'
  start: number
  end: number
  /** Where it starts on the finished video. */
  at: number
}

/** The reaction whole, then the product's kept parts, one after another. */
export function layOut(reaction: Range, product: Range[]): { segments: Segment[]; switchAt: number; total: number } {
  const segments: Segment[] = [{ part: 'reaction', ...reaction, at: 0 }]
  let at = reaction.end - reaction.start
  const switchAt = at
  for (const range of product) {
    if (range.end <= range.start) continue
    segments.push({ part: 'product', ...range, at })
    at += range.end - range.start
  }
  return { segments, switchAt, total: at }
}

/** Where a moment of the product clip lands on the finished video, or null
 *  when it was cut. */
export function productMoment(segments: Segment[], t: number): number | null {
  for (const s of segments) {
    if (s.part === 'product' && t >= s.start && t < s.end) return s.at + (t - s.start)
  }
  return null
}

/** Enough words that he is really talking - not the odd word the speech
 *  model makes out of music or a room's noise. */
export const TALKING_WORDS = 4

/** Whether he talks over the product: then its pauses are cut and it can
 *  have captions. Otherwise it is kept whole, as filmed. */
export function talksIn(words: WordChunk[], keep: Range[]): boolean {
  const said = words.filter((w) => w.text.trim()).length
  return said >= TALKING_WORDS && totalDuration(keep) > 1
}

/** Where a picture of `width`×`height` sits to fill a `canvasWidth`×
 *  `canvasHeight` frame, centred, its edges trimmed - so a screen recording,
 *  taller than a camera clip, fills the screen like the rest. */
export function cover(width: number, height: number, canvasWidth: number, canvasHeight: number) {
  const scale = Math.max(canvasWidth / width, canvasHeight / height)
  const w = width * scale
  const h = height * scale
  return { x: (canvasWidth - w) / 2, y: (canvasHeight - h) / 2, width: w, height: h }
}
