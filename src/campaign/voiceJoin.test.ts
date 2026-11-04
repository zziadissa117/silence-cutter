import { describe, expect, it } from 'vitest'

import { CROSS_FADE_SEC, VoiceJoin, insidePart, type JoinedBlock } from './cutFades'

const RATE = 48000
const CHUNK = 1024

/** Room tone: steady noise, as a quiet room records. */
function recording(seconds: number): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE))
  let seed = 7
  for (let i = 0; i < out.length; i++) {
    seed = (seed * 16807) % 2147483647
    out[i] = (seed / 2147483647 - 0.5) * 0.2
  }
  return out
}

/** The kept parts read the way the render reads them: whole decoder chunks,
 *  cut to each part, through the join. */
function joinParts(source: Float32Array, keep: { start: number; end: number }[]): JoinedBlock[] {
  const join = new VoiceJoin(RATE, 1)
  const blocks: JoinedBlock[] = []
  keep.forEach(({ start, end }, i) => {
    const fadeIn = i === 0 || start - keep[i - 1].end > 0.001
    const fadeOut = i === keep.length - 1 || keep[i + 1].start - end > 0.001
    join.begin(fadeIn)
    for (let at = Math.floor((start * RATE) / CHUNK) * CHUNK; at < end * RATE; at += CHUNK) {
      const chunk = source.subarray(at, at + CHUNK)
      const [first, last] = insidePart(at / RATE, chunk.length, RATE, start, end)
      if (last > first) blocks.push(...join.push([chunk.subarray(first, last)]))
    }
    blocks.push(...join.end(fadeOut, i < keep.length - 1))
  })
  return blocks
}

function flat(blocks: JoinedBlock[]): Float32Array {
  const out = new Float32Array(blocks.reduce((n, b) => n + b.planes[0].length, 0))
  let at = 0
  for (const b of blocks) {
    out.set(b.planes[0], at)
    at += b.planes[0].length
  }
  return out
}

/** Loudness (RMS) in windows of `ms`. */
function windows(sound: Float32Array, ms: number): number[] {
  const size = Math.round((ms / 1000) * RATE)
  const out: number[] = []
  for (let at = 0; at + size <= sound.length; at += size) {
    let sum = 0
    for (let i = at; i < at + size; i++) sum += sound[i] * sound[i]
    out.push(Math.sqrt(sum / size))
  }
  return out
}

describe('his voice joined across the cuts', () => {
  const source = recording(6)
  const keep = [
    { start: 0.0, end: 1.2345 },
    { start: 1.61, end: 2.4 },
    { start: 2.4, end: 3.3 }, // carries straight on: no cut
    { start: 3.95, end: 5.5 },
  ]

  it('comes out as one unbroken stream, every block right after the one before', () => {
    const blocks = joinParts(source, keep)
    let at = 0
    for (const b of blocks) {
      expect(Math.round(b.timestamp * RATE)).toBe(at)
      at += b.planes[0].length
    }
    // Every kept frame, less one overlap per real cut (two here).
    const kept = keep.reduce((n, k) => n + Math.round(k.end * RATE) - Math.round(k.start * RATE), 0)
    expect(at).toBe(kept - 2 * Math.round(CROSS_FADE_SEC * RATE))
  })

  it('never goes dead or dips at a cut - the room sounds the same through it', () => {
    const sound = flat(joinParts(source, keep))
    const levels = windows(sound, 5)
    const steady = windows(source, 5).slice(10, 100)
    const usual = steady.reduce((a, b) => a + b, 0) / steady.length
    // Leave out the very start and end, which rise out of and fall into silence.
    for (const level of levels.slice(3, -3)) {
      expect(level).toBeGreaterThan(usual * 0.6)
      expect(level).toBeLessThan(usual * 1.4)
    }
  })

  it('rises out of silence at the very start and falls into it at the end', () => {
    const sound = flat(joinParts(source, keep))
    expect(Math.abs(sound[0])).toBeLessThan(0.01)
    expect(Math.abs(sound[sound.length - 1])).toBeLessThan(0.01)
  })

  it('pads with silence only up to where it is asked, never backwards', () => {
    const join = new VoiceJoin(RATE, 2)
    join.begin(true)
    join.push([new Float32Array(4800).fill(0.1), new Float32Array(4800).fill(0.1)])
    const ended = join.end(true, false)
    expect(join.position).toBeCloseTo(0.1, 6)
    expect(ended.length).toBe(1)
    const padded = join.padTo(0.15)
    expect(padded[0].timestamp).toBeCloseTo(0.1, 6)
    expect(padded[0].planes[0].length).toBe(2400)
    expect(join.padTo(0.12)).toEqual([])
    join.skipTo(0.4)
    expect(join.begin(true)).toBeCloseTo(0.4, 6)
  })
})
