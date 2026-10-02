// Runs the letter model that times each heard word exactly - see align.ts.
//
// A worker of its own, started after the speech model's has been ended, for
// the same reason that one is: ending the worker is the only thing that gives
// a phone its memory back, and the two models never need to be in memory at
// once. The quantized model is about 95 MB, downloaded once and kept.

import { AutoModelForCTC, AutoProcessor, env } from '@huggingface/transformers'

import { forceAlign, logSoftmax, placeWords, spellForAlignment, type TimedWord } from './align'

export interface AlignRequest {
  /** 16 kHz mono. */
  samples: Float32Array
  /** Each stretch the speech model listened to, with the words it heard in
   *  it, on the video's timeline. */
  windows: { start: number; end: number; words: TimedWord[] }[]
}

export type AlignMessage =
  | { type: 'download'; fraction: number }
  | { type: 'progress'; fraction: number }
  | { type: 'done'; words: TimedWord[] }
  | { type: 'error'; message: string }

const MODEL_ID = 'Xenova/wav2vec2-base-960h'
const SAMPLE_RATE = 16000

const ortVersion = env.backends.onnx.versions?.web
if (ortVersion && env.backends.onnx.wasm) {
  const base = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ortVersion}/dist/`
  env.backends.onnx.wasm.wasmPaths = {
    mjs: `${base}ort-wasm-simd-threaded.mjs`,
    wasm: `${base}ort-wasm-simd-threaded.wasm`,
  }
}

const post = (message: AlignMessage) => self.postMessage(message)

interface Logits {
  dims: number[]
  data: Float32Array
}

self.onmessage = async (event: MessageEvent<AlignRequest>) => {
  const { samples, windows } = event.data
  try {
    const progress_callback = (data: { status: string; progress?: number }) => {
      if (data.status === 'progress' && typeof data.progress === 'number') post({ type: 'download', fraction: data.progress / 100 })
    }
    const processor = await AutoProcessor.from_pretrained(MODEL_ID, { progress_callback })
    const model = await AutoModelForCTC.from_pretrained(MODEL_ID, { dtype: 'q8', progress_callback })
    const words: TimedWord[] = []
    for (let i = 0; i < windows.length; i++) {
      const { start, end, words: heard } = windows[i]
      const slice = samples.subarray(Math.floor(start * SAMPLE_RATE), Math.ceil(end * SAMPLE_RATE))
      if (heard.length > 0 && slice.length >= SAMPLE_RATE / 10) {
        const inputs = await processor(slice)
        const { logits } = (await model(inputs)) as { logits: Logits }
        const [, frames, letters] = logits.dims
        const logProbs = logSoftmax(new Float32Array(logits.data), frames, letters)
        const spans = forceAlign(logProbs, frames, letters, heard.map((w) => spellForAlignment(w.text)))
        words.push(...placeWords(heard, spans, slice.length / SAMPLE_RATE / frames, start))
      } else words.push(...heard)
      post({ type: 'progress', fraction: (i + 1) / windows.length })
    }
    post({ type: 'done', words })
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
