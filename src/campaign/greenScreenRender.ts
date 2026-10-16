// A green screen video: the campaign's own video playing full screen, and
// him cut out of his background, reacting, in a bottom corner - the way
// TikTok's green screen effect looks. The only sound is the background
// video's; his reaction is silent. It lasts as long as the background video;
// a reaction shorter than that starts over.
//
// His cut-out is made once per reaction (cutout.ts): his frame with the mask
// stacked under it. Each frame here, the mask half is made see-through again
// and he is drawn through it. A sibling of montageRender.ts.

import {
  AudioSample,
  AudioSampleSource,
  canEncodeAudio,
  Mp4OutputFormat,
  Output,
  QUALITY_MEDIUM,
  VideoSample,
  VideoSampleSink,
  VideoSampleSource,
  type InputVideoTrack,
} from 'mediabunny'

import { SilenceCutError } from '../media/errors'
import { contiguousAudio, forwardOnly } from '../media/forwardOnly'
import { createOutputSink } from '../media/outputSink'
import { isSilenceCutSupported } from '../media/silenceCut'
import { eachSound, openClip, wholeOf, writeWhole, type Clip } from './clipParts'
import { onEncodedPacketMatchingColour } from './colourCheck'
import { CUTOUT_HEIGHT, CUTOUT_WIDTH, greyToAlpha } from './cutout'
import { headlineFontReady } from './headlineFont'
import type { VideoLook } from './look'
import { soloMusicGain, verticalSize } from './montageRender'
import { drawHeadline, layoutHeadline } from './overlay'
import { frameRateOf, makeSize, videoQuality } from './quality'
import { cover } from './reaction'
import { Limiter, measureLoudness } from './voice'

const RATE = 48000
const CHANNELS = 2
const MAX_RECOVERIES = 4

export type CornerSide = 'left' | 'right'

export interface Corner {
  side: CornerSide
  /** How wide he is, as a share of the video's width. */
  sizePct: number
}

export const DEFAULT_CORNER: Corner = { side: 'right', sizePct: 38 }
export const CORNER_SIZES = { min: 25, max: 50 }

/** Where he goes on a `width`×`height` frame: in the bottom corner, his
 *  feet (or chest) on the bottom edge, at his own shape. */
export function cornerBox(width: number, height: number, corner: Corner): { x: number; y: number; width: number; height: number } {
  const pct = Math.min(CORNER_SIZES.max, Math.max(CORNER_SIZES.min, corner.sizePct))
  const w = Math.round((width * pct) / 100)
  const h = Math.round((w * CUTOUT_HEIGHT) / CUTOUT_WIDTH)
  return { x: corner.side === 'left' ? 0 : width - w, y: height - h, width: w, height: h }
}

/** The cut-out's frame at each moment of the video, read in order - and from
 *  the start again when the reaction is shorter than the background. */
class CutoutFrames {
  private iterator: AsyncIterator<VideoSample> | null = null
  private current: VideoSample | null = null
  private next: VideoSample | null = null
  private readonly track: InputVideoTrack
  private readonly first: number
  private readonly length: number
  private lastAt = -1

  constructor(track: InputVideoTrack, first: number, length: number) {
    this.track = track
    this.first = first
    this.length = Math.max(0.05, length)
  }

  private async pull(): Promise<VideoSample | null> {
    const step = await this.iterator!.next()
    return step.done ? null : step.value
  }

  private async restart(): Promise<void> {
    await this.dispose()
    this.iterator = new VideoSampleSink(this.track).samples(this.first, this.first + this.length)[Symbol.asyncIterator]()
    this.current = await this.pull()
    this.next = this.current ? await this.pull() : null
  }

  /** His frame for moment `t` of the video. */
  async at(t: number): Promise<VideoSample | null> {
    const into = t % this.length
    if (!this.iterator || into < this.lastAt) await this.restart()
    this.lastAt = into
    while (this.next && this.next.timestamp - this.first <= into) {
      this.current?.close()
      this.current = this.next
      this.next = await this.pull()
    }
    return this.current
  }

  async dispose(): Promise<void> {
    this.current?.close()
    this.next?.close()
    this.current = null
    this.next = null
    await this.iterator?.return?.().catch(() => {})
    this.iterator = null
  }
}

export interface GreenScreenInput {
  /** The campaign's video, playing behind him. Its sound is the video's sound. */
  background: Blob
  /** His reaction, cut out (cutout.ts). */
  cutout: Blob
  /** The headline's look. */
  look: VideoLook
  /** Empty for none. */
  headlineText: string
  corner: Corner
}

export async function renderGreenScreen(
  { background, cutout, look, headlineText, corner }: GreenScreenInput,
  onProgress?: (fraction: number) => void,
): Promise<{ blob: Blob; storedAs: string | null; totalSec: number }> {
  if (!(await isSilenceCutSupported())) {
    throw new SilenceCutError("This browser can't make video yet. Update to the newest iOS/Safari, or use a computer.")
  }
  if (!(await canEncodeAudio('aac', { sampleRate: RATE, numberOfChannels: CHANNELS }))) {
    throw new SilenceCutError("This browser can't write the video's sound. Try Safari or Chrome.")
  }
  const clips: Clip[] = []
  const sink = await createOutputSink()
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: false }), target: sink.target })
  let him: CutoutFrames | null = null
  let finished = false
  try {
    const bg = await openClip(background, 'background')
    clips.push(bg)
    const cut = await openClip(cutout, "reaction's cut-out")
    clips.push(cut)
    const total = Math.max(0.1, bg.duration - bg.first)

    // The background's own sound, set to where TikTok plays things.
    let gain = 1
    if (bg.audio) {
      try {
        const lufs = await measureLoudness(RATE, CHANNELS, (visit) => eachSound(bg, [wholeOf(bg)], RATE, CHANNELS, visit))
        gain = soloMusicGain(lufs) || 1
      } catch {
        gain = 1
      }
    }
    const limiter = new Limiter(RATE, CHANNELS)

    const fps = await frameRateOf(bg.video)
    const { width, height } = makeSize((maxShort) => verticalSize(bg.width, bg.height, maxShort))
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d')
    // His frame and mask as they come, his frame through the mask, and the
    // mask at half size - see-through made from its grey, a quarter of the work.
    const stack = new OffscreenCanvas(CUTOUT_WIDTH, CUTOUT_HEIGHT * 2)
    const stackCtx = stack.getContext('2d')
    const person = new OffscreenCanvas(CUTOUT_WIDTH, CUTOUT_HEIGHT)
    const personCtx = person.getContext('2d')
    const mask = new OffscreenCanvas(CUTOUT_WIDTH / 2, CUTOUT_HEIGHT / 2)
    const maskCtx = mask.getContext('2d', { willReadFrequently: true })
    if (!ctx || !stackCtx || !personCtx || !maskCtx) throw new SilenceCutError("This phone couldn't prepare the canvas for the video.")
    await headlineFontReady()
    const headline = headlineText.trim() ? layoutHeadline(ctx, width, height, { ...look.headline, text: headlineText }) : null
    const place = cover(bg.width, bg.height, width, height)
    const spot = cornerBox(width, height, corner)
    him = new CutoutFrames(cut.video, cut.first, cut.duration - cut.first)

    const videoSource = new VideoSampleSource({ codec: 'avc', quality: videoQuality(width, height, fps), onEncodedPacket: onEncodedPacketMatchingColour })
    const audioSource = new AudioSampleSource({ codec: 'aac', quality: QUALITY_MEDIUM })
    output.addVideoTrack(videoSource)
    output.addAudioTrack(audioSource)
    await output.start()

    const at = await writeWhole(bg, 0, {
      rate: RATE,
      channels: CHANNELS,
      videoClock: forwardOnly(),
      audioClock: contiguousAudio(),
      maxRecoveries: MAX_RECOVERIES,
      onFrame: async (sample, timestamp) => {
        onProgress?.(Math.min(0.99, timestamp / total))
        ctx.fillStyle = '#000'
        ctx.fillRect(0, 0, width, height)
        sample.draw(ctx, place.x, place.y, place.width, place.height)
        const frame = await him!.at(timestamp)
        if (frame) {
          stackCtx.clearRect(0, 0, stack.width, stack.height)
          frame.draw(stackCtx, 0, 0, CUTOUT_WIDTH, CUTOUT_HEIGHT * 2)
          maskCtx.drawImage(stack, 0, CUTOUT_HEIGHT, CUTOUT_WIDTH, CUTOUT_HEIGHT, 0, 0, mask.width, mask.height)
          const pixels = maskCtx.getImageData(0, 0, mask.width, mask.height)
          greyToAlpha(pixels.data)
          maskCtx.putImageData(pixels, 0, 0)
          personCtx.globalCompositeOperation = 'copy'
          personCtx.drawImage(stack, 0, 0, CUTOUT_WIDTH, CUTOUT_HEIGHT, 0, 0, CUTOUT_WIDTH, CUTOUT_HEIGHT)
          personCtx.globalCompositeOperation = 'destination-in'
          personCtx.drawImage(mask, 0, 0, CUTOUT_WIDTH, CUTOUT_HEIGHT)
          personCtx.globalCompositeOperation = 'source-over'
          ctx.drawImage(person, spot.x, spot.y, spot.width, spot.height)
        }
        if (headline && timestamp < look.headline.seconds) drawHeadline(ctx, headline)
        const out = new VideoSample(canvas, { timestamp, duration: sample.duration })
        await videoSource.add(out)
        out.close()
      },
      onSound: async (planes, timestamp) => {
        const length = planes[0].length
        const data = new Float32Array(length * CHANNELS)
        const out = [data.subarray(0, length), data.subarray(length)]
        for (let c = 0; c < CHANNELS; c++) {
          const from = planes[c] ?? planes[0]
          for (let k = 0; k < length; k++) out[c][k] = from[k] * gain
        }
        limiter.process(out)
        const audio = new AudioSample({ data, format: 'f32-planar', numberOfChannels: CHANNELS, sampleRate: RATE, timestamp })
        await audioSource.add(audio)
        audio.close()
      },
    })

    await output.finalize()
    const blob = await sink.finish()
    if (blob.size === 0) throw new SilenceCutError('Making the video finished but produced no file. Try again.')
    finished = true
    onProgress?.(1)
    return { blob, storedAs: sink.storedAs, totalSec: at }
  } finally {
    await him?.dispose().catch(() => {})
    for (const clip of clips) clip.input.dispose()
    if (!finished) {
      await output.cancel().catch(() => {})
      await sink.discard()
    }
  }
}
