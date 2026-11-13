// A recording steadied (his ask, 2026-11-07: "when I pick up my phone and I
// film with the back camera ... it's the most shaky thing ever. Can you add a
// stabilizer"). The iPhone's Camera app steadies its videos; a web page gets
// the camera without that, so every take in the Cutter's recorder carries all
// of his hand's shake. This does what the Camera app does, after the take:
//
//   1. Measure - each frame against the one before, small and grey: how far
//      the picture moved. Measured on the left and right edges, not the middle
//      where he is - his head moving is not the camera moving - and the two
//      sides moving up and down apart is the phone tilting.
//   2. Smooth - the camera's path kept slow and steady (a moving average a
//      little under a second wide): the quick jitter is what is taken out,
//      a slow pan stays.
//   3. Redraw - each frame moved and turned back against its jitter, zoomed
//      in just enough (at most MAX_ZOOM) that no edge ever shows. The sound is
//      copied as it is.
//
// A take already steady (on a tripod, propped up) is left alone.
//
// Made quick (2026-11-13, his report: "it took me 2 whole minutes ... is it
// even worth it?"): his 68 s selfie take sat 2 min 20 s in steadying - three
// passes over every frame (measure, redraw, measure again) - and was thrown
// away at the end, as 16 of his 27 takes had been. Now a take is redrawn
// only when the measuring shows shake worth taking out and the steady path
// would clearly take it out; the check is made on the frames as they are
// redrawn (no third pass); Skip stops it at once. The recorder steadies only
// the back camera's takes (Recorder.tsx).

import {
  ALL_FORMATS,
  BlobSource,
  CanvasSink,
  EncodedAudioPacketSource,
  EncodedPacketSink,
  Input,
  Mp4OutputFormat,
  Output,
  Quality,
  VideoSample,
  VideoSampleSink,
  VideoSampleSource,
  type AudioCodec,
} from 'mediabunny'

import { createOutputSink } from '../media/outputSink'
import { onEncodedPacketMatchingColour } from './colourCheck'
import { frameRateOf } from './quality'

/** The steadied take is kept only when its shake is under this share of
 *  the original's. */
const KEEP_IF_BELOW = 0.8
/** Less shake than this (share of the width moved, typical frame) is left
 *  as it is: below it the measuring is mostly noise (his selfie takes, 1 to
 *  2 px a frame at 1080), and redrawing them never came out steadier. */
export const WORTH_STEADYING = 0.003
/** The size frames are measured at (portrait; a landscape take turns it). */
const SMALL_W = 144
const SMALL_H = 256
/** How far one frame may have moved from the last, at the small size: about
 *  a ninth of the width - a hard shake at 30 fps. */
const SEARCH = 16
/** The camera's steady path: a moving average this many seconds wide. */
const SMOOTH_SEC = 0.8
/** The most the picture is zoomed to hide the edges a correction uncovers. */
export const MAX_ZOOM = 1.15
/** Shake smaller than this (share of the width, typical frame) isn't worth
 *  making the take again for. */
const STEADY_ENOUGH = 0.002

/** One frame's grey levels at the small size. */
export interface Grey {
  data: Float32Array
  width: number
  height: number
}

/** A picture at half its size, each pixel the average of four. */
function half(g: Grey): Grey {
  const width = Math.floor(g.width / 2)
  const height = Math.floor(g.height / 2)
  const data = new Float32Array(width * height)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = 2 * y * g.width + 2 * x
      data[y * width + x] = (g.data[i] + g.data[i + 1] + g.data[i + g.width] + g.data[i + g.width + 1]) / 4
    }
  return { data, width, height }
}

/** The sum of differences between `a` and `b` moved by (dx, dy), over the
 *  columns from `x0` to `x1` (every other pixel), as an average. */
function difference(a: Grey, b: Grey, dx: number, dy: number, x0: number, x1: number): number {
  const { width, height } = a
  let sum = 0
  let n = 0
  const y0 = Math.max(0, -dy) + 4
  const y1 = Math.min(height, height - dy) - 4
  const from = Math.max(x0, -dx)
  const to = Math.min(x1, width - dx)
  for (let y = y0; y < y1; y += 2) {
    const row = y * width
    const moved = (y + dy) * width + dx
    for (let x = from; x < to; x += 2) {
      sum += Math.abs(a.data[row + x] - b.data[moved + x])
      n++
    }
  }
  return n > 0 ? sum / n : Infinity
}

/** How far the picture in columns x0..x1 moved from `a` to `b`, in small
 *  pixels, to a tenth of a pixel: every shift searched, then the best one's
 *  neighbours fitted for the part of a pixel. */
export function shiftBetween(a: Grey, b: Grey, x0 = 0, x1 = a.width, search = SEARCH): { dx: number; dy: number } {
  // Every shift searched on half-size copies, then around it at full size.
  const ha = half(a)
  const hb = half(b)
  const hx0 = Math.floor(x0 / 2)
  const hx1 = Math.ceil(x1 / 2)
  const reach = Math.ceil(search / 2)
  let coarse = { dx: 0, dy: 0, d: Infinity }
  for (let dy = -reach; dy <= reach; dy++)
    for (let dx = -reach; dx <= reach; dx++) {
      const d = difference(ha, hb, dx, dy, hx0, hx1)
      if (d < coarse.d) coarse = { dx, dy, d }
    }
  let best = { dx: coarse.dx * 2, dy: coarse.dy * 2, d: Infinity }
  for (let dy = coarse.dy * 2 - 2; dy <= coarse.dy * 2 + 2; dy++)
    for (let dx = coarse.dx * 2 - 2; dx <= coarse.dx * 2 + 2; dx++) {
      const d = difference(a, b, dx, dy, x0, x1)
      if (d < best.d) best = { dx, dy, d }
    }
  // The part of a pixel: a parabola through the best and its two neighbours.
  const part = (minus: number, mid: number, plus: number) => {
    const bend = minus - 2 * mid + plus
    return bend > 0 ? Math.max(-0.5, Math.min(0.5, (minus - plus) / (2 * bend))) : 0
  }
  const fx = part(difference(a, b, best.dx - 1, best.dy, x0, x1), best.d, difference(a, b, best.dx + 1, best.dy, x0, x1))
  const fy = part(difference(a, b, best.dx, best.dy - 1, x0, x1), best.d, difference(a, b, best.dx, best.dy + 1, x0, x1))
  return { dx: best.dx + fx, dy: best.dy + fy }
}

/** How much detail a part of a picture has across (gx) and up and down
 *  (gy): the average difference between neighbouring pixels. A plain wall
 *  has none - and a move along a stripe can't be seen. */
export function textureOf(g: Grey, x0 = 0, x1 = g.width): { gx: number; gy: number } {
  let gx = 0
  let gy = 0
  let n = 0
  for (let y = 1; y < g.height; y += 2)
    for (let x = Math.max(1, x0); x < x1; x += 2) {
      const i = y * g.width + x
      gx += Math.abs(g.data[i] - g.data[i - 1])
      gy += Math.abs(g.data[i] - g.data[i - g.width])
      n++
    }
  return n > 0 ? { gx: gx / n, gy: gy / n } : { gx: 0, gy: 0 }
}

/** Less detail than this (grey levels between neighbours) and a direction
 *  can't be measured in it. */
const MIN_TEXTURE = 1.5

/** How the camera moved from one frame to the next: across, up and down (as a
 *  share of the width and height), and its tilt (radians) - from the left and
 *  right edges, away from him in the middle, each counted only in the
 *  directions it has detail in; with no detail at either edge, from the whole
 *  frame; with none anywhere, not at all. */
export function motionBetween(a: Grey, b: Grey): { x: number; y: number; angle: number } {
  const edge = Math.round(a.width * 0.32)
  const strips = [
    { x0: 0, x1: edge },
    { x0: a.width - edge, x1: a.width },
  ].map(({ x0, x1 }) => ({ x0, x1, texture: textureOf(a, x0, x1) }))
  const usable = strips.filter((st) => st.texture.gx >= MIN_TEXTURE || st.texture.gy >= MIN_TEXTURE)
  const parts = usable.length > 0 ? usable : [{ x0: 0, x1: a.width, texture: textureOf(a) }]
  const shifts = parts.map((p) => ({ ...p, shift: shiftBetween(a, b, p.x0, p.x1) }))
  const weighted = (key: 'dx' | 'dy', weight: 'gx' | 'gy') => {
    const counted = shifts.filter((p) => p.texture[weight] >= MIN_TEXTURE)
    const total = counted.reduce((n, p) => n + p.texture[weight], 0)
    return total > 0 ? counted.reduce((n, p) => n + p.shift[key] * p.texture[weight], 0) / total : 0
  }
  const x = weighted('dx', 'gx') / a.width
  const y = weighted('dy', 'gy') / a.height
  // Tilting: the two edges moving up and down apart - when both can tell.
  const both = shifts.length === 2 && shifts.every((p) => p.texture.gy >= MIN_TEXTURE)
  const angle = both ? Math.atan2(shifts[1].shift.dy - shifts[0].shift.dy, a.width - edge) : 0
  return { x, y, angle }
}

export interface Correction {
  /** How far to move the frame, as a share of its width and height. */
  x: number
  y: number
  /** How far to turn it back, in radians. */
  angle: number
}

/** From each frame's movement (frame i against i - 1; the first is none),
 *  how to move each frame back onto the camera's steady path, and the zoom
 *  that hides the edges - corrections larger than that zoom allows are cut
 *  down to it. Null when the take is steady already. */
export function steadyPath(moves: readonly { x: number; y: number; angle: number }[], fps: number, aspect = 9 / 16): { corrections: Correction[]; zoom: number } | null {
  const n = moves.length
  if (n < 3) return null
  // Where the camera was at each frame (the picture's own position is the opposite).
  const path = { x: [0], y: [0], a: [0] }
  for (let i = 1; i < n; i++) {
    path.x.push(path.x[i - 1] + moves[i].x)
    path.y.push(path.y[i - 1] + moves[i].y)
    path.a.push(path.a[i - 1] + moves[i].angle)
  }
  const half = Math.max(1, Math.round((SMOOTH_SEC * fps) / 2))
  const smooth = (list: number[]) =>
    list.map((_, i) => {
      // Mirrored at the ends, so the start and end aren't pulled anywhere.
      let sum = 0
      for (let k = -half; k <= half; k++) {
        let j = i + k
        if (j < 0) j = -j
        if (j >= n) j = 2 * (n - 1) - j
        sum += list[Math.max(0, Math.min(n - 1, j))]
      }
      return sum / (2 * half + 1)
    })
  const steady = { x: smooth(path.x), y: smooth(path.y), a: smooth(path.a) }
  // The picture moved with the camera: moving it back by the difference.
  let corrections = path.x.map((_, i) => ({ x: steady.x[i] - path.x[i], y: steady.y[i] - path.y[i], angle: steady.a[i] - path.a[i] }))
  const typical = corrections.reduce((s, c) => s + Math.hypot(c.x, c.y * aspect), 0) / n
  if (typical < STEADY_ENOUGH) return null
  // The zoom each correction needs: twice its shift (both edges) plus what
  // its turn swings into the corners.
  const need = (c: Correction) => 1 + 2 * Math.max(Math.abs(c.x), Math.abs(c.y)) + Math.abs(c.angle) * (1 + aspect)
  const wanted = corrections.map(need).sort((a, b) => a - b)
  // Enough for nearly every frame; the few biggest jolts are cut down to it.
  const zoom = Math.min(MAX_ZOOM, wanted[Math.floor((wanted.length - 1) * 0.98)])
  corrections = corrections.map((c) => {
    const over = need(c)
    if (over <= zoom) return c
    const k = (zoom - 1) / (over - 1)
    return { x: c.x * k, y: c.y * k, angle: c.angle * k }
  })
  return { corrections, zoom: Math.max(1.01, zoom) }
}

/** A frame as grey levels. */
function greyOf(canvas: HTMLCanvasElement | OffscreenCanvas): Grey {
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
  const { width, height } = canvas
  const data = new Float32Array(width * height)
  if (!ctx) return { data, width, height }
  const pixels = ctx.getImageData(0, 0, width, height).data
  for (let i = 0; i < data.length; i++) data[i] = 0.299 * pixels[i * 4] + 0.587 * pixels[i * 4 + 1] + 0.114 * pixels[i * 4 + 2]
  return { data, width, height }
}

/** How far each frame moves from the one before, on average, in pixels of
 *  the full frame - for the report, and to check a steadied take. */
export async function shakeOf(file: Blob): Promise<number | null> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
  try {
    const video = await input.getPrimaryVideoTrack()
    if (!video || !(await video.canDecode())) return null
    const width = await video.getDisplayWidth()
    const height = await video.getDisplayHeight()
    const portrait = height >= width
    const small = new CanvasSink(video, { width: portrait ? SMALL_W : SMALL_H, height: portrait ? SMALL_H : SMALL_W, fit: 'fill', poolSize: 2 })
    let last: Grey | null = null
    let sum = 0
    let n = 0
    for await (const frame of small.canvases()) {
      const grey = greyOf(frame.canvas)
      if (last) {
        const m = motionBetween(last, grey)
        sum += Math.hypot(m.x * width, m.y * height)
        n++
      }
      last = grey
    }
    return n > 0 ? sum / n : null
  } finally {
    input.dispose()
  }
}

/** Each frame's movement from the one before (frame 0: none), measured as
 *  the steadying measures it. */
export async function movesOf(file: Blob): Promise<{ x: number; y: number; angle: number }[]> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
  try {
    const video = await input.getPrimaryVideoTrack()
    if (!video || !(await video.canDecode())) return []
    const portrait = (await video.getDisplayHeight()) >= (await video.getDisplayWidth())
    const small = new CanvasSink(video, { width: portrait ? SMALL_W : SMALL_H, height: portrait ? SMALL_H : SMALL_W, fit: 'fill', poolSize: 2 })
    const moves: { x: number; y: number; angle: number }[] = []
    let last: Grey | null = null
    for await (const frame of small.canvases()) {
      const grey = greyOf(frame.canvas)
      moves.push(last ? motionBetween(last, grey) : { x: 0, y: 0, angle: 0 })
      last = grey
    }
    return moves
  } finally {
    input.dispose()
  }
}

/** How far each frame moves from the one before, on average, in pixels of
 *  the full frame. */
export function shakeOfMoves(moves: readonly { x: number; y: number }[], width: number, height: number): number {
  let sum = 0
  for (let i = 1; i < moves.length; i++) sum += Math.hypot(moves[i].x * width, moves[i].y * height)
  return sum / Math.max(1, moves.length - 1)
}

/** The shake the steadied take would have: each frame's move plus the
 *  change in its correction, zoomed - worked out before anything is redrawn,
 *  so a take it wouldn't help is not made again for nothing. */
export function predictedShake(
  moves: readonly { x: number; y: number }[],
  plan: { corrections: readonly Correction[]; zoom: number },
  width: number,
  height: number,
): number {
  let sum = 0
  for (let i = 1; i < moves.length; i++) {
    const c = plan.corrections[i] ?? plan.corrections[plan.corrections.length - 1]
    const p = plan.corrections[i - 1] ?? c
    sum += Math.hypot((moves[i].x + c.x - p.x) * plan.zoom * width, (moves[i].y + c.y - p.y) * plan.zoom * height)
  }
  return sum / Math.max(1, moves.length - 1)
}

/** What happened to a take. */
export interface Steadied {
  file: File
  /** Made again steadied; false when it was steady already (or couldn't be). */
  changed: boolean
  zoom?: number
  /** How much shake there was, typical frame, as a share of the width. */
  why?: string
}

const bitrate = (fps: number) => (fps > 40 ? 32_000_000 : 20_000_000)

/** The take steadied, or as it was when it is steady already, when
 *  steadying wouldn't help, or when `signal` stops it (Skip). */
export async function stabilize(file: File, onProgress?: (fraction: number) => void, signal?: AbortSignal): Promise<Steadied> {
  const skipped: Steadied = { file, changed: false, why: 'skipped' }
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
  try {
    const video = await input.getPrimaryVideoTrack()
    if (!video || !(await video.canDecode())) return { file, changed: false, why: "this phone can't read it" }
    // Even sizes: the encoder takes nothing else.
    const width = Math.round((await video.getDisplayWidth()) / 2) * 2
    const height = Math.round((await video.getDisplayHeight()) / 2) * 2
    const fps = await frameRateOf(video)
    const start = await video.getFirstTimestamp()
    const length = Math.max(0.1, (await input.computeDuration()) - start)

    // 1. Measure, small and grey.
    const portrait = height >= width
    const small = new CanvasSink(video, { width: portrait ? SMALL_W : SMALL_H, height: portrait ? SMALL_H : SMALL_W, fit: 'fill', poolSize: 2 })
    const moves: { x: number; y: number; angle: number }[] = []
    let last: Grey | null = null
    for await (const frame of small.canvases()) {
      if (signal?.aborted) return skipped
      const grey = greyOf(frame.canvas)
      moves.push(last ? motionBetween(last, grey) : { x: 0, y: 0, angle: 0 })
      last = grey
      onProgress?.(Math.min(0.3, ((frame.timestamp - start) / length) * 0.3))
    }
    const before = shakeOfMoves(moves, width, height)
    if (before < WORTH_STEADYING * width) return { file, changed: false, why: `steady already (${before.toFixed(1)} px a frame)` }
    const plan = steadyPath(moves, fps, width / height)
    if (!plan) return { file, changed: false, why: 'steady already' }
    const expected = predictedShake(moves, plan, width, height)
    if (expected > before * KEEP_IF_BELOW) {
      return { file, changed: false, why: `wouldn't be steadier (${before.toFixed(1)} -> about ${expected.toFixed(1)} px a frame)` }
    }

    // 2. Redraw each frame back on the steady path, zoomed to hide the edges.
    const sink = await createOutputSink()
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: false }), target: sink.target })
    let finished = false
    try {
      const canvas = new OffscreenCanvas(width, height)
      const ctx = canvas.getContext('2d')
      if (!ctx) return { file, changed: false, why: "this phone couldn't prepare a canvas" }
      const source = new VideoSampleSource({ codec: 'avc', quality: new Quality({ bitrate: bitrate(fps) }), onEncodedPacket: onEncodedPacketMatchingColour })
      output.addVideoTrack(source, { frameRate: fps })
      // The sound, copied as it is.
      const audio = await input.getPrimaryAudioTrack()
      const codec = (await audio?.getCodec()) as AudioCodec | null | undefined
      const sound = audio && codec ? new EncodedAudioPacketSource(codec) : null
      if (sound) output.addAudioTrack(sound)
      await output.start()

      // Each redrawn frame measured as it is made, small and grey, as the
      // original was: the check costs no third pass over the take.
      const check = new OffscreenCanvas(portrait ? SMALL_W : SMALL_H, portrait ? SMALL_H : SMALL_W)
      const checkCtx = check.getContext('2d', { willReadFrequently: true })
      let lastOut: Grey | null = null
      let afterSum = 0
      let afterN = 0
      let i = 0
      const pictures = async () => {
        for await (const sample of new VideoSampleSink(video).samples()) {
          if (signal?.aborted) {
            sample.close()
            break
          }
          try {
            const c = plan.corrections[Math.min(i, plan.corrections.length - 1)]
            ctx.setTransform(1, 0, 0, 1, 0, 0)
            ctx.fillStyle = '#000'
            ctx.fillRect(0, 0, width, height)
            ctx.translate(width / 2, height / 2)
            ctx.rotate(c.angle)
            ctx.scale(plan.zoom, plan.zoom)
            ctx.translate(-width / 2 + c.x * width, -height / 2 + c.y * height)
            sample.draw(ctx, 0, 0, width, height)
            if (checkCtx) {
              checkCtx.drawImage(canvas, 0, 0, check.width, check.height)
              const grey = greyOf(check)
              if (lastOut) {
                const m = motionBetween(lastOut, grey)
                afterSum += Math.hypot(m.x * width, m.y * height)
                afterN++
              }
              lastOut = grey
            }
            const out = new VideoSample(canvas, { timestamp: sample.timestamp, duration: sample.duration })
            await source.add(out)
            out.close()
          } finally {
            sample.close()
          }
          i++
          onProgress?.(0.3 + Math.min(0.68, (i / Math.max(1, plan.corrections.length)) * 0.68))
        }
      }
      // The sound alongside the picture, so neither waits in memory for the other.
      const sounds = async () => {
        if (!audio || !sound) return
        const config = await audio.getDecoderConfig()
        let first = true
        for await (const packet of new EncodedPacketSink(audio).packets()) {
          if (signal?.aborted) break
          await sound.add(packet, first && config ? { decoderConfig: config } : undefined)
          first = false
        }
      }
      await Promise.all([pictures(), sounds()])
      if (signal?.aborted) return skipped
      // Checked before it is even finished: kept only when it really is
      // steadier - a picture that moves by itself (a screen, a passing car)
      // can fool the measuring.
      const after = afterN > 0 ? afterSum / afterN : null
      if (after === null || after > before * KEEP_IF_BELOW) {
        return { file, changed: false, why: `not steadier (${before.toFixed(1)} -> ${after?.toFixed(1) ?? '?'} px a frame)` }
      }
      await output.finalize()
      const blob = await sink.finish()
      if (blob.size === 0) return { file, changed: false, why: 'it came out empty' }
      finished = true
      onProgress?.(1)
      return {
        file: new File([blob], file.name, { type: 'video/mp4', lastModified: file.lastModified }),
        changed: true,
        zoom: plan.zoom,
        why: `shake ${before.toFixed(1)} -> ${after.toFixed(1)} px a frame`,
      }
    } finally {
      if (!finished) {
        await output.cancel().catch(() => {})
        await sink.discard()
      }
    }
  } finally {
    input.dispose()
  }
}
