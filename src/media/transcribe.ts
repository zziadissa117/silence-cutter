import type { WordChunk } from './fillerWords'
import { SilenceCutError } from './errors'
import type { Range } from './silenceMath'
import type { TranscribeMessage, TranscribeRequest } from './transcribe.worker'
import { FRENCH_MODELS, speechSample, type SpeechLanguage } from './speechLanguage'

/** How long the speech model may go without a word - no download progress,
 *  no window finished - before it is given up on. Loading the model after
 *  its download says nothing for a while on a slow phone, so this is long. */
const QUIET_MS = 120_000

/** Fetching the model failed, which is a connection, not the video. */
const NO_CONNECTION = /failed to fetch|load failed|networkerror|network error|net::|fetch/i

export interface TranscribeOptions {
  /** Text the model takes as having come just before - the brand's name, so
   *  it writes it the way it was typed. Empty for none. */
  prompt?: string
  /** Told instead to a stretch the model got stuck on (the names alone). */
  fallbackPrompt?: string
  /** Hear each stretch with quiet either side and fold a loop - see
   *  transcribe.worker.ts. */
  padQuiet?: boolean
  /** The time `samples[0]` sits at in the video; a phone's sound can start a
   *  little before zero. The windows are in the video's time. */
  audioStart?: number
  /** The language he speaks; English (the default) as it always was. */
  language?: SpeechLanguage
  /** French: told which model heard it (for the reports). */
  onFrenchModel?: (model: string) => void
  onModelDownload?: (f: number) => void
  onProgress?: (f: number) => void
}

/** Hears every word in `windows` of `samples` and returns them with their
 *  timings, running the model in a worker that is ended as soon as it is done
 *  - see transcribe.worker.ts for why that is the only way its memory comes
 *  back. `samples` is handed over to the worker and unusable here after. */
export async function transcribeOnDevice(
  samples: Float32Array,
  sampleRate: number,
  windows: Range[],
  { prompt = '', fallbackPrompt = '', padQuiet = false, audioStart = 0, language, onFrenchModel, onModelDownload, onProgress }: TranscribeOptions = {},
): Promise<WordChunk[]> {
  if (windows.length === 0) return []
  const request: TranscribeRequest = { samples, sampleRate, windows, prompt, fallbackPrompt, padQuiet, audioStart, ...(language && language !== 'en' ? { language } : {}) }
  const done = (message: TranscribeMessage) => (message.type === 'done' ? message.words : undefined)
  if (language !== 'fr') return askWorker(request, done, { onModelDownload, onProgress })
  // French: the biggest model this phone can hold, stepping down when it
  // can't (out of memory, or the page died last time while it listened).
  for (let step = frenchStep(); ; step++) {
    const last = step >= FRENCH_MODELS.length - 1
    // A copy for the next model if this one fails: the worker takes these.
    const spare = last ? null : samples.slice()
    trying(step)
    try {
      const words = await askWorker({ ...request, samples, model: FRENCH_MODELS[step] }, done, { onModelDownload, onProgress })
      trying(null)
      onFrenchModel?.(FRENCH_MODELS[step])
      return words
    } catch (error) {
      trying(null)
      if (last || !spare || !TOO_BIG.test(error instanceof Error ? error.message : String(error))) throw error
      keepFrenchStep(step + 1)
      samples = spare
    }
  }
}

/** What a phone says when a model was too much for it: out of memory, or
 *  the worker ended without a word. */
const TOO_BIG = /memory|stopped|allocation|out of bounds|couldn't start|stopped answering/i
const STEP_KEY = 'speech.frenchStep'
const TRYING_KEY = 'speech.frenchTrying'

/** Which of FRENCH_MODELS this phone hears French with. A listen that was
 *  going when the page died - not closed by him, it never said goodbye -
 *  was too big for it: the next one down from then on. */
export function frenchStep(): number {
  try {
    let step = Number(localStorage.getItem(STEP_KEY)) || 0
    const died = localStorage.getItem(TRYING_KEY)
    if (died !== null) {
      step = Math.max(step, Number(died) + 1)
      localStorage.removeItem(TRYING_KEY)
      keepFrenchStep(step)
    }
    return Math.min(FRENCH_MODELS.length - 1, Math.max(0, step))
  } catch {
    return FRENCH_MODELS.length - 1
  }
}

function keepFrenchStep(step: number): void {
  try {
    localStorage.setItem(STEP_KEY, String(Math.min(FRENCH_MODELS.length - 1, step)))
  } catch {
    // The smallest is used when nothing can be kept.
  }
}

/** Marks a French listen going on with `step` (null: over). The page going
 *  away on purpose - he closed it or switched apps - clears it: only a page
 *  the phone ended for its memory leaves it behind. */
function trying(step: number | null): void {
  try {
    if (step === null) localStorage.removeItem(TRYING_KEY)
    else localStorage.setItem(TRYING_KEY, String(step))
  } catch {
    // Not marked: a crash isn't learned from, nothing else changes.
  }
}
if (typeof window !== 'undefined') {
  const left = () => trying(null)
  window.addEventListener('pagehide', left)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') left()
  })
}

/** The language he speaks in `windows` of `samples` - English or French -
 *  told from up to 30 s of it by the multilingual model, in a worker of its
 *  own (speechLanguage.ts). `samples` stay usable: a copy is sent. */
export async function detectLanguage(
  samples: Float32Array,
  sampleRate: number,
  windows: Range[],
  { audioStart = 0, onModelDownload }: Pick<TranscribeOptions, 'audioStart' | 'onModelDownload'> = {},
): Promise<{ language: SpeechLanguage; en: number; fr: number }> {
  const heard = speechSample(samples, sampleRate, windows, audioStart)
  if (heard.length < sampleRate) return { language: 'en', en: 1, fr: 0 }
  const request: TranscribeRequest = { samples: heard, sampleRate, windows: [], detect: true }
  return askWorker(request, (message) => (message.type === 'language' ? { language: message.language, en: message.en, fr: message.fr } : undefined), { onModelDownload })
}

/** One request to a speech worker of its own, ended as soon as it answers. */
async function askWorker<T>(
  request: TranscribeRequest,
  answer: (message: TranscribeMessage) => T | undefined,
  { onModelDownload, onProgress }: Pick<TranscribeOptions, 'onModelDownload' | 'onProgress'>,
): Promise<T> {
  const worker = new Worker(new URL('./transcribe.worker.ts', import.meta.url), { type: 'module' })
  let quiet: ReturnType<typeof setTimeout> | undefined
  try {
    return await new Promise<T>((resolve, reject) => {
      let started = false
      let downloaded = 0
      // A model fetch that stalls, a runtime that wedges, or a worker the
      // phone ends without a word would otherwise leave the row frozen at a
      // percentage for ever, and the queue behind it.
      const stillThere = () => {
        clearTimeout(quiet)
        quiet = setTimeout(
          () =>
            reject(
              new SilenceCutError(
                'The speech model stopped answering. Check the connection, or turn off "um"s and captions for this video.',
              ),
            ),
          QUIET_MS,
        )
      }
      stillThere()
      worker.onmessage = (event: MessageEvent<TranscribeMessage>) => {
        started = true
        stillThere()
        const message = event.data
        if (message.type === 'download') {
          downloaded = message.fraction
          onModelDownload?.(downloaded)
        } else if (message.type === 'alive') {
          // Still loading: the page's own stall watch hears it as movement.
          onModelDownload?.(downloaded)
        } else if (message.type === 'loaded') onProgress?.(0)
        else if (message.type === 'progress') onProgress?.(message.fraction)
        else if (message.type !== 'error') {
          const value = answer(message)
          if (value !== undefined) resolve(value)
        } else if (NO_CONNECTION.test(message.message)) {
          reject(
            new SilenceCutError(
              'The speech model has to be downloaded once (about 40 MB, or 250 MB the first time a French video is heard). Connect to the internet and try again, or turn off "um"s and captions.',
            ),
          )
        } else reject(new Error(`the speech model failed: ${message.message}`))
      }
      worker.onerror = (event) => {
        // Failing before saying anything almost always means its file could
        // not be loaded: a page left open across an update still asks for the
        // old version's file, which is gone.
        reject(
          started
            ? new Error(`the speech model stopped: ${event.message || 'no reason given'}`)
            : new SilenceCutError(
                "The speech model couldn't start. Close this page and open it again - it has probably been updated since it was opened.",
              ),
        )
      }
      worker.postMessage(request, [request.samples.buffer])
    })
  } finally {
    clearTimeout(quiet)
    worker.terminate()
  }
}
