// When a video stops at "Making it 0%": a quick look at the three things every
// video needs - the phone's private file storage, its video encoder and its
// video decoder - each given a few seconds, to say which one isn't answering.
//
// On 2026-10-22 one iPhone made two videos, then every talking video after
// stopped at 0% - a 19 MB one too, after closing and opening the Cutter, and
// the plain cut as well - while the other phone kept making its batch. That
// is below the Cutter (WebKit's storage or the phone's video hardware), and
// only the phone itself restarting clears it. This tells which, in the report
// and to him.

import { within } from '../media/within'

export type Probe = 'ok' | 'stuck' | `failed: ${string}`

export interface MediaHealth {
  storage: Probe
  encoder: Probe
  decoder: Probe
}

const WAIT_MS = 6000

async function probe(work: () => Promise<void>): Promise<Probe> {
  try {
    const answered = await within(
      work().then(() => true),
      WAIT_MS,
      false,
    )
    return answered ? 'ok' : 'stuck'
  } catch (error) {
    return `failed: ${(error instanceof Error ? error.message : String(error)).slice(0, 120)}`
  }
}

/** What every video does with storage before its first frame
 *  (outputSink.ts): takes a lock, lists the folder made videos go in, writes
 *  and removes a tiny file. */
function storageProbe(): Promise<Probe> {
  return probe(async () => {
    if (navigator.locks) await navigator.locks.request(`silence-cutter-probe:${Date.now()}`, async () => {})
    const root = await navigator.storage.getDirectory()
    const cuts = await root.getDirectoryHandle('cuts', { create: true })
    await cuts.keys().next()
    const name = `probe-${Date.now()}`
    const handle = await root.getFileHandle(name, { create: true })
    if (typeof handle.createWritable === 'function') {
      const writable = await handle.createWritable()
      await writable.write(new Uint8Array([1]))
      await writable.close()
    }
    await root.removeEntry(name)
  })
}

/** Encodes one 1080x1920 frame as the videos are, then decodes it again. */
async function codecProbe(): Promise<{ encoder: Probe; decoder: Probe }> {
  if (typeof VideoEncoder === 'undefined' || typeof VideoDecoder === 'undefined') {
    return { encoder: 'failed: no WebCodecs', decoder: 'failed: no WebCodecs' }
  }
  let chunk: EncodedVideoChunk | null = null
  let config: VideoDecoderConfig | null = null
  const encoder = await probe(async () => {
    let failure: unknown = null
    const coder = new VideoEncoder({
      output: (out, meta) => {
        chunk ??= out
        config ??= meta?.decoderConfig ?? null
      },
      error: (e) => {
        failure = e
      },
    })
    try {
      coder.configure({ codec: 'avc1.640028', width: 1080, height: 1920, bitrate: 6_000_000, framerate: 30 })
      const canvas = new OffscreenCanvas(1080, 1920)
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.fillStyle = '#336'
        ctx.fillRect(0, 0, 1080, 1920)
      }
      const frame = new VideoFrame(canvas, { timestamp: 0 })
      coder.encode(frame, { keyFrame: true })
      frame.close()
      await coder.flush()
      if (failure) throw failure
      if (!chunk) throw new Error('no frame came out')
    } finally {
      if (coder.state !== 'closed') coder.close()
    }
  })
  if (encoder !== 'ok' || !chunk || !config) return { encoder, decoder: 'failed: nothing to decode' }
  const encoded: EncodedVideoChunk = chunk
  const decoderConfig: VideoDecoderConfig = config
  const decoder = await probe(async () => {
    let failure: unknown = null
    let got = false
    const coder = new VideoDecoder({
      output: (frame) => {
        got = true
        frame.close()
      },
      error: (e) => {
        failure = e
      },
    })
    try {
      coder.configure(decoderConfig)
      coder.decode(encoded)
      await coder.flush()
      if (failure) throw failure
      if (!got) throw new Error('no frame came out')
    } finally {
      if (coder.state !== 'closed') coder.close()
    }
  })
  return { encoder, decoder }
}

/** How the three are, each given a few seconds. */
export async function mediaHealth(): Promise<MediaHealth> {
  const storage = await storageProbe()
  const { encoder, decoder } = await codecProbe()
  return { storage, encoder, decoder }
}

/** "storage ok, encoder stuck, decoder failed: …" for a report. */
export function healthLine(health: MediaHealth): string {
  return `storage ${health.storage}, encoder ${health.encoder}, decoder ${health.decoder}`
}

/** What to tell him when one of them isn't answering, or null when all are
 *  fine (then it is the video). */
export function healthAdvice(health: MediaHealth): string | null {
  const stuck = [
    health.storage !== 'ok' ? "the phone's storage" : null,
    health.encoder !== 'ok' || health.decoder !== 'ok' ? "the phone's video maker" : null,
  ].filter(Boolean)
  if (stuck.length === 0) return null
  const which = stuck.join(' and ')
  return `${which[0].toUpperCase()}${which.slice(1)} stopped answering - that is the iPhone, not the video. Restart the iPhone (hold the side button and a volume button, slide to power off, turn it on), then open the Cutter: your videos carry on where they were.`
}
