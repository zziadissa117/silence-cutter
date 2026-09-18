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
 *  rather than one exact string. */
const FILLER_WORDS = new Set([
  'um', 'umm', 'ummm', 'uh', 'uhh', 'uhm', 'er', 'err', 'erm', 'hmm', 'hmmm', 'mhm',
])

export interface WordChunk {
  text: string
  start: number
  end: number
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

/** The ranges to cut for stutters - a small word said twice or more in a row.
 *
 *  Only the earlier attempts go. The last one is the one he actually
 *  completed and the one the sentence continues from, so it stays, and the
 *  cut never reaches past the real word before the run or into the repeat
 *  being kept. Same guard rails as the filler cuts, for the same reason. */
export function stutterRanges(chunks: WordChunk[], levels: Level[], options: CutOptions = {}): Range[] {
  const { guardSec = 0.04, quietBelowDb = -35 } = options
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
  const { guardSec = 0.04, quietBelowDb = -35 } = options
  const isFiller = (c: WordChunk) => FILLER_WORDS.has(normalize(c.text))
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
      maxSoundSec: MAX_FILLER_SEC * fillersHere,
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
  rules: { quietBelowDb: number; quietStart: boolean; quietEnd: boolean; maxSounds: number; maxSoundSec: number },
): Range | null {
  const from = quietestBetween(levels, low, start, 'earliest')
  const to = quietestBetween(levels, end, high, 'latest')
  if (!from || !to) return null
  if (rules.quietStart && from.db >= rules.quietBelowDb) return null
  if (rules.quietEnd && to.db >= rules.quietBelowDb) return null

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
