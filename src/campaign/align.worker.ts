// Runs the letter model that times each heard word exactly - see align.ts.
//
// A worker of its own, started after the speech model's has been ended, for
// the same reason that one is: ending the worker is the only thing that gives
// a phone its memory back, and the two models never need to be in memory at
// once. The quantized model is about 95 MB, downloaded once and kept.

import { AutoModelForCTC, AutoProcessor, env } from '@huggingface/transformers'

import { forceAlign, joinPieces, logSoftmax, placeWordsAt, spellForAlignment, type TimedWord } from './align'

export interface AlignRequest {
  /** 16 kHz mono. */
  samples: Float32Array
  /** Each stretch the speech model listened to, with the words it heard in
   *  it, on the video's timeline - and where to cut it into pieces for the
   *  letter model, in its pauses (align.ts pieceCuts). */
  windows: { start: number; end: number; words: TimedWord[]; cuts?: number[] }[]
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
    // Loaded: said, so the wait for the first piece starts from here.
    post({ type: 'progress', fraction: 0 })
    const words: TimedWord[] = []
    for (let i = 0; i < windows.length; i++) {
      const { start, end, words: heard, cuts = [] } = windows[i]
      const from = Math.floor(start * SAMPLE_RATE)
      const to = Math.ceil(end * SAMPLE_RATE)
      if (heard.length > 0 && to - from >= SAMPLE_RATE / 10) {
        // A piece at a time (see ALIGN_PIECE_SEC), each cut in a pause; the
        // letters are joined back up and the words laid along the whole window.
        const bounds = [from, ...cuts.map((t) => Math.round(t * SAMPLE_RATE)).filter((s) => s > from && s < to), to]
        const pieces: { logProbs: Float32Array; frames: number; start: number; end: number }[] = []
        let letters = 0
        for (let k = 0; k + 1 < bounds.length; k++) {
          const piece = samples.subarray(bounds[k], bounds[k + 1])
          if (piece.length < SAMPLE_RATE / 10) continue
          const inputs = await processor(piece)
          const { logits } = (await model(inputs)) as { logits: Logits }
          const [, frames, count] = logits.dims
          letters = count
          pieces.push({
            logProbs: logSoftmax(new Float32Array(logits.data), frames, count),
            frames,
            start: bounds[k] / SAMPLE_RATE,
            end: (bounds[k] + piece.length) / SAMPLE_RATE,
          })
          post({ type: 'progress', fraction: (i + (k + 1) / (bounds.length - 1)) / windows.length })
        }
        const joined = joinPieces(pieces, letters)
        const spans = forceAlign(joined.logProbs, joined.frames, letters, heard.map((w) => spellForAlignment(w.text)))
        words.push(...placeWordsAt(heard, spans, joined.starts, joined.ends))
      } else words.push(...heard)
      post({ type: 'progress', fraction: (i + 1) / windows.length })
    }
    post({ type: 'done', words })
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
