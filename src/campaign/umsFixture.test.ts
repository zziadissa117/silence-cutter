// The "um" cut on real recordings - see fixtures/ums-*.json for where the
// words, times and ground truth come from. The speech model's words (with
// the filler prompt) go through the same steps planCampaignCut runs:
// speechCuts (fillerWordRanges / stutterRanges against the loudness curve)
// and plainKeep.

import { describe, expect, it } from 'vitest'

import { isFillerWord, type WordChunk } from '../media/fillerWords'
import { PRESETS, findSilentRanges, type Level, type Range } from '../media/silenceMath'
import call from './fixtures/ums-call.json'
import radio from './fixtures/ums-radio.json'
import { plainKeep, speechCuts } from './plan'

interface Fixture {
  duration: number
  levelStep: number
  levels: number[]
  words: WordChunk[]
  truthFillers: WordChunk[]
  truthWords: WordChunk[]
}

function levelsOf(f: Fixture): Level[] {
  return f.levels.map((db, i) => ({ time: i * f.levelStep, db }))
}

const inside = (t: number, ranges: Range[]) => ranges.some((r) => t >= r.start && t <= r.end)
const settings = PRESETS.balanced

function cutsOf(f: Fixture) {
  const levels = levelsOf(f)
  const silences = findSilentRanges(levels, settings)
  // The words are timed exactly (see the fixture), as the letter model times
  // them on the phone.
  const { fillerWords, stutters } = speechCuts(f.words, levels, settings, f.duration, true)
  const keep = plainKeep(silences, fillerWords, stutters, f.duration, settings)
  const pausesOnly = plainKeep(silences, [], [], f.duration, settings)
  return { levels, fillerWords, stutters, keep, pausesOnly }
}

describe.each([
  ['radio talk', radio as Fixture],
  ['a phone call', call as Fixture],
])('cutting "um"s in %s', (_, f) => {
  const heard = f.words.filter((w) => isFillerWord(w.text))
  const { fillerWords, keep, pausesOnly } = cutsOf(f)

  it('the speech model wrote down "uh"s once told to', () => {
    expect(heard.length).toBeGreaterThan(0)
  })

  it('cuts most of the "uh"s it heard, each where the ground truth has one', () => {
    const cut = heard.filter((w) => fillerWords.some((r) => w.start < r.end && w.end > r.start))
    expect(cut.length).toBeGreaterThanOrEqual(Math.ceil(heard.length * 0.6))
    for (const r of fillerWords) {
      const mid = (r.start + r.end) / 2
      const near = f.truthFillers.some((t) => t.start - 0.3 <= r.end && t.end + 0.3 >= r.start)
      expect(near, `cut ${r.start.toFixed(2)}-${r.end.toFixed(2)} (${mid.toFixed(2)}) is not on a real "uh"`).toBe(true)
    }
  })

  it('never cuts into a real word', () => {
    // A word's middle is the part that must survive; the ground-truth times
    // are CTC token times, within a frame or two of the sound.
    for (const w of f.truthWords) {
      const mid = (w.start + w.end) / 2
      expect(inside(mid, fillerWords), `"${w.text}" at ${w.start.toFixed(2)} was cut as an "um"`).toBe(false)
    }
  })

  it('leaves the kept video shorter by the "uh"s, with every word the pause cut keeps still in it', () => {
    const seconds = (ranges: Range[]) => ranges.reduce((n, r) => n + (r.end - r.start), 0)
    expect(seconds(keep)).toBeLessThan(seconds(pausesOnly))
    const kept = (w: WordChunk, ranges: Range[]) => {
      const mid = (w.start + w.end) / 2
      return ranges.some((r) => mid >= r.start - 0.05 && mid <= r.end + 0.05)
    }
    for (const w of f.truthWords) {
      if (!kept(w, pausesOnly)) continue
      expect(kept(w, keep), `"${w.text}" at ${w.start.toFixed(2)} went out with an "um"`).toBe(true)
    }
  })
})
