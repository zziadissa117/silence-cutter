// The campaign section's own copy of the speech model's worker. It is the
// plain cutter's (media/transcribe.worker.ts) - same model, same memory
// measures, same windows - with one addition: it can be told the brand's
// name before it listens. That copy is left exactly as it is; see
// campaign/keywords.ts for why the name matters so much.

import { env, pipeline } from '@huggingface/transformers'

import type { WordChunk } from '../media/fillerWords'
import type { Range } from '../media/silenceMath'

export interface TranscribeRequest {
  samples: Float32Array
  sampleRate: number
  windows: Range[]
  /** Text the model takes as having come just before, e.g. "Vertus." Empty
   *  for none. */
  prompt: string
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

interface TimestampedChunk {
  text: string
  timestamp: [number | null, number | null]
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
  const { samples, sampleRate, windows, prompt } = event.data
  try {
    const transcriber = await pipeline('automatic-speech-recognition', MODEL_ID, {
      progress_callback: (data: { status: string; progress?: number }) => {
        if (data.status === 'progress' && typeof data.progress === 'number') {
          post({ type: 'download', fraction: data.progress / 100 })
        }
      },
    })
    post({ type: 'loaded' })
    const primed = promptIds(transcriber.tokenizer as unknown as Tokens, prompt)

    const words: WordChunk[] = []
    for (let i = 0; i < windows.length; i++) {
      const { start, end } = windows[i]
      const slice = samples.subarray(Math.floor(start * sampleRate), Math.ceil(end * sampleRate))
      if (slice.length < MIN_WINDOW_SEC * sampleRate) {
        post({ type: 'progress', fraction: (i + 1) / windows.length })
        continue
      }
      const result = await transcriber(slice, {
        return_timestamps: 'word',
        ...(primed ? { decoder_input_ids: primed } : {}),
      } as Parameters<typeof transcriber>[1])
      const output = Array.isArray(result) ? result[0] : result
      for (const chunk of (output.chunks ?? []) as TimestampedChunk[]) {
        const [from, to] = chunk.timestamp
        if (from == null || to == null) continue
        words.push({ text: chunk.text, start: start + from, end: start + to })
      }
      post({ type: 'progress', fraction: (i + 1) / windows.length })
      if (i < windows.length - 1) await new Promise((r) => setTimeout(r, PAUSE_BETWEEN_WINDOWS_MS))
    }
    post({ type: 'done', words })
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
