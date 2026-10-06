// Cutting the sounds that are not speech - a cough, a bump, a click, the
// room - without ever cutting a word.
//
// The pause cutter works on loudness, so any noise louder than the room counts
// as sound and its gap stays in. This looks at what the speech model heard:
// a stretch of kept sound with no word in it is a candidate. Three rules keep
// words safe, in this order of importance:
//
//   1. A word the model heard is never cut. Whatever the pause maths decided,
//      every heard word (apart from the "um"s and stumbles he asked to be
//      cut) is brought back whole, with a little room either side.
//   2. A candidate is looked at again. The model hears the stretch on its own,
//      a second time; if it finds a word now, the stretch is speech and stays.
//   3. Anything still cut that could have been a word is written down - the
//      exact moment, how long, how loud - so he can listen and put it back.
//      A long sound with no words is never cut, only pointed out.
//
// Pure, with no browser in it, so the rules can be tested.

import type { Range } from '../media/silenceMath'

export interface WordSpan {
  text?: string
  start: number
  end: number
}

/** Something the cutter did or left that is worth a second look. */
export interface CutCheck {
  start: number
  end: number
  /** noise: a short sound with no word in it, cut. maybe-word: a longer one
   *  that could have been a quiet word, cut after a second listen found none.
   *  long-sound: a long stretch with no words, left in. */
  kind: 'noise' | 'maybe-word' | 'long-sound'
  /** Whether the stretch is out of the video now. */
  cut: boolean
  /** How loud its loudest moment was, in dB (0 is the loudest there is). */
  peakDb?: number
}

/** A sound shorter than this is no word. Cut without a second look, and not
 *  worth listing: a click is gone before it can be heard. */
export const TINY_SEC = 0.12
/** Up to here a lone sound is cut (after a second listen) and listed; this is
 *  about the longest "yeah" or "no". */
export const SHORT_SEC = 0.35
/** Longer than this with no words is more likely speech the model missed than
 *  noise, so it stays. */
export const LONG_SEC = 2.5
/** Room kept around a word that had to be brought back. */
export const WORD_ROOM_SEC = 0.06
/** A heard word with at least this share of it still in the video is left as
 *  it is: see protectWords. */
const MOSTLY_KEPT = 0.5
/** The most that noise cutting may take out of what was kept. More than this
 *  means the model heard almost nothing, and its silence cannot be trusted. */
export const MAX_NOISE_SHARE = 0.4

const overlaps = (a: Range, b: Range, margin = 0) => a.start < b.end + margin && b.start < a.end + margin

function merge(ranges: Range[]): Range[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start)
  const out: Range[] = []
  for (const r of sorted) {
    const last = out[out.length - 1]
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end)
    else out.push({ ...r })
  }
  return out
}

/** Rule 1: every heard word is inside what is kept. A word he asked to have
 *  cut (inside `meantToCut`) is left out. Returns the kept parts - the same
 *  ones when nothing was cutting a word - and how many words were brought
 *  back. */
export function protectWords(
  keep: readonly Range[],
  words: readonly WordSpan[],
  meantToCut: readonly Range[],
  duration: number,
  room = WORD_ROOM_SEC,
): { keep: Range[]; broughtBack: number } {
  const extra: Range[] = []
  for (const word of words) {
    if (!(word.end > word.start)) continue
    const middle = (word.start + word.end) / 2
    if (meantToCut.some((r) => middle >= r.start && middle <= r.end)) continue
    // Only a word that was mostly cut is brought back. The speech model runs a
    // word on into the pause after it, so a word mostly inside a kept stretch
    // with its end hanging over a cut is the model's timing, not a word that
    // was cut: bringing that back put the tail of every pause back in and left
    // the silences longer than the cutter had made them.
    const inside = keep.reduce((sum, r) => sum + Math.max(0, Math.min(r.end, word.end) - Math.max(r.start, word.start)), 0)
    if (inside / (word.end - word.start) < MOSTLY_KEPT) {
      extra.push({ start: Math.max(0, word.start - room), end: Math.min(duration, word.end + room) })
    }
  }
  if (extra.length === 0) return { keep: keep.map((r) => ({ ...r })), broughtBack: 0 }
  return { keep: merge([...keep, ...extra]), broughtBack: extra.length }
}

export interface Candidate {
  range: Range
  /** Index into the kept parts it came from. */
  part: number
  peakDb?: number
}

/** The kept parts with no word in them: the sounds that might be noise. */
export function loneSounds(keep: readonly Range[], words: readonly WordSpan[], peakOf?: (r: Range) => number | undefined): Candidate[] {
  const out: Candidate[] = []
  keep.forEach((range, part) => {
    if (words.some((w) => overlaps(range, w, 0.05))) return
    out.push({ range, part, peakDb: peakOf?.(range) })
  })
  return out
}

export interface NoiseResult {
  keep: Range[]
  checks: CutCheck[]
  /** How many sounds were cut, listed or not. */
  cut: number
  /** Said when the safety limit stopped it cutting. */
  note?: string
}

/** Rules 2 and 3. `heardAgain` says which of the candidates the model found a
 *  word in when it listened to them on their own; those are speech and stay.
 *  Everything else is cut - unless it is long, or cutting it would take out
 *  too much - and written down. */
export function cutNoise(
  keep: readonly Range[],
  candidates: readonly Candidate[],
  heardAgain: ReadonlySet<number>,
): NoiseResult {
  const kept = keep.map((r) => ({ ...r }))
  const checks: CutCheck[] = []
  const total = kept.reduce((s, r) => s + (r.end - r.start), 0)
  const planned: Candidate[] = []

  candidates.forEach((c, i) => {
    const d = c.range.end - c.range.start
    if (heardAgain.has(i)) return
    if (d > LONG_SEC) {
      checks.push({ ...c.range, kind: 'long-sound', cut: false, peakDb: c.peakDb })
      return
    }
    planned.push(c)
  })

  const takes = planned.reduce((s, c) => s + (c.range.end - c.range.start), 0)
  // Never cut everything: at least one part stays, and not past the share.
  if (planned.length >= kept.length || takes > total * MAX_NOISE_SHARE) {
    for (const c of planned) {
      checks.push({ ...c.range, kind: c.range.end - c.range.start <= SHORT_SEC ? 'noise' : 'maybe-word', cut: false, peakDb: c.peakDb })
    }
    return {
      keep: kept,
      checks: checks.sort((a, b) => a.start - b.start),
      cut: 0,
      note: planned.length > 0 ? 'Almost everything looked like noise, so none of it was cut - check the marked sounds.' : undefined,
    }
  }

  const drop = new Set(planned.map((c) => c.part))
  for (const c of planned) {
    const d = c.range.end - c.range.start
    // A click is gone before it can be heard: cut, and not worth listing.
    if (d < TINY_SEC) continue
    checks.push({ ...c.range, kind: d <= SHORT_SEC ? 'noise' : 'maybe-word', cut: true, peakDb: c.peakDb })
  }
  return {
    keep: kept.filter((_, i) => !drop.has(i)),
    checks: checks.sort((a, b) => a.start - b.start),
    cut: planned.length,
  }
}

/** Puts a cut stretch back: it becomes kept again and joins its neighbours. */
export function putBack(keep: readonly Range[], range: Range): Range[] {
  return merge([...keep, range])
}

/** Cuts a stretch out of what is kept. */
export function cutOut(keep: readonly Range[], range: Range): Range[] {
  const out: Range[] = []
  for (const k of keep) {
    if (range.end <= k.start || range.start >= k.end) {
      out.push({ ...k })
      continue
    }
    if (range.start > k.start) out.push({ start: k.start, end: range.start })
    if (range.end < k.end) out.push({ start: range.end, end: k.end })
  }
  return out.length > 0 ? out : keep.map((k) => ({ ...k }))
}

/** A loudness curve boiled down to `perSecond` bars from 0 (quiet) to 1
 *  (loud), for drawing the sound under the timeline. */
export function peaksOf(levels: readonly { time: number; db: number }[], duration: number, perSecond = 10, floorDb = -60): number[] {
  const n = Math.max(1, Math.ceil(duration * perSecond))
  const bars = new Array<number>(n).fill(0)
  for (const { time, db } of levels) {
    const i = Math.min(n - 1, Math.max(0, Math.floor(time * perSecond)))
    const v = Number.isFinite(db) ? Math.min(1, Math.max(0, (db - floorDb) / -floorDb)) : 0
    if (v > bars[i]) bars[i] = v
  }
  return bars.map((v) => Math.round(v * 100) / 100)
}

/** The loudest the sound gets inside a range, in dB, from the same curve. */
export function peakDbIn(levels: readonly { time: number; db: number }[], range: Range): number | undefined {
  let peak = -Infinity
  for (const l of levels) if (l.time >= range.start && l.time <= range.end && l.db > peak) peak = l.db
  return Number.isFinite(peak) ? Math.round(peak) : undefined
}
