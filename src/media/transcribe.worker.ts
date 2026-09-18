// Runs the speech model, in a worker of its own, so all of its memory can be
// handed back by ending the worker. Nothing short of that frees it: a
// WebAssembly heap only ever grows, and `pipeline.dispose()` releases nothing
// the phone can reuse. Measured in WebKit with a real 51s take, the model
// kept ~2 GB after dispose on the page, and 32 MB once its worker was ended.

import { env, pipeline } from '@huggingface/transformers'

import type { WordChunk } from './fillerWords'
import type { Range } from './silenceMath'

export interface TranscribeRequest {
  samples: Float32Array
  sampleRate: number
  windows: Range[]
}

export type TranscribeMessage =
  | { type: 'download'; fraction: number }
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

// The plain WebAssembly build of the model runtime. The library defaults to
// its "asyncify" build, which exists to support WebGPU; nothing here uses
// WebGPU, and the plain build loaded in about half the memory (~630 MB
// against ~1150 MB).
const ortVersion = env.backends.onnx.versions?.web
if (ortVersion && env.backends.onnx.wasm) {
  const base = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ortVersion}/dist/`
  env.backends.onnx.wasm.wasmPaths = {
    mjs: `${base}ort-wasm-simd-threaded.mjs`,
    wasm: `${base}ort-wasm-simd-threaded.wasm`,
  }
}

/** Mirrors the library's own (unexported) `Chunk` shape. */
interface TimestampedChunk {
  text: string
  timestamp: [number | null, number | null]
}

const post = (message: TranscribeMessage) => self.postMessage(message)

self.onmessage = async (event: MessageEvent<TranscribeRequest>) => {
  const { samples, sampleRate, windows } = event.data
  try {
    const transcriber = await pipeline('automatic-speech-recognition', MODEL_ID, {
      progress_callback: (data: { status: string; progress?: number }) => {
        if (data.status === 'progress' && typeof data.progress === 'number') {
          post({ type: 'download', fraction: data.progress / 100 })
        }
      },
    })
    post({ type: 'loaded' })

    const words: WordChunk[] = []
    for (let i = 0; i < windows.length; i++) {
      const { start, end } = windows[i]
      const slice = samples.subarray(Math.floor(start * sampleRate), Math.ceil(end * sampleRate))
      // Given nothing to hear, the model invents a word ("you") rather than
      // returning nothing - so it is never given nothing.
      if (slice.length < MIN_WINDOW_SEC * sampleRate) {
        post({ type: 'progress', fraction: (i + 1) / windows.length })
        continue
      }
      const result = await transcriber(slice, { return_timestamps: 'word' })
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
