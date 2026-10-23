// Decides which spoken filler words ("um", "uh"...) and stumbles ("I-I-I")
// to cut, given the words the speech model heard and the loudness curve.
// The model itself runs in transcribe.worker.ts; everything here is pure.
//
// This does NOT catch coughs, laughs or other non-speech noise. Whisper
// transcribes words; a cough isn't one.

import type { Level, Range } from './silenceMath'

/** Whisper's feature extractor is trained on 16kHz audio and expects the
 *  input already at that rate - a raw Float32Array is passed straight
 *  through with no resampling of its own. */
export const WHISPER_SAMPLE_RATE = 16000

/** English fillers, lowercased, punctuation stripped. Whisper sometimes
 *  spells these a few different ways ("umm" vs "um"), so this is a small set
 *  rather than one exact string. Not here on purpose: "mm"/"mhm" (agreeing),
 *  "eh" (a question), "oh" (a word) - said on purpose, and kept. */
const FILLER_WORDS = new Set([
  'um', 'umm', 'ummm', 'uh', 'uhh', 'uhhh', 'uhm', 'uhmm', 'er', 'err', 'erm', 'hmm', 'hmmm', 'hm', 'ah', 'ahh', 'ahm',
])

/** Whether a heard word is a filler ("um", "uh"...), whatever its case and
 *  punctuation. One place for every part of the app that asks. */
export function isFillerWord(text: string): boolean {
  return FILLER_WORDS.has(normalize(text))
}

export interface WordChunk {
  text: string
  start: number
  end: number
  /** Set on a heard "um" the letter model heard real letters in (plan.ts):
   *  a word the speech model misheard as a filler, kept like any word. */
  keep?: boolean
}

/** True when this browser can run the speech model: WebAssembly for the
 *  model, and a worker to run it in so its memory can be handed back. */
export function isFillerWordDetectionSupported(): boolean {
  return typeof WebAssembly !== 'undefined' && typeof Worker !== 'undefined'
}

/** Mixes an AudioBuffer down to mono and resamples it to 16kHz via linear
 *  interpolation. Good enough for speech recognition - this isn't trying to
 *  preserve audio fidelity, just get words in the right place. */
export function resampleToMono16k(buffer: AudioBuffer): Float32Array {
  const channels = buffer.numberOfChannels
  const mono = new Float32Array(buffer.length)
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c)
    for (let i = 0; i < data.length; i++) mono[i] += data[i] / channels
  }
  if (buffer.sampleRate === WHISPER_SAMPLE_RATE) return mono

  const ratio = buffer.sampleRate / WHISPER_SAMPLE_RATE
  const outLength = Math.max(1, Math.round(mono.length / ratio))
  const out = new Float32Array(outLength)
  for (let i = 0; i < outLength; i++) {
    const srcIndex = i * ratio
    const i0 = Math.floor(srcIndex)
    const i1 = Math.min(i0 + 1, mono.length - 1)
    const frac = srcIndex - i0
    out[i] = mono[i0] * (1 - frac) + mono[i1] * frac
  }
  return out
}

export function concatFloat32(chunks: Float32Array[]): Float32Array {
  const total = chunks.reduce((sum, c) => sum + c.length, 0)
  const out = new Float32Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

function normalize(word: string): string {
  return word.toLowerCase().replace(/[^a-z]/g, '')
}

/** Moves every word by the one shift that best lines the words up with where
 *  the audio is actually loud.
 *
 *  The speech model's timings run late, and by a steady amount: on a real
 *  take tiny.en put words 0.16-0.24s after base.en, and on a test clip it
 *  said "So" was still being spoken where the "um" after it had already
 *  started. Every filler cut is fenced by the words either side, so words
 *  that are late make the fences wrong - the cut is refused (the "um" stays
 *  in) or, worse, lands in the wrong place. The loudness curve knows where
 *  the sound really is, so it decides the shift: words should sit on sound,
 *  not on silence. Captions come out on time for the same reason. */
export function alignToAudio(words: WordChunk[], levels: Level[], quietBelowDb = -35): WordChunk[] {
  if (words.length === 0 || levels.length < 2) return words
  const step = levels[1].time - levels[0].time
  const first = levels[0].time
  const loud = levels.map((l) => (l.db >= quietBelowDb ? 1 : -1))
  const score = (shift: number) => {
    let total = 0
    for (const w of words) {
      const from = Math.max(0, Math.ceil((w.start - shift - first) / step))
      const to = Math.min(loud.length - 1, Math.floor((w.end - shift - first) / step))
      for (let i = from; i <= to; i++) total += loud[i]
    }
    return total
  }
  const unshifted = score(0)
  let best = 0
  let bestScore = unshifted
  // Late by up to half a second, early by up to a fifth - wider than anything
  // seen.
  for (let shift = -0.2; shift <= 0.5 + 1e-9; shift += 0.02) {
    const s = score(shift)
    if (s > bestScore || (s === bestScore && Math.abs(shift) < Math.abs(best))) {
      best = shift
      bestScore = s
    }
  }
  // Only taken when it clearly lines the words up better. A curve that says
  // little - loud all the way through, say - still wobbles by a frame or two
  // between shifts, and that is not a reason to move anything.
  const wordFrames = words.reduce((n, w) => n + Math.max(0, (w.end - w.start) / step), 0)
  if (Math.abs(best) < 1e-9 || bestScore - unshifted < Math.max(3, 0.05 * wordFrames)) return words
  return words.map((w) => ({ ...w, start: Math.max(0, w.start - best), end: Math.max(0, w.end - best) }))
}

interface CutOptions {
  /** How far a cut is kept clear of the real words either side. */
  guardSec?: number
  /** Below this loudness counts as quiet - the same threshold the silence
   *  cut uses, so "quiet" means the same thing everywhere in the tool. */
  quietBelowDb?: number
  /** The words were timed exactly (the letter model, align.ts: within about
   *  30 ms of the sound), so the words either side really are where the cut
   *  may reach. The cut then goes from the end of the word before to the
   *  start of the word after, each edge at the quietest moment it can find
   *  near there, with no need for a true pause: an "um" said straight on
   *  from the word before it ("at least, um, you know") is still cut.
   *  Without this - the speech model's rough times - a cut needs a pause at
   *  both edges, since a rough corridor can reach into a real word. */
  exact?: boolean
}

/** Words a stutter actually repeats. Deliberately only the small ones -
 *  pronouns, articles, conjunctions, prepositions.
 *
 *  Repetition is not automatically a mistake. "Very very good" and "no, no,
 *  no" are said on purpose and carry the weight of the line; "I-I-I want" and
 *  "the the" are not. Nothing here can tell those apart by sound, so the
 *  repeat check is restricted to the function words a stumble actually lands
 *  on. Guessing wider would edit what he meant to say. */
const STUTTER_WORDS = new Set([
  'i', 'a', 'the', 'and', 'it', 'is', 'in', 'to', 'of', 'that', 'this', 'we', 'you',
  'he', 'she', 'they', 'my', 'so', 'but', 'was', 'for', 'on', 'at', 'as', 'be', 'do',
])

/** A repeat held longer than this is deliberate, not a stumble - a stutter is
 *  fast. */
const MAX_STUTTER_SEC = 0.5

/** And the two have to land close together to be one stumble, rather than the
 *  same small word simply turning up twice in a sentence. */
const MAX_STUTTER_GAP_SEC = 0.45

/** The longest a single "um" is allowed to sound. A cut holding more sound
 *  than this per filler has almost certainly caught part of a real word. */
const MAX_FILLER_SEC = 0.9
/** With exact times the words either side are known, so a drawn-out
 *  "ummm" may be longer. */
const MAX_EXACT_FILLER_SEC = 1.3

/** With exact times, how far from the word either side an edge may move to
 *  find a quieter moment - into the pause before or after the "um", or a
 *  frame or two into the "um" itself. */
const EDGE_SEC = 0.1
/** An edge takes the earliest (start) or latest (end) moment within this
 *  much of the quietest one, so it sits against the word rather than a few
 *  frames into the "um" over a dB of difference. */
const EDGE_DB = 3

/** The ranges to cut for stutters - a small word said twice or more in a row.
 *
 *  Only the earlier attempts go. The last one is the one he actually
 *  completed and the one the sentence continues from, so it stays, and the
 *  cut never reaches past the real word before the run or into the repeat
 *  being kept. Same guard rails as the filler cuts, for the same reason. */
export function stutterRanges(chunks: WordChunk[], levels: Level[], options: CutOptions = {}): Range[] {
  const { guardSec = 0.04, quietBelowDb = -35, exact = false } = options
  const ranges: Range[] = []
  let i = 0

  while (i < chunks.length) {
    const word = normalize(chunks[i].text)
    if (!STUTTER_WORDS.has(word)) {
      i++
      continue
    }

    // How far does this run of the same word go?
    let last = i
    while (
      last + 1 < chunks.length &&
      normalize(chunks[last + 1].text) === word &&
      chunks[last + 1].start - chunks[last].end <= MAX_STUTTER_GAP_SEC
    ) {
      last++
    }

    if (last > i) {
      // Everything except the final attempt is the stumble.
      const attempts = last - i
      const runStart = chunks[i].start
      const runEnd = chunks[last - 1].end
      const kept = chunks[last]
      const shortEnough = chunks.slice(i, last).every((c) => c.end - c.start <= MAX_STUTTER_SEC)

      if (shortEnough) {
        const low = i > 0 ? chunks[i - 1].end + guardSec : 0
        const high = kept.start - guardSec
        const start = Math.max(low, Math.min(runStart, high))
        const end = Math.min(high, Math.max(runEnd, low))
        if (end > start && end - start >= 0.05) {
          const cut = checkedCut(levels, { low, start, end, high }, {
            quietBelowDb,
            quietStart: i > 0,
            quietEnd: true,
            maxSounds: attempts,
            maxSoundSec: MAX_STUTTER_SEC * attempts,
            exact,
          })
          if (cut) ranges.push(cut)
        }
      }
    }

    i = last + 1
  }

  return ranges
}

/** The ranges to cut for spoken filler words.
 *
 *  The recogniser's timings are approximate, so a filler's own start and end
 *  are not trustworthy enough to cut on directly. What *is* trustworthy is
 *  which words it heard either side: a cut for an "um" must never reach past
 *  the real word before it or the real word after it. Those two words are the
 *  guard rails, and `guardSec` keeps the cut a little clear of both.
 *
 *  Inside that corridor the cut is opened out to the quietest instant it can
 *  find, so the "um" goes along with the dead air around it and what is left
 *  runs speech straight into speech. Then the audio itself has the last word
 *  - see checkedCut. An "um" left in costs a second with the trimmer. A
 *  syllable taken off "connections" costs the take. */
export function fillerWordRanges(chunks: WordChunk[], levels: Level[], options: CutOptions = {}): Range[] {
  const { guardSec = 0.04, quietBelowDb = -35, exact = false } = options
  const isFiller = (c: WordChunk) => !c.keep && FILLER_WORDS.has(normalize(c.text))
  const ranges: Range[] = []

  chunks.forEach((chunk, i) => {
    if (!isFiller(chunk)) return

    // The nearest real words either side - not other fillers, so a run of
    // "um, uh" collapses into one cut rather than fighting over the gap.
    let before = -1
    for (let j = i - 1; j >= 0; j--) {
      if (!isFiller(chunks[j])) {
        before = j
        break
      }
    }
    let after = chunks.length
    for (let j = i + 1; j < chunks.length; j++) {
      if (!isFiller(chunks[j])) {
        after = j
        break
      }
    }
    const low = before >= 0 ? chunks[before].end + guardSec : 0
    const high = after < chunks.length ? chunks[after].start - guardSec : Number.POSITIVE_INFINITY

    const start = Math.max(low, Math.min(chunk.start, high))
    const end = Math.min(high, Math.max(chunk.end, low))
    if (!(end > start) || end - start < 0.05) return

    const fillersHere = after - before - 1
    const cut = checkedCut(levels, { low, start, end, high }, {
      quietBelowDb,
      quietStart: before >= 0,
      quietEnd: after < chunks.length,
      maxSounds: fillersHere,
      maxSoundSec: (exact ? MAX_EXACT_FILLER_SEC : MAX_FILLER_SEC) * fillersHere,
      exact,
    })
    if (cut) ranges.push(cut)
  })

  return ranges
}

/** Opens a cut out to the quietest moments inside its corridor, then asks
 *  the audio whether the model was right about what is in there - and
 *  returns null, leaving the words in, unless it clearly was.
 *
 *  The speech model's timings are approximate (the small model this runs on
 *  a phone more so), and a cut placed on a wrong timing takes the edge off a
 *  real word. The loudness curve doesn't guess. So a cut only happens when:
 *   - each edge that touches a real word lands in genuine quiet, and
 *   - between the edges there are no more separate sounds, and no more sound
 *     in total, than the filler or stumble being removed could make.
 *  An "um" said straight into the next word, or a mistimed "um" whose cut
 *  would also hold the start of the next word, fails one of those and stays. */
function checkedCut(
  levels: Level[],
  { low, start, end, high }: { low: number; start: number; end: number; high: number },
  rules: { quietBelowDb: number; quietStart: boolean; quietEnd: boolean; maxSounds: number; maxSoundSec: number; exact?: boolean },
): Range | null {
  let from: Level | null
  let to: Level | null
  if (rules.exact) {
    // The edges sit against the words either side (low and high are those
    // words' edges, a guard away), each moved only to a clearly quieter
    // moment close by: the pause before or after the "um", if there is one.
    const mid = (Math.max(low, start) + Math.min(high, end)) / 2
    from = edgeNear(levels, low, Math.min(mid, start + EDGE_SEC), 'earliest')
    to = edgeNear(levels, Math.max(mid, end - EDGE_SEC), high, 'latest')
    if (!from || !to || !(to.time > from.time)) return null
  } else {
    from = quietestBetween(levels, low, start, 'earliest')
    to = quietestBetween(levels, end, high, 'latest')
    if (!from || !to) return null
    if (rules.quietStart && from.db >= rules.quietBelowDb) return null
    if (rules.quietEnd && to.db >= rules.quietBelowDb) return null
  }

  const step = levels.length > 1 ? levels[1].time - levels[0].time : 0.02
  let sounds = 0
  let soundSec = 0
  let inSound = false
  for (const level of levels) {
    if (level.time < from.time) continue
    if (level.time > to.time) break
    const loud = level.db >= rules.quietBelowDb
    if (loud && !inSound) sounds++
    if (loud) soundSec += step
    inSound = loud
  }
  if (sounds > rules.maxSounds || soundSec > rules.maxSoundSec) return null

  return { start: from.time, end: to.time }
}

/** Where to cut near a word's edge, given exact times: the earliest (or
 *  latest) moment in [from, to] within EDGE_DB of the quietest one there. A
 *  flat stretch - an "um" said straight on from the word - gives the moment
 *  right by the word; a pause gives its far side. */
function edgeNear(levels: Level[], from: number, to: number, side: 'earliest' | 'latest'): Level | null {
  const within = levels.filter((l) => l.time >= from && l.time <= to)
  if (within.length === 0) {
    // Nothing between: the span is shorter than a frame. Take the nearest.
    const nearest = levels.find((l) => l.time >= from) ?? null
    return nearest && nearest.time <= to + 0.02 ? nearest : null
  }
  const quietest = Math.min(...within.map((l) => l.db))
  const close = within.filter((l) => l.db <= quietest + EDGE_DB)
  return side === 'earliest' ? close[0] : close[close.length - 1]
}

/** The quietest level in [from, to], or null when the curve has nothing in
 *  that span.
 *
 *  A gap is usually flat silence, so most of it ties for quietest. Which end
 *  of that tie wins decides whether the cut opens out into the gap or stops
 *  at its edge: the start of a cut wants the earliest such moment and the end
 *  of one wants the latest, so between them they take the whole pause and
 *  leave speech running into speech. */
function quietestBetween(levels: Level[], from: number, to: number, tie: 'earliest' | 'latest'): Level | null {
  let best: Level | null = null
  for (const level of levels) {
    if (level.time < from) continue
    if (level.time > to) break
    if (!best || level.db < best.db || (tie === 'latest' && level.db === best.db)) best = level
  }
  return best
}
