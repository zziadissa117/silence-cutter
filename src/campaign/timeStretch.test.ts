// His voice at another speed, its pitch kept (a clip's Speed in the edit screen).

import { describe, expect, it } from 'vitest'

import { stretch } from './timeStretch'

const RATE = 48000

/** A tone: `hz` for `seconds`, in two channels. */
function tone(hz: number, seconds: number): Float32Array[] {
  const n = Math.round(seconds * RATE)
  const a = new Float32Array(n)
  for (let i = 0; i < n; i++) a[i] = 0.5 * Math.sin((2 * Math.PI * hz * i) / RATE)
  return [a, a.slice()]
}

/** Its pitch, from how often it crosses zero (the middle, away from the ends). */
function pitchOf(plane: Float32Array): number {
  const from = Math.floor(plane.length * 0.2)
  const to = Math.floor(plane.length * 0.8)
  let crossings = 0
  for (let i = from + 1; i < to; i++) if ((plane[i - 1] < 0) !== (plane[i] < 0)) crossings++
  return crossings / 2 / ((to - from) / RATE)
}

/** How even it stays: the loudest and quietest of its 10 ms stretches. */
function evenness(plane: Float32Array): number {
  const block = RATE / 100
  const levels: number[] = []
  for (let at = Math.floor(plane.length * 0.1); at + block < plane.length * 0.9; at += block) {
    let sum = 0
    for (let i = 0; i < block; i++) sum += plane[at + i] ** 2
    levels.push(Math.sqrt(sum / block))
  }
  return Math.min(...levels) / Math.max(...levels)
}

describe('a clip at another speed, its pitch kept', () => {
  it.each([2, 1.5, 0.5, 0.75, 3])('at %sx: the length it should be, the same pitch, no dips', (speed) => {
    const input = tone(220, 2)
    const out = stretch(input, RATE, speed)
    expect(out).toHaveLength(2)
    expect(out[0].length).toBe(Math.round(input[0].length / speed))
    expect(pitchOf(out[0])).toBeGreaterThan(215)
    expect(pitchOf(out[0])).toBeLessThan(225)
    expect(evenness(out[0])).toBeGreaterThan(0.85)
    // Both channels moved the same way.
    expect(out[1]).toEqual(out[0])
  })

  it('as it is at 1x, and something very short is simply resampled', () => {
    const input = tone(220, 1)
    expect(stretch(input, RATE, 1)[0]).toBe(input[0])
    const short = tone(220, 0.02)
    expect(stretch(short, RATE, 2)[0].length).toBe(Math.round(short[0].length / 2))
  })
})
