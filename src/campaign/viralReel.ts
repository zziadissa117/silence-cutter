// A viral reel taken apart for a Trial loop (trialLoop.ts): where it really
// starts (a screen recording can open on Instagram's screen or a pause before
// the reel), its sound from there, and one still for Claude to read its words
// from (postiz/trial.ts) - the still is the only thing that leaves the phone
// (his OK, 2026-11-04). The clean clip is the same footage with nothing on
// it, so the viral reel's start is found by matching its first frame.

import { ALL_FORMATS, BlobSource, CanvasSink, Conversion, Input, Mp4OutputFormat, Output, BufferTarget, QUALITY_HIGH } from 'mediabunny'

import { within } from '../media/within'
import { firstShown } from './clipParts'
import { report } from '../report'

/** Frames compared this small, grey: enough to tell the same picture. */
const W = 18
const H = 32
/** How far into the viral reel its start is looked for, and how often. */
const LOOK_SEC = 8
const STEP_SEC = 1 / 15
/** How alike two frames have to be (correlation, -1..1) to be the same picture. */
const SAME = 0.6
/** The still Claude reads: big enough for the words, small enough to send. */
const STILL_WIDTH = 720
const STILL_QUALITY = 0.8
/** How much later the start may be than the viral reel is longer than its
 *  clean clip: their lengths are read off the files, a frame or two apart. */
const FIT_SLACK = 0.25
/** What the last look found, for his report. */
let lastLook: { viral: number; clean: number; best: number; start: number } | null = null
/** When the still is taken, after the reel's start: its words are up by then. */
const STILL_AT = 1

/** A frame as grey levels, the middle of it - the words over the viral reel
 *  sit mostly near the top, and a screen recording's bars at the edges. */
function greys(canvas: HTMLCanvasElement | OffscreenCanvas): Float32Array {
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
  const out = new Float32Array(W * H)
  if (!ctx) return out
  const { data } = ctx.getImageData(0, 0, W, H)
  for (let i = 0; i < W * H; i++) out[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]
  return out
}

/** How alike two frames are: their correlation over the lower two thirds,
 *  away from the words (1 the same, 0 nothing alike). */
export function likeness(a: Float32Array, b: Float32Array, width = W, height = H): number {
  const from = Math.floor(height / 3) * width
  let ma = 0
  let mb = 0
  const n = a.length - from
  if (n <= 0) return 0
  for (let i = from; i < a.length; i++) {
    ma += a[i]
    mb += b[i]
  }
  ma /= n
  mb /= n
  let ab = 0
  let aa = 0
  let bb = 0
  for (let i = from; i < a.length; i++) {
    const x = a[i] - ma
    const y = b[i] - mb
    ab += x * y
    aa += x * x
    bb += y * y
  }
  return aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : 0
}

/** Of the viral reel's frames (time, likeness to the clean clip's first),
 *  where it starts: the first that is clearly the same picture - or 0 when
 *  none is (a saved reel that starts at once, or footage too unlike to tell). */
export function startOf(frames: readonly { at: number; like: number }[], latest = Infinity): number {
  // The clean clip has to fit after the start: never later than the viral
  // reel is longer (a reel and its clip of the same length start together -
  // matched further in, its sound came out short and looped, 2026-11-06).
  frames = frames.filter((f) => f.at <= latest)
  const best = frames.reduce<{ at: number; like: number } | null>((b, f) => (!b || f.like > b.like ? f : b), null)
  if (!best || best.like < SAME) return 0
  // The first frame nearly as alike as the best: where the picture begins.
  const first = frames.find((f) => f.like >= Math.max(SAME, best.like - 0.05))
  return first?.at ?? best.at
}

async function jpegBase64(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<string> {
  const blob =
    'convertToBlob' in canvas
      ? await canvas.convertToBlob({ type: 'image/jpeg', quality: STILL_QUALITY })
      : await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('no still'))), 'image/jpeg', STILL_QUALITY))
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let text = ''
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(text)
}

/** Where the viral reel starts, in seconds: matched against the clean clip's
 *  first frame. 0 when it can't be told. */
async function findStart(viral: Blob, clean: Blob): Promise<number> {
  const a = new Input({ source: new BlobSource(clean), formats: ALL_FORMATS })
  const b = new Input({ source: new BlobSource(viral), formats: ALL_FORMATS })
  try {
    const [cleanTrack, viralTrack] = await Promise.all([a.getPrimaryVideoTrack(), b.getPrimaryVideoTrack()])
    if (!cleanTrack || !viralTrack || !(await cleanTrack.canDecode()) || !(await viralTrack.canDecode())) return 0
    const size = { width: W, height: H, fit: 'cover' as const, poolSize: 1 }
    const first = await new CanvasSink(cleanTrack, size).getCanvas(await firstShown(cleanTrack))
    if (!first) return 0
    const target = greys(first.canvas)
    const from = await firstShown(viralTrack)
    const [viralLength, cleanLength] = await Promise.all([b.computeDuration(), a.computeDuration()])
    const latest = from + Math.max(0, viralLength - cleanLength) + FIT_SLACK
    const until = Math.min(from + LOOK_SEC, viralLength, latest + STEP_SEC)
    const times: number[] = []
    for (let t = from; t < until; t += STEP_SEC) times.push(t)
    const frames: { at: number; like: number }[] = []
    for await (const frame of new CanvasSink(viralTrack, size).canvasesAtTimestamps(times)) {
      if (frame) frames.push({ at: frame.timestamp, like: likeness(greys(frame.canvas), target) })
    }
    const start = Math.max(0, startOf(frames, latest) - from)
    lastLook = {
      viral: viralLength,
      clean: cleanLength,
      best: frames.reduce((n, f) => Math.max(n, f.like), -1),
      start,
    }
    return start
  } finally {
    a.dispose()
    b.dispose()
  }
}

/** The viral reel's sound from `start` on, as an M4A; null when it has none. */
export async function soundFrom(viral: File, start: number): Promise<File | null> {
  const input = new Input({ source: new BlobSource(viral), formats: ALL_FORMATS })
  try {
    if (!(await input.getPrimaryAudioTrack())) return null
    const target = new BufferTarget()
    const output = new Output({ format: new Mp4OutputFormat(), target })
    const conversion = await Conversion.init({
      input,
      output,
      showWarnings: false,
      video: { discard: true },
      audio: async (track) => ((await track.getCodec()) === 'aac' ? {} : { codec: 'aac', quality: QUALITY_HIGH }),
      ...(start > 0 ? { trim: { start } } : {}),
    })
    if (!conversion.isValid || !conversion.utilizedTracks.some((t) => t.isAudioTrack())) return null
    await conversion.execute()
    if (!target.buffer || target.buffer.byteLength === 0) return null
    const name = viral.name.replace(/\.[^./]+$/, '')
    return new File([target.buffer], `${name} - sound.m4a`, { type: 'audio/mp4' })
  } finally {
    input.dispose()
  }
}

/** One still of the viral reel, its words up: base64 JPEG, or '' when it
 *  can't be read. */
async function stillOf(viral: Blob, start: number): Promise<string> {
  const input = new Input({ source: new BlobSource(viral), formats: ALL_FORMATS })
  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track || !(await track.canDecode())) return ''
    const duration = await input.computeDuration()
    const at = Math.min(Math.max(0, duration - 0.1), (await firstShown(track)) + start + STILL_AT)
    const frame = await new CanvasSink(track, { width: STILL_WIDTH, poolSize: 1 }).getCanvas(at)
    return frame ? await jpegBase64(frame.canvas) : ''
  } finally {
    input.dispose()
  }
}

export interface ViralParts {
  /** Where the reel starts in the file he picked, in seconds. */
  start: number
  sound: File | null
  /** For Claude to read the words from; '' when none could be taken. */
  still: string
}

/** The viral reel taken apart: where it starts, its sound from there, and a
 *  still to read its words from. */
export async function takeApart(viral: File, clean: File, say: (step: string) => void = () => {}): Promise<ViralParts> {
  lastLook = null
  say('Finding where the viral reel starts…')
  const start = await within(findStart(viral, clean).catch(() => 0), 60_000, 0)
  say('Taking its sound…')
  const sound = await soundFrom(viral, start)
  // What was found, for when copies come out wrong (Ilyan's looped).
  const look = lastLook as { viral: number; clean: number; best: number; start: number } | null
  report({
    kind: 'check',
    phase: 'trial',
    message: `viral reel ${viral.name}: ${look ? `${look.viral.toFixed(1)} s, clean clip ${look.clean.toFixed(1)} s, best match ${look.best.toFixed(2)}, ` : ''}starts ${start.toFixed(2)} s in, ${sound ? 'sound taken' : 'no sound'}`,
  })
  say('Taking a still of its words…')
  const still = await within(stillOf(viral, start).catch(() => ''), 30_000, '')
  return { start, sound, still }
}
