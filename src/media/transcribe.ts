import type { WordChunk } from './fillerWords'
import { SilenceCutError } from './errors'
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
      const request: TranscribeRequest = { samples, sampleRate, windows }
      worker.postMessage(request, [samples.buffer])
    })
  } finally {
    worker.terminate()
  }
}
