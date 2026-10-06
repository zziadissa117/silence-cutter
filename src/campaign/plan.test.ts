// The cut on a made-up talking-head take: a loudness curve built the way a
// phone recording of one person talking looks (room hiss, words that fade in
// and out, short gaps inside a sentence, real pauses between sentences), and
// the speech model's words timed the way it really times them - a little
// late or early, and with each word's end stretched over the pause after it.
//
// These run the same steps planCampaignCut runs once the sound is decoded and
// heard (fromHeard, plainKeep, noiseCandidates, cutNoise), so a change that
// leaves pauses in or eats words fails here before it reaches a phone. The
// noise-cutting update failed the "pauses are cut" checks below: it brought
// a heard word back by its whole stretched span, which put the pause back.

import { describe, expect, it } from 'vitest'

import type { WordChunk } from '../media/fillerWords'
import { PRESETS, findSilentRanges, type Level, type Range } from '../media/silenceMath'
import { cutNoise } from './noiseCuts'
import { fromHeard, noiseCandidates, plainKeep } from './plan'

const STEP = 0.02

/** A small, repeatable wobble (no Math.random: the test must not flake). */
function wobble(seed: number) {
  let x = seed
  return () => {
    x = (x * 1103515245 + 12345) % 2147483648
    return x / 2147483648
  }
}

interface Said {
  text: string
  start: number
  end: number
}

interface Take {
  levels: Level[]
  duration: number
  words: Said[]
  /** The pauses between sentences, as filmed. */
  pauses: Range[]
  /** Sounds that are not him talking (a cough, a bump). */
  noises: Range[]
}

/** Builds a take: sentences of words with short gaps, real pauses between
 *  sentences, room hiss everywhere else. `noiseAt` puts a short loud sound in
 *  the middle of the given pause. */
function makeTake({ quietWord = false, noiseIn = -1 }: { quietWord?: boolean; noiseIn?: number } = {}): Take {
  const rand = wobble(7)
  const sentences = [
    ['so', 'this', 'is', 'how', 'I', 'made', 'my', 'first', 'thousand'],
    ['every', 'single', 'month', 'from', 'one', 'app'],
    ['and', 'honestly', 'it', 'took', 'me', 'way', 'too', 'long'],
    ['here', 'is', 'what', 'you', 'do'],
  ]
  const pauseLengths = [0.9, 1.4, 0.7]
  const words: Said[] = []
  const pauses: Range[] = []
  let t = 0.8 // He starts talking after a beat.
  sentences.forEach((sentence, s) => {
    sentence.forEach((text, w) => {
      const length = 0.18 + 0.05 * text.length + rand() * 0.08
      words.push({ text, start: t, end: t + length })
      t += length
      if (w < sentence.length - 1) t += 0.05 + rand() * 0.1 // a breath between words
    })
    if (s < pauseLengths.length) {
      pauses.push({ start: t, end: t + pauseLengths[s] })
      t += pauseLengths[s]
    }
  })
  const duration = t + 1.0 // and stops recording a second after his last word

  const noises: Range[] = []
  if (noiseIn >= 0) {
    const p = pauses[noiseIn]
    const mid = (p.start + p.end) / 2
    noises.push({ start: mid - 0.1, end: mid + 0.1 })
  }
  const quietIndex = quietWord ? words.findIndex((w) => w.text === 'honestly') : -1

  const levels: Level[] = []
  for (let time = 0; time < duration; time += STEP) {
    let db = -58 + (rand() - 0.5) * 6 // the room
    words.forEach((w, i) => {
      const loud = i === quietIndex ? -37 : -20 + (rand() - 0.5) * 6
      if (time >= w.start && time < w.end) {
        // Fades in over 40 ms and out over 80 ms, like a voice does.
        const into = time - w.start
        const left = w.end - time
        const fade = Math.min(1, into / 0.04, left / 0.08)
        db = Math.max(db, loud - (1 - fade) * 30)
      }
    })
    for (const n of noises) if (time >= n.start && time < n.end) db = Math.max(db, -22)
    levels.push({ time, db })
  }
  return { levels, duration, words, pauses, noises }
}

/** The speech model's words for the take: starts up to 60 ms off either way,
 *  and every word's end stretched to the next word's start - across a pause
 *  too, the worst it does. Each text with its leading space, as it comes. */
function heardAs(take: Take): WordChunk[] {
  const rand = wobble(11)
  return take.words.map((w, i) => {
    const next = take.words[i + 1]
    return {
      text: ` ${w.text}`,
      start: Math.max(0, w.start + (rand() - 0.5) * 0.12),
      end: next ? next.start : w.end + 0.3,
    }
  })
}

const overlap = (a: Range, b: Range) => Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start))
const keptOf = (keep: Range[], r: Range) => keep.reduce((s, k) => s + overlap(k, r), 0)

/** The cut the cutter makes with noise cutting off: what every video gets. */
function plainCut(take: Take, cleanSpeech = true) {
  const settings = { ...PRESETS.balanced }
  const silences = findSilentRanges(take.levels, settings)
  const heard = fromHeard(heardAs(take), take.levels, settings, take.duration, cleanSpeech)
  const keep = plainKeep(silences, heard.fillerWords, heard.stutters, take.duration, settings)
  return { settings, heard, keep }
}

/** The same with noise cutting on, the second listen hearing nothing. */
function noiseCut(take: Take) {
  const plain = plainCut(take)
  const found = noiseCandidates(
    plain.keep,
    [...plain.heard.words, ...plain.heard.spoken],
    [...plain.heard.fillerWords, ...plain.heard.stutters],
    take.levels,
    take.duration,
  )
  return { ...plain, ...cutNoise(found.keep, found.lone, new Set()) }
}

/** Most a pause may keep: the padding either side and a fade. */
const MOST_LEFT_OF_PAUSE = 0.3

function expectPausesCut(take: Take, keep: Range[]) {
  for (const pause of take.pauses) {
    const left = keptOf(keep, pause) - keptOf(keep, take.noises.find((n) => overlap(n, pause) > 0) ?? { start: 0, end: 0 })
    expect(left, `pause at ${pause.start.toFixed(2)} (${(pause.end - pause.start).toFixed(1)} s) left ${left.toFixed(2)} s`).toBeLessThanOrEqual(
      MOST_LEFT_OF_PAUSE,
    )
  }
}

function expectWordsWhole(take: Take, keep: Range[]) {
  for (const w of take.words) {
    // Every word whole, give or take a frame at its very edges.
    const inner = { start: w.start + STEP, end: w.end - STEP }
    expect(keptOf(keep, inner), `"${w.text}" at ${w.start.toFixed(2)}`).toBeCloseTo(inner.end - inner.start, 5)
  }
}

describe('cutting a talking-head take (noise cutting off, the default)', () => {
  it('cuts every pause between sentences', () => {
    const take = makeTake()
    expectPausesCut(take, plainCut(take).keep)
  })
  it('keeps every word whole', () => {
    const take = makeTake()
    expectWordsWhole(take, plainCut(take).keep)
  })
  it('keeps a quietly said word', () => {
    const take = makeTake({ quietWord: true })
    expectWordsWhole(take, plainCut(take).keep)
  })
  it('keeps the short breaths inside a sentence', () => {
    const take = makeTake()
    const keep = plainCut(take).keep
    for (let i = 0; i + 1 < take.words.length; i++) {
      const gap = { start: take.words[i].end, end: take.words[i + 1].start }
      if (take.pauses.some((p) => overlap(p, gap) > 0)) continue
      expect(keptOf(keep, gap)).toBeCloseTo(gap.end - gap.start, 5)
    }
  })
  it('leaves only a beat before the first word and after the last', () => {
    const take = makeTake()
    const keep = plainCut(take).keep
    expect(keep[0].start).toBeGreaterThan(take.words[0].start - 0.3)
    expect(keep[keep.length - 1].end).toBeLessThan(take.words[take.words.length - 1].end + 0.4)
  })
  it('cuts the same with "um"s off or on when nothing is an "um"', () => {
    const take = makeTake()
    expect(plainCut(take, false).keep).toEqual(plainCut(take, true).keep)
  })
})

describe('captions from what was heard', () => {
  it('are exactly the words he said, in order, with nothing added', () => {
    const take = makeTake()
    const { spoken } = plainCut(take).heard
    expect(spoken.map((w) => w.text.trim())).toEqual(take.words.map((w) => w.text))
    for (let i = 1; i < spoken.length; i++) expect(spoken[i].start).toBeGreaterThanOrEqual(spoken[i - 1].start)
  })
  it('each start within a fifth of a second of the word', () => {
    const take = makeTake()
    const { words } = plainCut(take).heard
    words.forEach((w, i) => expect(Math.abs(w.start - take.words[i].start)).toBeLessThan(0.2))
  })
})

describe('cutting a talking-head take with noise cutting on', () => {
  it('still cuts every pause, though the model stretches words across them', () => {
    const take = makeTake()
    expectPausesCut(take, noiseCut(take).keep)
  })
  it('keeps every word whole', () => {
    const take = makeTake({ quietWord: true })
    expectWordsWhole(take, noiseCut(take).keep)
  })
  it('cuts a cough in a pause that the plain cut keeps, and lists it', () => {
    const take = makeTake({ noiseIn: 1 })
    const cough = take.noises[0]
    expect(keptOf(plainCut(take).keep, cough)).toBeGreaterThan(0.1)
    const out = noiseCut(take)
    expect(keptOf(out.keep, cough)).toBe(0)
    expect(out.checks.some((c) => overlap(c, cough) > 0 && c.cut)).toBe(true)
    expectWordsWhole(take, out.keep)
  })
})

describe('cutting "um"s in a quiet take', () => {
  /** He talks quietly (-40 dB) in a quiet room (-58 dB): "so um this works".
   *  The speech model heard "um" running on over "this" and missed "this". */
  function quietTake(): { levels: Level[]; duration: number; heard: WordChunk[]; said: Said[] } {
    const rand = wobble(3)
    const said: Said[] = [
      { text: 'so', start: 0.5, end: 0.8 },
      { text: 'um', start: 1.0, end: 1.3 },
      { text: 'this', start: 1.4, end: 1.65 },
      { text: 'works', start: 2.0, end: 2.4 },
    ]
    const duration = 3
    const levels: Level[] = []
    for (let time = 0; time < duration; time += STEP) {
      let db = -58 + (rand() - 0.5) * 4
      for (const w of said) if (time >= w.start && time < w.end) db = -40 + (rand() - 0.5) * 3
      levels.push({ time, db })
    }
    const heard = [
      { text: ' so', start: 0.5, end: 0.8 },
      { text: ' um', start: 1.0, end: 1.65 },
      { text: ' works', start: 2.0, end: 2.4 },
    ]
    return { levels, duration, heard, said }
  }

  it('never takes a quietly said word out with the "um"', () => {
    const take = quietTake()
    const settings = { ...PRESETS.balanced }
    const { fillerWords } = fromHeard(take.heard, take.levels, settings, take.duration, true)
    const missed = take.said.find((w) => w.text === 'this')!
    for (const cut of fillerWords) expect(overlap(cut, missed), 'the cut holds "this"').toBeLessThan(0.05)
  })
})
