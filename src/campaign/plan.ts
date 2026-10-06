// Finds what to keep of a raw video, and when he said the brand's name.
//
// This is the plain cutter's planCut (media/silenceCut.ts) step for step -
// one audio decode for the loudness curve and the speech model's copy, the
// same silence maths, the same "um" and stumble checks - with one change:
// the speech model is told the campaign's names before it listens (see
// transcribe.worker.ts in this folder). planCut itself is left alone; the
// plain cutter works and stays exactly as it is.

import { ALL_FORMATS, AudioBufferSink, BlobSource, Input, UnsupportedInputFormatError } from 'mediabunny'

import { SilenceCutError } from '../media/errors'
import {
  WHISPER_SAMPLE_RATE,
  alignToAudio,
  concatFloat32,
  fillerWordRanges,
  isFillerWordDetectionSupported,
  resampleToMono16k,
  stutterRanges,
  type WordChunk,
} from '../media/fillerWords'
import {
  findSilentRanges,
  keepRanges,
  mergeRanges,
  speechWindows,
  type Level,
  type Range,
  type SilenceSettings,
} from '../media/silenceMath'
import { report } from '../report'
import { pieceCuts, type TimedWord } from './align'
import type { AlignMessage, AlignRequest } from './align.worker'
import { ALIGNED_LATE_SEC, snapToOnsets, spokenWords } from './captions'
import { LONG_SEC, TINY_SEC, cutNoise, loneSounds, peakDbIn, peaksOf, protectWords, type CutCheck, type WordSpan } from './noiseCuts'
import type { TranscribeMessage, TranscribeRequest } from './transcribe.worker'

const UNREADABLE_FORMAT =
  "This browser can't read this video's format. On a computer, open this page in Safari or Chrome; on a phone, update to the newest iOS."

const ANALYSIS_WINDOW_SEC = 0.02

function levelDb(rms: number): number {
  return rms <= 0 ? -Infinity : 20 * Math.log10(rms)
}

function throttled(onProgress?: (fraction: number) => void): (fraction: number) => void {
  let last = -1
  return (fraction) => {
    const capped = Math.max(0, Math.min(0.99, fraction))
    if (!onProgress || capped - last < 0.01) return
    last = capped
    onProgress(capped)
  }
}

async function decodeAudio(
  audioTrack: NonNullable<Awaited<ReturnType<Input['getPrimaryAudioTrack']>>>,
  wantMono16k: boolean,
  duration: number,
  onProgress?: (fraction: number) => void,
): Promise<{ levels: Level[]; mono16k: Float32Array | null }> {
  const sink = new AudioBufferSink(audioTrack)
  const levels: Level[] = []
  const monoChunks: Float32Array[] = []
  const report = throttled(onProgress)
  for await (const { buffer, timestamp } of sink.buffers()) {
    if (duration > 0) report(timestamp / duration)
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c))
    const windowFrames = Math.max(1, Math.round(ANALYSIS_WINDOW_SEC * buffer.sampleRate))
    for (let i = 0; i < buffer.length; i += windowFrames) {
      const end = Math.min(i + windowFrames, buffer.length)
      let loudest = 0
      for (const channel of channels) {
        let sumSquares = 0
        for (let j = i; j < end; j++) sumSquares += channel[j] * channel[j]
        loudest = Math.max(loudest, Math.sqrt(sumSquares / (end - i)))
      }
      levels.push({ time: timestamp + i / buffer.sampleRate, db: levelDb(loudest) })
    }
    if (wantMono16k) monoChunks.push(resampleToMono16k(buffer))
  }
  return { levels, mono16k: wantMono16k ? concatFloat32(monoChunks) : null }
}

/** Runs the speech model in a worker that is ended as soon as it is done -
 *  the only way its memory comes back on a phone. */
async function transcribe(
  samples: Float32Array,
  windows: Range[],
  prompt: string,
  { onModelDownload, onProgress }: { onModelDownload?: (f: number) => void; onProgress?: (f: number) => void },
): Promise<WordChunk[]> {
  if (windows.length === 0) return []
  const worker = new Worker(new URL('./transcribe.worker.ts', import.meta.url), { type: 'module' })
  try {
    return await new Promise<WordChunk[]>((resolve, reject) => {
      let started = false
      worker.onmessage = (event: MessageEvent<TranscribeMessage>) => {
        started = true
        const message = event.data
        if (message.type === 'download') onModelDownload?.(message.fraction)
        else if (message.type === 'loaded') onProgress?.(0)
        else if (message.type === 'progress') onProgress?.(message.fraction)
        else if (message.type === 'done') resolve(message.words)
        else reject(new Error(`the speech model failed: ${message.message}`))
      }
      worker.onerror = (event) => {
        reject(
          started
            ? new Error(`the speech model stopped: ${event.message || 'no reason given'}`)
            : new SilenceCutError(
                "The speech model couldn't start. Close this page and open it again - it has probably been updated since it was opened.",
              ),
        )
      }
      const request: TranscribeRequest = { samples, sampleRate: WHISPER_SAMPLE_RATE, windows, prompt }
      worker.postMessage(request, [samples.buffer])
    })
  } finally {
    worker.terminate()
  }
}

/** How long the letter model may go without a word before it is given up
 *  on, and the captions keep the speech model's own times. */
const ALIGN_QUIET_MS = 60_000

/** Times every heard word exactly, in its own worker - see align.ts. The
 *  words go in as heard (pieces already joined), in order, and come back in
 *  the same order with new times. */
async function alignWords(
  samples: Float32Array,
  windows: Range[],
  words: WordChunk[],
  silences: Range[],
  { onModelDownload, onProgress }: { onModelDownload?: (f: number) => void; onProgress?: (f: number) => void },
): Promise<TimedWord[]> {
  // Each word goes with the stretch it was heard in, which the letter model
  // hears a piece at a time, cut in its pauses.
  const grouped = windows.map((w) => ({ ...w, words: [] as TimedWord[], cuts: pieceCuts(w, silences) }))
  for (const word of words) {
    const window = grouped.find((w) => word.start >= w.start && word.start < w.end) ?? grouped[grouped.length - 1]
    window?.words.push(word)
  }
  const worker = new Worker(new URL('./align.worker.ts', import.meta.url), { type: 'module' })
  try {
    return await new Promise<TimedWord[]>((resolve, reject) => {
      let quiet = 0
      const stillThere = () => {
        window.clearTimeout(quiet)
        quiet = window.setTimeout(() => reject(new Error('the letter model stopped answering')), ALIGN_QUIET_MS)
      }
      stillThere()
      worker.onmessage = (event: MessageEvent<AlignMessage>) => {
        stillThere()
        const message = event.data
        if (message.type === 'download') onModelDownload?.(message.fraction)
        else if (message.type === 'progress') onProgress?.(message.fraction)
        else if (message.type === 'done') {
          window.clearTimeout(quiet)
          resolve(message.words)
        } else {
          window.clearTimeout(quiet)
          reject(new Error(message.message))
        }
      }
      worker.onerror = (event) => {
        window.clearTimeout(quiet)
        reject(new Error(event.message || 'the letter model stopped'))
      }
      const request: AlignRequest = { samples, windows: grouped.filter((w) => w.words.length > 0) }
      worker.postMessage(request, [samples.buffer])
    })
  } finally {
    worker.terminate()
  }
}

export interface CampaignPlan {
  keep: Range[]
  duration: number
  silences: number
  fillerWords: number
  stutters: number
  words: WordChunk[]
  /** The same words timed for captions - see spokenWords. Missing from a
   *  video listened to before it existed. */
  spoken?: WordChunk[]
  /** Whether `spoken` was timed by the letter model, not just the speech
   *  model. */
  aligned?: boolean
  /** Whether "um"s and stumbles were cut too. */
  cleanSpeech: boolean
  /** Sounds with no speech in them that were cut or are worth a listen - see
   *  noiseCuts.ts. Absent when noise cutting was off. */
  checks?: CutCheck[]
  /** Said when noise cutting stopped itself. */
  noiseNote?: string
  /** The sound's loudness over the recording, 10 bars a second from 0 to 1,
   *  for drawing it under the cuts timeline. */
  peaks?: number[]
}

/** A clip kept as it is, with nothing heard in it. */
function keptWhole(duration: number, cleanSpeech: boolean): CampaignPlan {
  return { keep: [{ start: 0, end: duration }], duration, words: [], silences: 0, fillerWords: 0, stutters: 0, cleanSpeech }
}

export async function planCampaignCut(
  file: Blob,
  settings: SilenceSettings,
  options: {
    cleanSpeech: boolean
    /** Listen for words at all. */
    listen: boolean
    /** Told to the model before it listens; see keywords.listeningPrompt. */
    prompt: string
    /** Time every word exactly, for captions - see align.ts. */
    align?: boolean
    /** A reaction's product clip: silent, or with no sound at all, is how a
     *  screen recording comes - kept whole, with nothing heard. */
    quietIsFine?: boolean
    /** Keep every moment: nothing is cut, however long the pauses. Words are
     *  still heard when asked for (captions, the logo). */
    keepWhole?: boolean
    /** Cut the sounds with no speech in them, never a word (noiseCuts.ts). */
    cutNoise?: boolean
    onAnalyseProgress?: (fraction: number) => void
    onModelDownload?: (fraction: number) => void
    onTranscribeProgress?: (fraction: number) => void
  },
): Promise<CampaignPlan> {
  const wantWords = (options.cleanSpeech || options.listen) && isFillerWordDetectionSupported()
  let duration: number
  let levels: Level[]
  let mono16k: Float32Array | null

  {
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
    try {
      const [d, audioTrack] = await Promise.all([input.computeDuration(), input.getPrimaryAudioTrack()]).catch(
        (error: unknown) => {
          throw error instanceof UnsupportedInputFormatError
            ? new SilenceCutError("This file isn't a video this app can open. Try exporting it again as an MP4 or MOV.")
            : error
        },
      )
      if (!audioTrack && (options.quietIsFine || options.keepWhole)) return keptWhole(d, options.cleanSpeech)
      if (!audioTrack) throw new SilenceCutError('This video has no sound, so there is nothing to detect silence from.')
      if (!(await audioTrack.canDecode())) throw new SilenceCutError(UNREADABLE_FORMAT)
      duration = d
      ;({ levels, mono16k } = await decodeAudio(audioTrack, wantWords, d, options.onAnalyseProgress))
    } finally {
      input.dispose()
    }
  }

  const silences = findSilentRanges(levels, settings)

  let fillerWords: Range[] = []
  let stutters: Range[] = []
  let words: WordChunk[] = []
  let spoken: WordChunk[] | undefined
  let aligned = false
  let forRecheck: Float32Array | null = null
  let audibleSec = duration
  if (wantWords && mono16k) {
    const audible = Math.min(duration, mono16k.length / WHISPER_SAMPLE_RATE)
    audibleSec = audible
    const windows = speechWindows(silences, audible)
    // The speech model's worker takes the samples; the letter model needs
    // them after it.
    const forAligning = options.align ? mono16k.slice() : null
    // The model's second listen at the stretches that might be noise needs
    // the samples too, after the first listen has taken them.
    forRecheck = options.cutNoise && !options.keepWhole ? mono16k.slice() : null
    const share = forAligning ? 0.85 : 1
    const heard = await transcribe(mono16k, windows, options.prompt, {
      onModelDownload: options.onModelDownload,
      onProgress: (p) => options.onTranscribeProgress?.(p * share),
    })
    ;({ words, fillerWords, stutters, spoken } = fromHeard(heard, levels, settings, duration, options.cleanSpeech))
    if (forAligning && heard.length > 0) {
      try {
        const timed = await alignWords(forAligning, windows, spokenWords(heard, 0), silences, {
          onModelDownload: options.onModelDownload,
          onProgress: (p) => options.onTranscribeProgress?.(share + (1 - share) * p),
        })
        spoken = spokenWords(timed, ALIGNED_LATE_SEC)
        aligned = true
      } catch (error) {
        // The speech model's own times, shifted, as before: rougher, but
        // the video is never held up for it.
        report({ page: 'campaign', kind: 'fallback', phase: 'aligning', message: error instanceof Error ? error.message : String(error) })
      }
    }
  }

  const peaks = peaksOf(levels, duration)
  if (options.keepWhole) {
    return {
      keep: [{ start: 0, end: duration }],
      duration,
      words,
      ...(spoken ? { spoken, aligned } : {}),
      silences: 0,
      fillerWords: 0,
      stutters: 0,
      cleanSpeech: options.cleanSpeech,
      peaks,
    }
  }
  let keep = plainKeep(silences, fillerWords, stutters, duration, settings)
  if (keep.length === 0 && options.quietIsFine) return { ...keptWhole(duration, options.cleanSpeech), words, peaks }
  if (keep.length === 0) throw new SilenceCutError('The whole video looks silent. Try recording somewhere quieter.')

  // Sounds with no speech in them (noiseCuts.ts): a heard word is never cut,
  // each stretch that might be noise is listened to a second time before it
  // goes, and whatever is cut that could have been a word is written down.
  let checks: CutCheck[] | undefined
  let noiseNote: string | undefined
  if (options.cutNoise && forRecheck && words.length > 0) {
    const found = noiseCandidates(keep, [...words, ...(spoken ?? [])], mergeRanges([...fillerWords, ...stutters]), levels, duration)
    keep = found.keep
    const { lone, worth } = found
    const heardAgain = new Set<number>()
    if (worth.length > 0) {
      try {
        const again = await transcribe(
          forRecheck,
          worth.map(({ c }) => ({ start: Math.max(0, c.range.start - 0.25), end: Math.min(audibleSec, c.range.end + 0.25) })),
          options.prompt,
          { onModelDownload: options.onModelDownload },
        )
        for (const { c, i } of worth) {
          const found = again.filter((w) => w.start < c.range.end + 0.1 && w.end > c.range.start - 0.1)
          // Something was heard in it, so it is left in. What was heard is not
          // added to the words: a speech model listening to a stray sound on
          // its own makes words up ("you", "thank you"), and they would come
          // out in the captions, at the wrong times.
          if (found.length > 0) heardAgain.add(i)
        }
      } catch (error) {
        // The second listen failing means nothing is known about these
        // stretches, so none is cut.
        for (const { i } of worth) heardAgain.add(i)
        report({ page: 'campaign', kind: 'fallback', phase: 'noise', message: error instanceof Error ? error.message : String(error) })
      }
    }
    const result = cutNoise(keep, lone, heardAgain)
    keep = result.keep
    checks = result.checks
    noiseNote = result.note
  }
  return {
    keep,
    duration,
    words,
    ...(spoken ? { spoken, aligned } : {}),
    silences: silences.length,
    fillerWords: fillerWords.length,
    stutters: stutters.length,
    cleanSpeech: options.cleanSpeech,
    peaks,
    ...(checks ? { checks } : {}),
    ...(noiseNote ? { noiseNote } : {}),
  }
}

/** What the words heard decide, from the speech model's words and the
 *  loudness curve: the words moved onto his voice (for the logo and the
 *  pictures), the "um"s and stumbles to cut when asked, and the words timed
 *  for captions. Pure - the part of planCampaignCut that can be tested on a
 *  made-up take (plan.test.ts). */
export function fromHeard(
  heard: WordChunk[],
  levels: Level[],
  settings: SilenceSettings,
  duration: number,
  cleanSpeech: boolean,
): { words: WordChunk[]; fillerWords: Range[]; stutters: Range[]; spoken: WordChunk[] } {
  let words = alignToAudio(heard, levels, settings.thresholdDb)
  let fillerWords: Range[] = []
  let stutters: Range[] = []
  if (cleanSpeech) {
    const uncramp = (range: Range) => ({
      start: Math.max(0, range.start - settings.paddingSec),
      end: Math.min(duration, range.end + settings.paddingSec),
    })
    const cutOptions = { guardSec: 0.04, quietBelowDb: settings.thresholdDb }
    fillerWords = fillerWordRanges(words, levels, cutOptions).map(uncramp)
    stutters = stutterRanges(words, levels, cutOptions).map(uncramp)
  }
  // Starts pulled onto the moment his voice starts, for the logo and the
  // pictures. After the "um"s are found, so what is cut never moves.
  words = snapToOnsets(words, levels, settings.thresholdDb)
  // The captions' own timing, straight from what was heard: the shift the
  // cut's alignment finds moves some takes the wrong way for a caption.
  return { words, fillerWords, stutters, spoken: spokenWords(heard) }
}

/** What is kept: everything but the pauses, "um"s and stumbles, padded. This
 *  is the whole cut when noise cutting is off. */
export function plainKeep(silences: Range[], fillerWords: Range[], stutters: Range[], duration: number, settings: SilenceSettings): Range[] {
  return keepRanges(mergeRanges([...silences, ...fillerWords, ...stutters]), duration, settings.paddingSec)
}

/** Noise cutting's first step: heard words brought back if they were cut,
 *  the kept stretches with no word in them, and which of those are worth the
 *  model's second listen (the rest are too short to be a word or too long to
 *  cut). */
export function noiseCandidates(keep: Range[], words: WordSpan[], meantToCut: Range[], levels: Level[], duration: number) {
  const protectedKeep = protectWords(keep, words, meantToCut, duration).keep
  const lone = loneSounds(protectedKeep, words, (range) => peakDbIn(levels, range))
  const worth = lone.flatMap((c, i) => {
    const length = c.range.end - c.range.start
    return length >= TINY_SEC && length <= LONG_SEC ? [{ c, i }] : []
  })
  return { keep: protectedKeep, lone, worth }
}

/** What was heard in each recording of a video filmed in parts, moved to
 *  where that part sits in the joined file - so joining never means
 *  listening again. `offsets` come from joinRender: per part, what to add to
 *  its own times. */
export function joinPlans(plans: CampaignPlan[], offsets: number[], duration: number): CampaignPlan {
  const moved = <T extends { start: number; end: number }>(items: T[], by: number): T[] =>
    items.map((item) => ({ ...item, start: item.start + by, end: item.end + by }))
  const everySpoken = plans.every((p) => p.spoken)
  return {
    keep: plans.flatMap((p, i) => moved(p.keep, offsets[i])),
    duration,
    silences: plans.reduce((sum, p) => sum + p.silences, 0),
    fillerWords: plans.reduce((sum, p) => sum + p.fillerWords, 0),
    stutters: plans.reduce((sum, p) => sum + p.stutters, 0),
    words: plans.flatMap((p, i) => moved(p.words, offsets[i])),
    ...(everySpoken ? { spoken: plans.flatMap((p, i) => moved(p.spoken!, offsets[i])) } : {}),
    ...(plans.every((p) => p.aligned) ? { aligned: true } : {}),
    ...(plans.some((p) => p.checks) ? { checks: plans.flatMap((p, i) => moved(p.checks ?? [], offsets[i])) } : {}),
    cleanSpeech: plans[0]?.cleanSpeech ?? false,
  }
}
