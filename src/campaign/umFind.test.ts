import { describe, expect, it } from 'vitest'

import { isFillerWord } from '../media/fillerWords'
import type { Level } from '../media/silenceMath'
import { findUms, heardOnlyFiller } from './umFind'

/** 20 ms levels from [from, to, dB] spans; `wobble` makes talking uneven. */
function levelsOf(spans: [number, number, number, number?][]): Level[] {
  const out: Level[] = []
  for (const [from, to, db, wobble = 0] of spans) {
    for (let t = from; t < to - 1e-9; t += 0.02) out.push({ time: Math.round(t * 100) / 100, db: db + (wobble ? (Math.round(t * 50) % 2 ? wobble : -wobble) : 0) })
  }
  return out
}
const voice = { lineDb: -45, speechDb: -18 }

describe('"um"s found by their sound (his ask, 2026-11-11)', () => {
  it('his voice held between two words, where no word is: an "um"', () => {
    const levels = levelsOf([
      [0, 1, -20, 6], // "So"
      [1, 1.1, -60],
      [1.1, 1.6, -24], // "uhhh", steady
      [1.6, 1.7, -60],
      [1.7, 2.5, -20, 6], // "the thing"
    ])
    const ums = findUms([{ start: 0.1, end: 0.95 }, { start: 1.72, end: 2.4 }], levels, voice)
    expect(ums).toHaveLength(1)
    expect(ums[0].start).toBeGreaterThanOrEqual(0.99)
    expect(ums[0].end).toBeLessThanOrEqual(1.68)
    expect(ums[0].end - ums[0].start).toBeGreaterThan(0.45)
  })

  it('a pause, a breath, or uneven talking (a word the model missed) is not one', () => {
    const pause = levelsOf([[0, 1, -20, 6], [1, 1.6, -60], [1.6, 2.5, -20, 6]])
    const breath = levelsOf([[0, 1, -20, 6], [1, 1.1, -60], [1.1, 1.5, -48], [1.5, 1.6, -60], [1.6, 2.5, -20, 6]])
    const word = levelsOf([[0, 1, -20, 6], [1, 1.1, -60], [1.1, 1.6, -22, 9], [1.6, 1.7, -60], [1.7, 2.5, -20, 6]])
    const words = [{ start: 0.1, end: 0.95 }, { start: 1.72, end: 2.4 }]
    expect(findUms(words, pause, voice)).toEqual([])
    expect(findUms(words, breath, voice)).toEqual([])
    expect(findUms(words, word, voice)).toEqual([])
  })

  it('never reaches into the words either side, and not one far louder or quieter than his own "um"', () => {
    const levels = levelsOf([[0, 1, -20, 6], [1, 1.5, -24], [1.5, 2.5, -20, 6]])
    const words = [{ start: 0.1, end: 0.98 }, { start: 1.52, end: 2.4 }]
    const ums = findUms(words, levels, voice)
    expect(ums[0].start).toBeGreaterThanOrEqual(1.02 - 1e-9)
    expect(ums[0].end).toBeLessThanOrEqual(1.48 + 1e-9)
    expect(findUms(words, levels, { ...voice, umDb: -40 })).toEqual([])
  })

  it('a second listen that heard a real word keeps it', () => {
    expect(heardOnlyFiller([], isFillerWord)).toBe(true)
    expect(heardOnlyFiller([{ text: ' Um.' }], isFillerWord)).toBe(true)
    expect(heardOnlyFiller([{ text: ' money' }], isFillerWord)).toBe(false)
  })
})
