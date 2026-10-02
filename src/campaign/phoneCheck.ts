// A quick check of the phone after each update, so a new version that
// cannot work on it says so the first time the page opens - not halfway
// through the day's videos, when he needs them.
//
// It runs the two things that have broken only on the iPhone: keeping a
// video in the page's storage the way the queue does (saved once, its row
// changed afterwards, read back), and the video encoder and decoder making
// a few real frames. About a second, nothing big in memory. It runs once per
// version, and only counts as failed when a second try fails too, so a
// passing hiccup never raises a false alarm.

import { orTimeout } from '../media/within'
import { report } from '../report'

const PASSED_KEY = 'check.passed'
const DB = 'silence-cutter-check'

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error('aborted'))
  })
}

/** The queue's pattern in miniature: a row, the video in its own store,
 *  the row changed, the video read back intact. */
async function checkStorage(): Promise<void> {
  const open = indexedDB.open(DB, 1)
  open.onupgradeneeded = () => {
    open.result.createObjectStore('rows', { keyPath: 'id' })
    open.result.createObjectStore('videos', { keyPath: 'id' })
  }
  const db = await request(open)
  try {
    const bytes = crypto.getRandomValues(new Uint8Array(64 * 1024))
    let tx = db.transaction(['rows', 'videos'], 'readwrite')
    tx.objectStore('rows').put({ id: 'check', attempts: 0 })
    tx.objectStore('videos').put({ id: 'check', blob: new Blob([bytes], { type: 'video/mp4' }) })
    await done(tx)
    tx = db.transaction('rows', 'readwrite')
    tx.objectStore('rows').put({ id: 'check', attempts: 1 })
    await done(tx)
    tx = db.transaction('videos')
    const kept = (await request(tx.objectStore('videos').get('check'))) as { blob: Blob } | undefined
    const back = new Uint8Array(await (kept?.blob ?? new Blob()).arrayBuffer())
    if (back.length !== bytes.length || back[0] !== bytes[0] || back[back.length - 1] !== bytes[bytes.length - 1]) {
      throw new Error('the video read back was not the one saved')
    }
    tx = db.transaction(['rows', 'videos'], 'readwrite')
    tx.objectStore('rows').delete('check')
    tx.objectStore('videos').delete('check')
    await done(tx)
  } finally {
    db.close()
  }
}

/** Ten real 1080x1920 frames through the H.264 encoder and back through the
 *  decoder, and the formats an iPhone video needs. */
async function checkVideo(): Promise<void> {
  const hevc = await VideoDecoder.isConfigSupported({ codec: 'hvc1.2.4.L153.B0', codedWidth: 2160, codedHeight: 3840 })
  if (!hevc.supported) throw new Error("this phone can't read 4K iPhone video in the page")
  const aac = await AudioEncoder.isConfigSupported({ codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 })
  if (!aac.supported) throw new Error("this phone can't write sound in the page")

  const width = 1080
  const height = 1920
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no canvas to draw on')
  const chunks: EncodedVideoChunk[] = []
  let decoderConfig: VideoDecoderConfig | undefined
  let failure: unknown = null
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      chunks.push(chunk)
      if (meta?.decoderConfig) decoderConfig = meta.decoderConfig
    },
    error: (error) => {
      failure = error
    },
  })
  encoder.configure({ codec: 'avc1.640028', width, height, bitrate: 4_000_000, framerate: 30 })
  for (let i = 0; i < 10; i++) {
    ctx.fillStyle = `hsl(${i * 30} 60% 50%)`
    ctx.fillRect(0, 0, width, height)
    const frame = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / 30) })
    encoder.encode(frame, { keyFrame: i === 0 })
    frame.close()
  }
  await encoder.flush()
  encoder.close()
  if (failure) throw failure
  if (!decoderConfig || chunks.length === 0) throw new Error('the encoder made nothing')

  let decoded = 0
  const decoder = new VideoDecoder({
    output: (frame) => {
      decoded++
      frame.close()
    },
    error: (error) => {
      failure = error
    },
  })
  decoder.configure(decoderConfig)
  for (const chunk of chunks) decoder.decode(chunk)
  await decoder.flush()
  decoder.close()
  if (failure) throw failure
  if (decoded < chunks.length) throw new Error(`only ${decoded} of ${chunks.length} frames came back`)
}

async function run(): Promise<string[]> {
  const problems: string[] = []
  // Storage that stops answering is the failure, not a reason to wait for
  // ever - see media/within.ts.
  await orTimeout(checkStorage(), 10_000, 'Saving a test video').catch((error: unknown) =>
    problems.push(`keeping videos safe (${message(error)})`),
  )
  await orTimeout(checkVideo(), 15_000, 'Making test frames').catch((error: unknown) =>
    problems.push(`making video (${message(error)})`),
  )
  return problems
}

/** Checks this phone once per version. Says what to tell him if it can't
 *  do what the page needs, or null when all is well. */
export async function checkPhone(): Promise<string | null> {
  try {
    if (localStorage.getItem(PASSED_KEY) === __APP_VERSION__) return null
  } catch {
    // Storage blocked: check every time, then.
  }
  let problems = await run()
  if (problems.length > 0) problems = await run()
  if (problems.length === 0) {
    try {
      localStorage.setItem(PASSED_KEY, __APP_VERSION__)
    } catch {
      // Just checked again next time.
    }
    return null
  }
  report({ page: 'campaign', kind: 'check', message: problems.join('; ') })
  return `After the update, a check of this phone failed: ${problems.join(' and ')}. Videos may not come out right - the details were sent so it can be fixed.`
}
