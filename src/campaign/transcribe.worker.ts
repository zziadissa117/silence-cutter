// The campaign section's own copy of the speech model's worker. It is the
// plain cutter's (media/transcribe.worker.ts) - same model, same memory
// measures, same windows - with one addition: it can be told the brand's
// name before it listens, and each stretch is heard with a little quiet
// either side (timedWords.ts padWithQuiet). That copy is left exactly as it
// is; see campaign/keywords.ts for why the name matters so much.

import { env, pipeline } from '@huggingface/transformers'

import type { WordChunk } from '../media/fillerWords'
import type { Range } from '../media/silenceMath'
import { QUIET_PAD_SEC, keepInWindow, padWithQuiet, stuckOn, timedWords, unstuck, type TimestampedChunk } from './timedWords'

export interface TranscribeRequest {
  samples: Float32Array
  sampleRate: number
  windows: Range[]
  /** Text the model takes as having come just before, e.g. "Vertus." Empty
   *  for none. */
  prompt: string
  /** Told instead when a stretch comes back with the model stuck on a
   *  phrase (timedWords.stuckOn) - the names alone, without the fillers.
   *  Absent: the stretch is heard again with no prompt at all. */
  fallbackPrompt?: string
}

export type TranscribeMessage =
  | { type: 'download'; fraction: number }
  | { type: 'loaded' }
  | { type: 'progress'; fraction: number }
  | { type: 'done'; words: WordChunk[] }
  | { type: 'error'; message: string }

/** tiny.en, for memory - see the plain worker for the measurements. */
const MODEL_ID = 'Xenova/whisper-tiny.en'
const PAUSE_BETWEEN_WINDOWS_MS = 400
const MIN_WINDOW_SEC = 0.1

const ortVersion = env.backends.onnx.versions?.web
if (ortVersion && env.backends.onnx.wasm) {
  const base = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ortVersion}/dist/`
  env.backends.onnx.wasm.wasmPaths = {
    mjs: `${base}ort-wasm-simd-threaded.mjs`,
    wasm: `${base}ort-wasm-simd-threaded.wasm`,
  }
}


interface Tokens {
  encode(text: string, options: { add_special_tokens: boolean }): number[]
  convert_tokens_to_ids?(tokens: string[]): number[]
}

/** Whisper's way of being told what came before: <|startofprev|>, the text,
 *  then <|startoftranscript|> to begin. Null - and the model listens with no
 *  prompt, exactly as the plain cutter's does - if any of it can't be built,
 *  so a surprise in the library costs the prompt, never the transcription. */
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
  const { samples, sampleRate, windows, prompt, fallbackPrompt = '' } = event.data
  try {
    const transcriber = await pipeline('automatic-speech-recognition', MODEL_ID, {
      progress_callback: (data: { status: string; progress?: number }) => {
        if (data.status === 'progress' && typeof data.progress === 'number') {
          post({ type: 'download', fraction: data.progress / 100 })
        }
      },
    })
    post({ type: 'loaded' })
    const tokenizer = transcriber.tokenizer as unknown as Tokens
    const primed = promptIds(tokenizer, prompt)
    const fallback = promptIds(tokenizer, fallbackPrompt)

    const hear = async (heardSlice: Float32Array, start: number, length: number, ids: number[] | null) => {
      const result = await transcriber(heardSlice, {
        return_timestamps: 'word',
        ...(ids ? { decoder_input_ids: ids } : {}),
      } as Parameters<typeof transcriber>[1])
      const output = Array.isArray(result) ? result[0] : result
      const timed = timedWords((output.chunks ?? []) as TimestampedChunk[], start - QUIET_PAD_SEC, heardSlice.length / sampleRate)
      return keepInWindow(timed, start, start + length)
    }

    const words: WordChunk[] = []
    for (let i = 0; i < windows.length; i++) {
      const { start, end } = windows[i]
      const slice = samples.subarray(Math.floor(start * sampleRate), Math.ceil(end * sampleRate))
      if (slice.length < MIN_WINDOW_SEC * sampleRate) {
        post({ type: 'progress', fraction: (i + 1) / windows.length })
        continue
      }
      const heardSlice = padWithQuiet(slice, sampleRate)
      const length = slice.length / sampleRate
      let heard = await hear(heardSlice, start, length, primed)
      // Stuck on a phrase ("okay, okay, okay, ..."): once more with less of
      // a prompt, and failing that the loop is folded (timedWords.unstuck).
      if (stuckOn(heard.map((w) => w.text)) && primed) {
        const again = await hear(heardSlice, start, length, fallback)
        heard = stuckOn(again.map((w) => w.text)) ? unstuck(again.length < heard.length ? again : heard) : again
      } else if (stuckOn(heard.map((w) => w.text))) heard = unstuck(heard)
      words.push(...heard)
      post({ type: 'progress', fraction: (i + 1) / windows.length })
      if (i < windows.length - 1) await new Promise((r) => setTimeout(r, PAUSE_BETWEEN_WINDOWS_MS))
    }
    post({ type: 'done', words })
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
