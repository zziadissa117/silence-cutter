// Runs the speech model, in a worker of its own, so all of its memory can be
// handed back by ending the worker. Nothing short of that frees it: a
// WebAssembly heap only ever grows, and `pipeline.dispose()` releases nothing
// the phone can reuse. Measured in WebKit with a real 51s take, the model
// kept ~2 GB after dispose on the page, and 32 MB once its worker was ended.
//
// The one worker for both pages. The campaign page tells it the brand's
// names before it listens (see campaign/keywords.ts for why the name matters
// so much) and asks for each stretch to be heard with quiet either side and
// a loop folded (campaign/timedWords.ts); the plain cutter sends neither and
// gets exactly the plain model it always had.

import { pipeline } from '@huggingface/transformers'

import { QUIET_PAD_SEC, addHeard, keepInWindow, padWithQuiet, stuckOn, timedWords, unstuck, type TimestampedChunk } from '../campaign/timedWords'
import { pointRuntimeAtCdn } from './ort'

import type { WordChunk } from './fillerWords'
import type { Range } from './silenceMath'

export interface TranscribeRequest {
  samples: Float32Array
  sampleRate: number
  windows: Range[]
  /** Text the model takes as having come just before, e.g. "Vertus." Empty
   *  for none. */
  prompt?: string
  /** Told instead when a stretch comes back with the model stuck on a
   *  phrase (timedWords.stuckOn) - the names alone, without the fillers.
   *  Absent: the stretch is heard again with no prompt at all. */
  fallbackPrompt?: string
  /** Hear each stretch with half a second of quiet either side, and fold a
   *  loop the model gets stuck in - the campaign page's way; see
   *  campaign/timedWords.ts. Off, the model's words come back as they are. */
  padQuiet?: boolean
  /** The time `samples[0]` sits at in the video. Windows are in the video's
   *  time, so a window's first sample is (start - audioStart) in. */
  audioStart?: number
}

export type TranscribeMessage =
  | { type: 'download'; fraction: number }
  /** Still loading, with nothing to measure - said every so often. */
  | { type: 'alive' }
  | { type: 'loaded' }
  | { type: 'progress'; fraction: number }
  | { type: 'done'; words: WordChunk[] }
  | { type: 'error'; message: string }

/** tiny.en, not base.en, and only because of memory. With base.en a 51s take
 *  pushed the page past 3 GB, and even with everything else here still peaked
 *  around 2 GB - well past what an iPhone lets a tab have, which is why ticking
 *  either speech option reloaded the page on his phone. tiny.en with the
 *  same setup peaked around 1.2 GB.
 *
 *  The cost is timing: tiny places words less precisely, and once put an "um"
 *  300ms from where it was said. fillerWords.ts checks every cut against the
 *  loudness curve before making it for exactly that reason. */
const MODEL_ID = 'Xenova/whisper-tiny.en'

/** A moment between windows for the browser to clear away what the last one
 *  left behind. Without it the leftovers pile up faster than they are freed. */
const PAUSE_BETWEEN_WINDOWS_MS = 400

/** Too short to hold a word. */
const MIN_WINDOW_SEC = 0.1

pointRuntimeAtCdn()

interface Tokens {
  encode(text: string, options: { add_special_tokens: boolean }): number[]
  convert_tokens_to_ids?(tokens: string[]): number[]
}

/** Whisper's way of being told what came before: <|startofprev|>, the text,
 *  then <|startoftranscript|> to begin. Null - and the model listens with no
 *  prompt - if any of it can't be built, so a surprise in the library costs
 *  the prompt, never the transcription. */
function promptIds(tokenizer: Tokens, prompt: string): number[] | null {
  if (!prompt.trim()) return null
  try {
    const special = (token: string) =>
      tokenizer.convert_tokens_to_ids
        ? tokenizer.convert_tokens_to_ids([token])[0]
        : tokenizer.encode(token, { add_special_tokens: false })[0]
    const previous = special('<|startofprev|>')
    const start = special('<|startoftranscript|>')
    const text = tokenizer.encode(` ${prompt.trim()}`, { add_special_tokens: false })
    if (![previous, start, ...text].every((id) => Number.isInteger(id))) return null
    return [previous, ...text, start]
  } catch {
    return null
  }
}

const post = (message: TranscribeMessage) => self.postMessage(message)

self.onmessage = async (event: MessageEvent<TranscribeRequest>) => {
  const { samples, sampleRate, windows, prompt = '', fallbackPrompt = '', padQuiet = false, audioStart = 0 } = event.data
  try {
    // Said to be alive while the runtime and model load: fetching the
    // runtime's own files reports no progress, and on a slow connection
    // takes a minute or more - silence that long read as a stall, and the
    // first-ever listen on a phone was given up on and started over. Not for
    // ever, so a load that really is stuck is still given up on.
    const loadStarted = Date.now()
    const alive = setInterval(() => {
      if (Date.now() - loadStarted < 10 * 60_000) post({ type: 'alive' })
      else clearInterval(alive)
    }, 15_000)
    const transcriber = await pipeline('automatic-speech-recognition', MODEL_ID, {
      progress_callback: (data: { status: string; progress?: number }) => {
        if (data.status === 'progress' && typeof data.progress === 'number') {
          post({ type: 'download', fraction: data.progress / 100 })
        }
      },
    }).finally(() => clearInterval(alive))
    post({ type: 'loaded' })
    const tokenizer = transcriber.tokenizer as unknown as Tokens
    const primed = promptIds(tokenizer, prompt)
    const fallback = promptIds(tokenizer, fallbackPrompt)

    /** What the model heard in `audio`, which starts at `offset` in the
     *  video's time, as words on the video's timeline. */
    const hear = async (audio: Float32Array, offset: number, ids: number[] | null): Promise<WordChunk[]> => {
      const result = await transcriber(audio, {
        return_timestamps: 'word',
        ...(ids ? { decoder_input_ids: ids } : {}),
      } as Parameters<typeof transcriber>[1])
      const output = Array.isArray(result) ? result[0] : result
      return timedWords((output.chunks ?? []) as TimestampedChunk[], offset, audio.length / sampleRate)
    }

    // Window by window, the word heard by two neighbours kept once (addHeard).
    let words: WordChunk[] = []
    for (let i = 0; i < windows.length; i++) {
      const { start, end } = windows[i]
      const from = Math.max(0, Math.floor((start - audioStart) * sampleRate))
      const to = Math.max(from, Math.ceil((end - audioStart) * sampleRate))
      const slice = samples.subarray(from, to)
      // Given nothing to hear, the model invents a word ("you") rather than
      // returning nothing - so it is never given nothing.
      if (slice.length < MIN_WINDOW_SEC * sampleRate) {
        post({ type: 'progress', fraction: (i + 1) / windows.length })
        continue
      }
      // Times come back relative to the slice; the slice starts where the
      // window does, in the video's time.
      const sliceStart = audioStart + from / sampleRate
      if (padQuiet) {
        const heardSlice = padWithQuiet(slice, sampleRate)
        const length = slice.length / sampleRate
        const inWindow = (heard: WordChunk[]) => keepInWindow(heard, sliceStart, sliceStart + length)
        let heard = inWindow(await hear(heardSlice, sliceStart - QUIET_PAD_SEC, primed))
        // Stuck on a phrase ("okay, okay, okay, ..."): once more with less of
        // a prompt, and failing that the loop is folded (timedWords.unstuck).
        if (stuckOn(heard.map((w) => w.text)) && primed) {
          const again = inWindow(await hear(heardSlice, sliceStart - QUIET_PAD_SEC, fallback))
          heard = stuckOn(again.map((w) => w.text)) ? unstuck(again.length < heard.length ? again : heard) : again
        } else if (stuckOn(heard.map((w) => w.text))) heard = unstuck(heard)
        words = addHeard(words, heard)
      } else {
        const result = await transcriber(slice, {
          return_timestamps: 'word',
          ...(primed ? { decoder_input_ids: primed } : {}),
        } as Parameters<typeof transcriber>[1])
        const output = Array.isArray(result) ? result[0] : result
        const heard: WordChunk[] = []
        for (const chunk of (output.chunks ?? []) as TimestampedChunk[]) {
          const [a, b] = chunk.timestamp
          if (a == null || b == null) continue
          heard.push({ text: chunk.text, start: sliceStart + a, end: sliceStart + b })
        }
        words = addHeard(words, heard)
      }
      post({ type: 'progress', fraction: (i + 1) / windows.length })
      if (i < windows.length - 1) await new Promise((r) => setTimeout(r, PAUSE_BETWEEN_WINDOWS_MS))
    }
    post({ type: 'done', words })
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
