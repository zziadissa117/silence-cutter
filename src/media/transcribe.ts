import type { WordChunk } from './fillerWords'
import type { Range } from './silenceMath'
import type { TranscribeMessage, TranscribeRequest } from './transcribe.worker'

/** Hears every word in `windows` of `samples` and returns them with their
 *  timings, running the model in a worker that is ended as soon as it is done
 *  - see transcribe.worker.ts for why that is the only way its memory comes
 *  back. `samples` is handed over to the worker and unusable here after. */
export async function transcribeOnDevice(
  samples: Float32Array,
  sampleRate: number,
  windows: Range[],
  { onModelDownload, onProgress }: { onModelDownload?: (f: number) => void; onProgress?: (f: number) => void } = {},
): Promise<WordChunk[]> {
  if (windows.length === 0) return []
  const worker = new Worker(new URL('./transcribe.worker.ts', import.meta.url), { type: 'module' })
  try {
    return await new Promise<WordChunk[]>((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<TranscribeMessage>) => {
        const message = event.data
        if (message.type === 'download') onModelDownload?.(message.fraction)
        else if (message.type === 'loaded') onProgress?.(0)
        else if (message.type === 'progress') onProgress?.(message.fraction)
        else if (message.type === 'done') resolve(message.words)
        else reject(new Error(`the speech model failed: ${message.message}`))
      }
      worker.onerror = (event) => {
        reject(new Error(`the speech model stopped: ${event.message || 'no reason given'}`))
      }
      const request: TranscribeRequest = { samples, sampleRate, windows }
      worker.postMessage(request, [samples.buffer])
    })
  } finally {
    worker.terminate()
  }
}
