// A reaction cut out of its background, for green screen videos: him, with
// whatever is behind him gone, to sit in a corner over the campaign's video
// the way TikTok's green screen effect looks.
//
// Cutting a person out of every frame is slow on a phone, so it is done once
// per reaction and kept (store.ts saveCutout); every video after that reuses
// it. Kept as one ordinary MP4, two pictures stacked: his frame on top, and
// under it the mask - white where he is, black where he isn't. H.264 has no
// see-through, so the mask rides along as a picture of its own and is made
// into see-through again when the video is drawn (greenScreenRender.ts).
//
// The cutting is MediaPipe's selfie segmenter: a 250 KB model kept with the
// app (public/models), run by MediaPipe's engine, which is fetched from
// jsdelivr the first time - like the speech model's - not bundled.

import { Mp4OutputFormat, Output, VideoSample, VideoSampleSink, VideoSampleSource } from 'mediabunny'

import { SilenceCutError } from '../media/errors'
import { createOutputSink } from '../media/outputSink'
import { openClip } from './clipParts'
import { onEncodedPacketMatchingColour } from './colourCheck'
import { videoQuality } from './quality'
import { cover } from './reaction'

/** The size of his picture in the cut-out: enough for a corner of up to half
 *  the width of a 1080 video. */
export const CUTOUT_WIDTH = 540
export const CUTOUT_HEIGHT = 960
/** The most frames a second cut: a corner needs no more, and it halves the
 *  work on a 60 fps take. */
const MAX_FPS = 30
/** Keep in step with package.json: the engine's files are fetched for this. */
export const MEDIAPIPE_VERSION = '1.0.1'
const ENGINE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`
const MODEL = '/models/selfie_segmenter.tflite'

/** How much of the last frame's mask is kept in this one: masks that jump
 *  frame to frame make his edge flicker. */
const STEADY = 0.35
/** The model is unsure at his edge: below this he is gone, above the next
 *  he is solid, and in between his edge fades - crisp, not a halo. */
const EDGE_FROM = 0.25
const EDGE_TO = 0.75

/** One frame's mask as grey pixels (white is him), from the model's
 *  confidence, steadied with the last frame's (`last`, updated in place). */
export function maskPixels(confidence: Float32Array, last: Float32Array | null, out: Uint8ClampedArray): void {
  for (let i = 0; i < confidence.length; i++) {
    let c = confidence[i]
    if (last) {
      c = last[i] * STEADY + c * (1 - STEADY)
      last[i] = c
    }
    const t = Math.min(1, Math.max(0, (c - EDGE_FROM) / (EDGE_TO - EDGE_FROM)))
    const v = Math.round(t * t * (3 - 2 * t) * 255)
    const k = i * 4
    out[k] = v
    out[k + 1] = v
    out[k + 2] = v
    out[k + 3] = 255
  }
}

/** The mask half of a cut-out frame made see-through again: its grey as
 *  how solid each pixel is. In place. */
export function greyToAlpha(pixels: Uint8ClampedArray): void {
  for (let k = 0; k < pixels.length; k += 4) {
    pixels[k + 3] = pixels[k]
  }
}

interface Segmenter {
  segmentForVideo(frame: TexImageSource, timestamp: number, done: (result: { confidenceMasks?: { width: number; height: number; getAsFloat32Array(): Float32Array }[] }) => void): void
  close(): void
}

async function openSegmenter(): Promise<Segmenter> {
  const { FilesetResolver, ImageSegmenter } = await import('@mediapipe/tasks-vision')
  let engine
  try {
    engine = await FilesetResolver.forVisionTasks(ENGINE)
  } catch {
    throw new SilenceCutError("The cut-out tool couldn't be downloaded. Check the signal and try again.")
  }
  const open = (delegate: 'GPU' | 'CPU') =>
    ImageSegmenter.createFromOptions(engine, {
      baseOptions: { modelAssetPath: MODEL, delegate },
      runningMode: 'VIDEO',
      outputConfidenceMasks: true,
      outputCategoryMask: false,
    })
  try {
    return (await open('GPU')) as unknown as Segmenter
  } catch {
    // No GPU for it on this phone: slower, but it still cuts.
    try {
      return (await open('CPU')) as unknown as Segmenter
    } catch {
      throw new SilenceCutError("The cut-out tool couldn't start on this phone. Close the app, open it again and try again.")
    }
  }
}

/** Cuts him out of every frame of `reaction`: the stacked MP4 described
 *  above, no sound. */
export async function makeCutout(reaction: Blob, onProgress?: (fraction: number) => void): Promise<Blob> {
  const clip = await openClip(reaction, 'reaction')
  const sink = await createOutputSink()
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: false }), target: sink.target })
  let segmenter: Segmenter | null = null
  let finished = false
  try {
    segmenter = await openSegmenter()
    const W = CUTOUT_WIDTH
    const H = CUTOUT_HEIGHT
    const frame = new OffscreenCanvas(W, H)
    const frameCtx = frame.getContext('2d')
    const stacked = new OffscreenCanvas(W, H * 2)
    const stackedCtx = stacked.getContext('2d')
    if (!frameCtx || !stackedCtx) throw new SilenceCutError("This phone couldn't prepare the cut-out.")
    const place = cover(clip.width, clip.height, W, H)
    const source = new VideoSampleSource({ codec: 'avc', quality: videoQuality(W, H * 2, MAX_FPS), onEncodedPacket: onEncodedPacketMatchingColour })
    output.addVideoTrack(source)
    await output.start()

    const length = Math.max(0.1, clip.duration - clip.first)
    let maskCanvas: OffscreenCanvas | null = null
    let maskCtx: OffscreenCanvasRenderingContext2D | null = null
    let maskImage: ImageData | null = null
    let last: Float32Array | null = null
    let lastAt = -Infinity
    let written = 0
    for await (const sample of new VideoSampleSink(clip.video).samples(clip.first, clip.duration)) {
      try {
        const at = sample.timestamp - clip.first
        if (at - lastAt < 1 / MAX_FPS - 0.004) continue
        lastAt = at
        frameCtx.fillStyle = '#000'
        frameCtx.fillRect(0, 0, W, H)
        sample.draw(frameCtx, place.x, place.y, place.width, place.height)
        let confidence: Float32Array | null = null
        let size = { width: 0, height: 0 }
        segmenter.segmentForVideo(frame, Math.round(at * 1000) + 1, (result) => {
          const mask = result.confidenceMasks?.[0]
          if (!mask) return
          size = { width: mask.width, height: mask.height }
          confidence = mask.getAsFloat32Array().slice()
        })
        stackedCtx.drawImage(frame, 0, 0)
        if (confidence && size.width > 0) {
          if (!maskCanvas || maskCanvas.width !== size.width || maskCanvas.height !== size.height) {
            maskCanvas = new OffscreenCanvas(size.width, size.height)
            maskCtx = maskCanvas.getContext('2d')
            maskImage = new ImageData(size.width, size.height)
            last = null
          }
          last ??= new Float32Array(confidence)
          maskPixels(confidence, last, maskImage!.data)
          maskCtx!.putImageData(maskImage!, 0, 0)
          stackedCtx.drawImage(maskCanvas, 0, H, W, H)
        } else {
          // No answer for this frame: him not there, rather than a box.
          stackedCtx.fillStyle = '#000'
          stackedCtx.fillRect(0, H, W, H)
        }
        const out = new VideoSample(stacked, { timestamp: at, duration: 1 / MAX_FPS })
        await source.add(out)
        out.close()
        written++
        onProgress?.(Math.min(0.99, at / length))
      } finally {
        sample.close()
      }
    }
    if (written === 0) throw new SilenceCutError('The reaction has no frames to cut out.')
    await output.finalize()
    const blob = await sink.finish()
    if (blob.size === 0) throw new SilenceCutError('Cutting out finished but produced no file. Try again.')
    finished = true
    onProgress?.(1)
    return blob
  } finally {
    segmenter?.close()
    clip.input.dispose()
    if (!finished) {
      await output.cancel().catch(() => {})
      await sink.discard()
    }
  }
}
