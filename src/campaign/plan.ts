// Finds what to keep of a raw video, and when he said the brand's name.
//
// This is the plain cutter's planCut (media/silenceCut.ts) step for step -
// the same audio decode (media/audio.ts) for the loudness curve and the
// speech model's copy, the same silence maths, the same "um" and stumble
// checks, the same speech worker (media/transcribe.worker.ts) - with one
// change: the speech model is told the campaign's names before it listens,
// and hears each stretch with quiet either side. planCut itself is left
// alone; the plain cutter works and stays exactly as it is.

import { ALL_FORMATS, BlobSource, Input, UnsupportedInputFormatError } from 'mediabunny'

import { audioExtent, decodeAudio } from '../media/audio'
import { SilenceCutError, UNREADABLE_FORMAT } from '../media/errors'
import {
  WHISPER_SAMPLE_RATE,
  alignToAudio,
  fillerWordRanges,
  isFillerWord,
  isFillerWordDetectionSupported,
  stutterRanges,
  type WordChunk,
} from '../media/fillerWords'
import {
  findSilentRanges,
  keepRanges,
  mergeRanges,
  silenceLineDb,
  speechWindows,
  type Level,
  type Range,
  type SilenceSettings,
} from '../media/silenceMath'
import { report } from '../report'
import { detectLanguage, transcribeOnDevice } from '../media/transcribe'
import { MADE_UP_FRENCH, type SpeechLanguage } from '../media/speechLanguage'
import { pieceCuts, type HeardFiller, type TimedWord } from './align'
import type { AlignMessage, AlignRequest } from './align.worker'
import { ALIGNED_LATE_SEC, HEARD_LATE_SEC, captionWords, snapToOnsets, spokenWords, type CaptionWord } from './captions'
import { LONG_SEC, TINY_SEC, cutNoise, cutOut, loneSounds, peakDbIn, peaksOf, protectWords, type CutCheck, type WordSpan } from './noiseCuts'
import { partWindows } from './timedWords'
import { findUms, heardOnlyFiller } from './umFind'
import { chosenVoice, loadProfiles, percentile, withProfile } from './voiceProfile'

/** How long the letter model may go without a word before it is given up
 *  on, and the captions keep the speech model's own times. */
const ALIGN_QUIET_MS = 60_000
/** The same while it is still loading: read back from the phone's storage
 *  it says nothing until it is ready, and on a phone that has just run the
 *  speech model that took longer than a minute - "the letter model stopped
 *  answering" on 10 videos in two weeks, each captioned with rough times. */
const ALIGN_LOADING_MS = 150_000
/** A breath between the speech model's worker ending and the letter model's
 *  starting, for the phone to take the first one's memory back - and a
 *  longer one before trying again when it still could not. */
const ALIGN_AFTER_MS = 1_500
const ALIGN_RETRY_MS = 8_000

/** Times every heard word exactly, in its own worker - see align.ts. The
 *  words go in as heard (pieces already joined), in order, and come back in
 *  the same order with new times. */
async function alignWords(
  samples: Float32Array,
  windows: Range[],
  words: WordChunk[],
  silences: Range[],
  audioStart: number,
  { onModelDownload, onProgress }: { onModelDownload?: (f: number) => void; onProgress?: (f: number) => void },
): Promise<{ words: TimedWord[]; fillers: HeardFiller[] }> {
  // Each word goes with the stretch it was heard in, which the letter model
  // hears a piece at a time, cut in its pauses - or, for a word the speech
  // model put a little past its window's end, the nearest stretch, which is
  // the one it came from. Put in the last window instead, it made the letter
  // model squeeze the real last words of the video to fit it. Two windows
  // that share a stretch (a pause-free one's halves) are parted between two
  // words first, so each hears only the sound of its own words.
  const grouped = partWindows(windows, words).map((w) => ({ ...w, words: [] as TimedWord[], cuts: pieceCuts(w, silences) }))
  const nearest = (t: number) => {
    let best = grouped[grouped.length - 1]
    let distance = Infinity
    for (const w of grouped) {
      const d = t < w.start ? w.start - t : t >= w.end ? t - w.end : 0
      if (d < distance) [best, distance] = [w, d]
    }
    return best
  }
  for (const word of words) {
    const window = grouped.find((w) => word.start >= w.start && word.start < w.end) ?? nearest(word.start)
    window?.words.push(word)
  }
  const worker = new Worker(new URL('./align.worker.ts', import.meta.url), { type: 'module' })
  try {
    return await new Promise<{ words: TimedWord[]; fillers: HeardFiller[] }>((resolve, reject) => {
      let quiet = 0
      let loaded = false
      const stillThere = () => {
        window.clearTimeout(quiet)
        quiet = window.setTimeout(() => reject(new Error('the letter model stopped answering')), loaded ? ALIGN_QUIET_MS : ALIGN_LOADING_MS)
      }
      stillThere()
      worker.onmessage = (event: MessageEvent<AlignMessage>) => {
        if (event.data.type === 'progress') loaded = true
        stillThere()
        const message = event.data
        if (message.type === 'download') onModelDownload?.(message.fraction)
        else if (message.type === 'progress') onProgress?.(message.fraction)
        else if (message.type === 'done') {
          window.clearTimeout(quiet)
          resolve({ words: message.words, fillers: message.fillers ?? [] })
        } else {
          window.clearTimeout(quiet)
          reject(new Error(message.message))
        }
      }
      worker.onerror = (event) => {
        window.clearTimeout(quiet)
        reject(new Error(event.message || 'the letter model stopped'))
      }
      const request: AlignRequest = { samples, windows: grouped.filter((w) => w.words.length > 0), audioStart }
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
  /** With cleanSpeech: how many "um"s were heard - by the speech model, and
   *  by the letter model between its words - against how many were cut
   *  (`fillerWords`). The rest ran straight into a word and stayed. */
  fillersHeard?: { spoken: number; letters: number }
  /** Sounds with no speech in them that were cut or are worth a listen - see
   *  noiseCuts.ts. Absent when noise cutting was off. */
  checks?: CutCheck[]
  /** Said when noise cutting stopped itself. */
  noiseNote?: string
  /** The sound's loudness over the recording, 10 bars a second from 0 to 1,
   *  for drawing it under the cuts timeline. */
  peaks?: number[]
  /** Spoken in French (speechLanguage.ts); absent, English. */
  language?: 'fr'
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
    /** Told instead to a stretch the model got stuck on (the names alone). */
    fallbackPrompt?: string
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
    /** Tell English from French before listening (speechLanguage.ts); off,
     *  it is heard as English. */
    detectLanguage?: boolean
    onAnalyseProgress?: (fraction: number) => void
    onModelDownload?: (fraction: number) => void
    onTranscribeProgress?: (fraction: number) => void
  },
): Promise<CampaignPlan> {
  const wantWords = (options.cleanSpeech || options.listen) && isFillerWordDetectionSupported()
  let duration: number
  let levels: Level[]
  let mono16k: Float32Array | null
  // When the sound starts, in the video's own time (media/audio.ts).
  let audioStart = 0

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
      if (!(await audioTrack.canDecode())) {
        // A product clip whose sound this browser can't read is kept whole
        // too - the render plays such sound as silence (see clipParts).
        if (options.quietIsFine || options.keepWhole) return keptWhole(d, options.cleanSpeech)
        throw new SilenceCutError(UNREADABLE_FORMAT)
      }
      duration = d
      ;({ levels, mono16k, audioStart } = await decodeAudio(audioTrack, wantWords, d, options.onAnalyseProgress))
    } finally {
      input.dispose()
    }
  }

  // His voice, measured once (voiceProfile.ts): the line under his word
  // endings, no pause shorter than his natural gap - on his own talking only,
  // and only when this video sounds like him on that mic.
  const talking = options.listen && !options.keepWhole && !options.quietIsFine
  const voices = talking ? loadProfiles() : []
  const tuned = withProfile(settings, levels, voices, chosenVoice())
  const profile = tuned.profile
  settings = tuned.settings
  const silences = findSilentRanges(levels, settings)

  let fillerWords: Range[] = []
  let stutters: Range[] = []
  let words: WordChunk[] = []
  let spoken: WordChunk[] | undefined
  let aligned = false
  let fillersHeard: CampaignPlan['fillersHeard']
  let forRecheck: Float32Array | null = null
  let forUms: Float32Array | null = null
  // The words the letter model timed exactly: their ends are kept whole
  // (keepWordEnds) - the speech model's own ends are too rough for that.
  let exactWords: Range[] = []
  let audibleSec = duration
  // English, as always, unless the video is told to be French.
  let language: SpeechLanguage = 'en'
  if (wantWords && mono16k) {
    const audible = Math.min(duration, audioStart + mono16k.length / WHISPER_SAMPLE_RATE)
    audibleSec = audible
    const windows = speechWindows(silences, audible)
    if (options.detectLanguage && windows.length > 0) {
      try {
        const told = await detectLanguage(mono16k, WHISPER_SAMPLE_RATE, windows, { audioStart, onModelDownload: options.onModelDownload })
        language = told.language
        report({ page: 'campaign', kind: 'check', phase: 'language', message: `${told.language} (en ${told.en}, fr ${told.fr})` })
      } catch (error) {
        // Not told: heard as English, as before.
        report({ page: 'campaign', kind: 'fallback', phase: 'language', message: error instanceof Error ? error.message : String(error) })
      }
    }
    // The speech model's worker takes the samples; the letter model needs
    // them after it. The letter model knows English letters only: French
    // keeps the speech model's own times.
    const forAligning = options.align && language === 'en' ? mono16k.slice() : null
    // The model's second listen at the stretches that might be noise needs
    // the samples too, after the first listen has taken them.
    forRecheck = options.cutNoise && !options.keepWhole ? mono16k.slice() : null
    // The "um"s found by their sound are heard again on their own too.
    forUms = talking && options.align && !forRecheck ? mono16k.slice() : forRecheck
    const share = forAligning ? 0.85 : 1
    const listened = await transcribeOnDevice(mono16k, WHISPER_SAMPLE_RATE, windows, {
      // In French, the names alone: the "um" prompt is English words.
      prompt: language === 'fr' ? (options.fallbackPrompt ?? '') : options.prompt,
      fallbackPrompt: options.fallbackPrompt,
      padQuiet: true,
      audioStart,
      language,
      onModelDownload: options.onModelDownload,
      onProgress: (p) => options.onTranscribeProgress?.(p * share),
    })
    const heard = language === 'fr' ? frenchWords(listened) : listened
    ;({ words, fillerWords, stutters, spoken } = fromHeard(heard, levels, settings, duration, options.cleanSpeech))
    if (options.cleanSpeech) fillersHeard = { spoken: heard.filter((w) => isFillerWord(w.text)).length, letters: 0 }
    if (forAligning && heard.length > 0) {
      const align = (samples: Float32Array) =>
        alignWords(samples, windows, spokenWords(heard, 0), silences, audioStart, {
          onModelDownload: options.onModelDownload,
          onProgress: (p) => options.onTranscribeProgress?.(share + (1 - share) * p),
        })
      try {
        // The speech model's worker has only just been ended, and a phone
        // hands its memory back a moment later, not at once: the letter model
        // starting straight after it ran out of memory on both phones ("no
        // available backend found ... Out of memory"). So it waits a moment,
        // and has one more go if it still could not start for memory.
        const spare = forAligning.slice()
        await new Promise((resolve) => setTimeout(resolve, ALIGN_AFTER_MS))
        let timed: { words: TimedWord[]; fillers: HeardFiller[] }
        try {
          timed = await align(forAligning)
        } catch (error) {
          // Out of memory, or gone quiet - which on a phone is usually the
          // same thing: the worker was ended for its memory without a word.
          // One more go once the phone has had time to take memory back;
          // a word it times is a caption that lands on the word.
          report({ page: 'campaign', kind: 'retried', phase: 'aligning', message: error instanceof Error ? error.message : String(error) })
          await new Promise((resolve) => setTimeout(resolve, ALIGN_RETRY_MS))
          timed = await align(spare)
        }
        // A word the letter model could not time is still the speech
        // model's, and that late.
        const extraLate = HEARD_LATE_SEC - ALIGNED_LATE_SEC
        const evened = timed.words.map((w) => (w.aligned === false ? { ...w, start: w.start - extraLate, end: w.end - extraLate } : w))
        spoken = spokenWords(evened, ALIGNED_LATE_SEC)
        aligned = true
        exactWords = timed.words.filter((w) => w.aligned !== false && !isFillerWord(w.text) && w.end > w.start).map((w) => ({ start: w.start, end: w.end }))
        if (options.cleanSpeech) {
          // The cuts again from the exact times - an "um" placed to the frame
          // gets a corridor that is really between its neighbours - with the
          // "um"s the speech model left out but the letters heard, each a
          // word of its own for the cut to check against the sound.
          const fromLetters = timed.fillers
            .filter((f) => !spoken!.some((w) => f.start < w.end && f.end > w.start))
            .map((f) => ({ text: ' um', start: f.start, end: f.end }))
          // A heard "um" the letter model heard a real word in ("THE",
          // "ABOUT") was a word misheard as a filler: kept.
          const checked = spoken.map((w) => {
            const heardAs = timed.words.find((t) => t.start === w.start)?.letters
            return heardAs !== undefined && isFillerWord(w.text) && !soundsLikeFiller(heardAs) ? { ...w, keep: true } : w
          })
          fillersHeard = { spoken: checked.filter((w) => isFillerWord(w.text) && !w.keep).length, letters: fromLetters.length }
          ;({ fillerWords, stutters } = speechCuts([...checked, ...fromLetters].sort((a, b) => a.start - b.start), levels, settings, duration, true))
        }
      } catch (error) {
        // The speech model's own times, shifted, as before: rougher, but
        // the video is never held up for it.
        report({ page: 'campaign', kind: 'fallback', phase: 'aligning', message: error instanceof Error ? error.message : String(error) })
      }
    }
  }

  const peaks = peaksOf(levels, duration)
  if (fillersHeard && (fillersHeard.spoken > 0 || fillersHeard.letters > 0 || stutters.length > 0)) {
    report({ page: 'campaign', kind: 'check', phase: 'ums', message: fillersLine(fillersHeard, fillerWords.length, stutters.length, aligned) })
  }
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
  let keep = plainKeep(silences, fillerWords, stutters, duration, settings, audioExtent(levels))
  if (keep.length === 0 && options.quietIsFine) return { ...keptWhole(duration, options.cleanSpeech), words, peaks }
  // Nothing loud enough to be talking anywhere in it: a clip with no talking
  // (b-roll, a screen recording) or one recorded very far from the phone.
  // "Record somewhere quieter" was the wrong advice for both.
  if (keep.length === 0) {
    throw new SilenceCutError(
      "No talking could be heard in this video - it is silent or very quiet, so cutting the pauses would leave nothing. A clip with no talking goes in Batch; if you do talk in it, record closer to the phone.",
    )
  }

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
        const again = await transcribeOnDevice(
          forRecheck,
          WHISPER_SAMPLE_RATE,
          worth.map(({ c }) => ({ start: Math.max(0, c.range.start - 0.25), end: Math.min(audibleSec, c.range.end + 0.25) })),
          { prompt: language === 'fr' ? (options.fallbackPrompt ?? '') : options.prompt, padQuiet: true, audioStart, language, onModelDownload: options.onModelDownload },
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
  // "Um"s by their sound (umFind.ts): his voice held where no word is, heard
  // again on its own - a real word there stays. Each one cut is listed.
  let ums: Range[] = []
  if (talking && aligned && forUms && exactWords.length >= 2) {
    const found = findUms(
      [...exactWords].sort((a, b) => a.start - b.start),
      levels,
      { lineDb: silenceLineDb(levels, settings), speechDb: profile && tuned.used ? profile.speechDb : percentile(levels.map((l) => l.db).filter(Number.isFinite), 0.9), umDb: tuned.used ? profile?.umDb : undefined },
    ).filter((u) => keep.reduce((n, k) => n + Math.max(0, Math.min(k.end, u.end) - Math.max(k.start, u.start)), 0) > (u.end - u.start) / 2)
    if (found.length > 0) {
      try {
        const again = await transcribeOnDevice(
          forUms,
          WHISPER_SAMPLE_RATE,
          found.map((u) => ({ start: Math.max(0, u.start - 0.15), end: Math.min(audibleSec, u.end + 0.15) })),
          { prompt: options.prompt, padQuiet: true, audioStart, onModelDownload: options.onModelDownload },
        )
        ums = found.filter((u) => heardOnlyFiller(again.filter((w) => w.start < u.end && w.end > u.start), isFillerWord))
      } catch (error) {
        // Not heard again: nothing is known, so nothing is cut.
        report({ page: 'campaign', kind: 'fallback', phase: 'ums', message: error instanceof Error ? error.message : String(error) })
      }
      for (const u of ums) keep = cutOut(keep, u)
      checks = [...(checks ?? []), ...ums.map((u) => ({ start: u.start, end: u.end, kind: 'um' as const, cut: true }))]
    }
    report({
      page: 'campaign',
      kind: 'check',
      phase: 'ums',
      message: `${found.length} "um" found by sound, ${ums.length} cut, ${found.length - ums.length} kept (a word heard again); voice ${tuned.used ? `"${profile?.name ?? 'set up'}"` : voices.length > 0 ? 'none matching this mic' : 'not set up'}`,
    })
  }
  // Never the end of a word: a cut starts only once each word he says has
  // finished (his report, 2026-11-11: "it just cut off the end of my words").
  // In French, the speech model's own word ends - a little late, so they
  // keep a little more, never less.
  if (exactWords.length === 0 && language === 'fr' && spoken) {
    exactWords = spoken.filter((w) => !isFillerWord(w.text) && w.end > w.start).map((w) => ({ start: w.start, end: w.end + HEARD_LATE_SEC }))
  }
  if (exactWords.length > 0) keep = keepWordEnds(keep, exactWords, mergeRanges([...fillerWords, ...stutters, ...ums]), duration)
  return {
    keep,
    duration,
    words,
    ...(spoken ? { spoken, aligned } : {}),
    silences: silences.length,
    fillerWords: fillerWords.length,
    stutters: stutters.length,
    cleanSpeech: options.cleanSpeech,
    ...(fillersHeard ? { fillersHeard } : {}),
    peaks,
    ...(checks ? { checks } : {}),
    ...(noiseNote ? { noiseNote } : {}),
    ...(language === 'fr' ? { language } : {}),
  }
}

/** French as heard, made ready for captions: a "?" or "!" French writes
 *  after a space ("vrai ?") goes with its word, not on a caption of its own;
 *  and what the model makes up over silence (film subtitle credits) is
 *  dropped. */
export function frenchWords(heard: readonly WordChunk[]): WordChunk[] {
  const said = MADE_UP_FRENCH.test(heard.map((w) => w.text).join(' ')) ? dropMadeUp(heard) : [...heard]
  const out: WordChunk[] = []
  for (const w of said) {
    const previous = out[out.length - 1]
    if (previous && /^\s*[?!:;»%]+\s*$/.test(w.text)) {
      out[out.length - 1] = { ...previous, text: `${previous.text}\u00a0${w.text.trim()}`, end: Math.max(previous.end, w.end) }
    } else out.push(w)
  }
  return out
}

/** The sentences that are made-up phrases taken out, word for word; every
 *  other sentence kept as heard. A sentence ends on a word ending in . ! ?
 *  or … */
function dropMadeUp(heard: readonly WordChunk[]): WordChunk[] {
  const out: WordChunk[] = []
  let sentence: WordChunk[] = []
  const close = () => {
    if (!MADE_UP_FRENCH.test(sentence.map((w) => w.text).join(''))) out.push(...sentence)
    sentence = []
  }
  for (const w of heard) {
    sentence.push(w)
    if (/[.!?…]\s*$/.test(w.text)) close()
  }
  close()
  return out
}

/** How much past a word's exact end is kept: the last sound of a word ("s",
 *  "t", a breath out) fades below the silence line before it is over, and
 *  the letter model puts the end on the last letter's peak, not its tail. */
export const WORD_TAIL_SEC = 0.08

/** The kept parts with every word's end kept: a part that stops inside a
 *  word, or less than WORD_TAIL_SEC after it, runs on to that - never into
 *  the next part (they then join) or into an "um" or stumble being cut.
 *  Only words whose start is kept: a word cut on purpose stays cut. Words
 *  are exact times (the letter model's). His report, 2026-11-11: "it just
 *  cut off the end of my words" - the pauses had grown into the words'
 *  fading ends. */
export function keepWordEnds(keep: readonly Range[], words: readonly Range[], meantToCut: readonly Range[], duration: number, tail = WORD_TAIL_SEC): Range[] {
  const out = keep.map((r) => ({ ...r }))
  for (const word of words) {
    const i = out.findIndex((r) => word.start >= r.start - 0.01 && word.start < r.end)
    if (i < 0) continue
    const part = out[i]
    const want = Math.min(duration, word.end + tail)
    if (part.end >= want) continue
    const next = out[i + 1]?.start ?? duration
    const um = meantToCut.find((r) => r.start >= part.end - 0.001 && r.start < want)
    const end = Math.min(want, next, um ? um.start : Infinity)
    if (end > part.end) part.end = end
  }
  // Parts that now touch are one.
  const joined: Range[] = []
  for (const r of out) {
    const last = joined[joined.length - 1]
    if (last && r.start <= last.end + 1e-6) last.end = Math.max(last.end, r.end)
    else joined.push(r)
  }
  return joined
}

/** One line for the report: what was heard and what was cut. */
export function fillersLine(heard: { spoken: number; letters: number }, cut: number, stutters: number, aligned: boolean): string {
  const total = heard.spoken + heard.letters
  const by = heard.letters > 0 ? ` (${heard.spoken} by the speech model, ${heard.letters} by the letters)` : ''
  return `${total} "um" heard${by}, ${cut} cut, ${Math.max(0, total - cut)} left in; ${stutters} stumble cut; ${aligned ? 'exact times' : 'rough times'}`
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
  if (cleanSpeech) ({ fillerWords, stutters } = speechCuts(words, levels, settings, duration))
  // Starts pulled onto the moment his voice starts, for the logo and the
  // pictures. After the "um"s are found, so what is cut never moves.
  words = snapToOnsets(words, levels, settings.thresholdDb)
  // The captions' own timing, straight from what was heard: the shift the
  // cut's alignment finds moves some takes the wrong way for a caption.
  return { words, fillerWords, stutters, spoken: spokenWords(heard) }
}

/** The "um"s and stumbles to cut, from timed words - the speech model's
 *  (fromHeard) or, better, the letter model's exact ones - each checked
 *  against the sound (fillerWords.ts) and padded like a pause. */
export function speechCuts(words: WordChunk[], levels: Level[], settings: SilenceSettings, duration: number, exact = false): { fillerWords: Range[]; stutters: Range[] } {
  // Never widened right to 0: a cut starting exactly at 0 reads as the head
  // silence to keepRanges, which keeps a breath there instead.
  const uncramp = (range: Range) => ({
    start: Math.max(0.011, range.start - settings.paddingSec),
    end: Math.min(duration, range.end + settings.paddingSec),
  })
  // What counts as quiet for the "um" checks: this take's own line between
  // a pause and speech (silenceLineDb), the one the pauses are found with -
  // never above the slider's number. In a quiet take the words sit under
  // that number (-35 to -39 dB on a real one), and judged by it a word
  // looked like silence: the check that refuses a cut holding more sound
  // than the "um" could make did not see a quiet word inside the cut, and
  // took it out with the "um". The line only ever makes the check stricter.
  const cutOptions = { guardSec: 0.04, quietBelowDb: silenceLineDb(levels, settings), exact }
  return {
    fillerWords: fillerWordRanges(words, levels, cutOptions).map(uncramp),
    stutters: stutterRanges(words, levels, cutOptions).map(uncramp),
  }
}

/** Whether the letters the letter model heard over a word the speech model
 *  wrote as "um"/"uh" are a filler's: vowels, H, M, N, R and nothing else
 *  ("UM", "AH", "UHM", "" when it heard nothing in particular). "THE" or
 *  "ABOUT" is a word the speech model misheard. */
export function soundsLikeFiller(letters: string): boolean {
  return /^[AUEOHMNR]*$/.test(letters)
}

/** What is kept: everything but the pauses, "um"s and stumbles, padded. This
 *  is the whole cut when noise cutting is off. */
export function plainKeep(
  silences: Range[],
  fillerWords: Range[],
  stutters: Range[],
  duration: number,
  settings: SilenceSettings,
  /** Where the sound really runs (media/audio.ts audioExtent): a track that
   *  starts late or ends early is head or tail silence, not a middle pause. */
  audio?: { start: number; end: number },
): Range[] {
  return keepRanges(mergeRanges([...silences, ...fillerWords, ...stutters]), duration, settings.paddingSec, audio)
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
  const moved = <T extends { start: number; end: number }>(items: T[], by: number): T[] => movedInto(items, by, duration)
  const everySpoken = plans.every((p) => p.spoken)
  return {
    keep: joinedRanges(plans.map((p) => p.keep), offsets, duration),
    duration,
    silences: plans.reduce((sum, p) => sum + p.silences, 0),
    fillerWords: plans.reduce((sum, p) => sum + p.fillerWords, 0),
    stutters: plans.reduce((sum, p) => sum + p.stutters, 0),
    words: plans.flatMap((p, i) => moved(p.words, offsets[i])),
    ...(everySpoken ? { spoken: plans.flatMap((p, i) => moved(p.spoken!, offsets[i])) } : {}),
    ...(plans.every((p) => p.aligned) ? { aligned: true } : {}),
    ...(plans.some((p) => p.checks) ? { checks: plans.flatMap((p, i) => moved(p.checks ?? [], offsets[i])) } : {}),
    cleanSpeech: plans[0]?.cleanSpeech ?? false,
    ...(plans.some((p) => p.fillersHeard)
      ? {
          fillersHeard: {
            spoken: plans.reduce((n, p) => n + (p.fillersHeard?.spoken ?? 0), 0),
            letters: plans.reduce((n, p) => n + (p.fillersHeard?.letters ?? 0), 0),
          },
        }
      : {}),
  }
}

/** Items moved by `by` seconds and kept inside the joined video. */
function movedInto<T extends { start: number; end: number }>(items: T[], by: number, duration: number): T[] {
  const inside = (t: number) => Math.min(duration, Math.max(0, t + by))
  return items.map((item) => ({ ...item, start: inside(item.start), end: inside(item.end) }))
}

/** The parts' kept ranges on the joined video, in order and never
 *  overlapping: a part whose own first frame is not at 0 (an export with an
 *  edit list) gives an offset that would start its ranges before 0, or a
 *  frame or two inside the part before - and the render would then repeat
 *  that sliver and place its words twice. */
function joinedRanges(ranges: Range[][], offsets: number[], duration: number): Range[] {
  const out: Range[] = []
  let last = 0
  for (const range of ranges.flatMap((part, i) => movedInto(part, offsets[i], duration))) {
    const start = Math.max(range.start, last)
    if (range.end > start) {
      out.push({ start, end: range.end })
      last = range.end
    }
  }
  return out
}

/** The caption fixes made on each part, moved onto the joined video, so
 *  joining never throws away a check he already did. A part never opened
 *  contributes its words as heard, as the review would have shown them.
 *  Nothing, when no part was checked. */
export function joinCaptions(
  parts: { captions?: CaptionWord[]; plan: CampaignPlan }[],
  offsets: number[],
  duration: number,
): CaptionWord[] | undefined {
  if (!parts.some((p) => p.captions)) return undefined
  return parts.flatMap((p, i) => movedInto(p.captions ?? captionWords(p.plan.spoken ?? p.plan.words, p.plan.keep), offsets[i], duration))
}
