// A split screen video (splitScreen.ts): two halves, one above the other.
// The hook - his reaction on top, a match clip under it - lasts as long as
// the match clip; the body - him at the computer on top, the product under
// it - as long as the product. Each half's clip fills its half (cropped to
// it). The bottom clips drive the frames; the top ones are read alongside
// (his reaction held on its last frame if it is shorter, the computer clip
// started over).
//
// The sound is mixed once, before the frames: the match clip's own sound
// (the cha-ching is in it), then the product's (typing...); his voice over
// the hook, brought well up; the song under the whole of it, its beat drop
// on the goal - the sharpest rise in the match clip's sound. A sibling of
// greenScreenRender.ts.

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
import { MAX_RECOVERIES } from '../media/recovery'
import { MAX_CHANNELS, SAFE_SAMPLE_RATE, isSilenceCutSupported } from '../media/silenceCut'
import { songStart } from './beatDrop'
import { eachSound, openClip, writeWhole, type Clip } from './clipParts'
import { onEncodedPacketMatchingColour } from './colourCheck'
import { HEADLINE_FAMILY, headlineFontReady } from './headlineFont'
import type { VideoLook } from './look'
import { FPS, framesBy, soloMusicGain, verticalSize } from './montageRender'
import { trackLoudness } from './music'
import { drawHeadline, layoutHeadline } from './overlay'
import { makeSize, videoQuality } from './quality'
import { cover } from './reaction'
import { prepareMusic } from './sounds'
import { goalIn, lineAt, type SplitLine } from './splitScreen'
import { Limiter } from './voice'

const RATE = SAFE_SAMPLE_RATE
const CHANNELS = MAX_CHANNELS

/** His voice in the hook: louder than a talking video's (-14) - "turned up"
 *  so his panic before the goal is heard over everything. */
const VOICE_LUFS = -10
/** The clips' own sound (the cha-ching, the typing), a little under the usual. */
const CLIP_SHARE = 0.8
/** The song under it all. */
const MUSIC_SHARE = 0.4
/** Where the goal is when nothing stands out in the match clip's sound: this
 *  share of the way through it. */
const GOAL_GUESS = 0.66

export interface SplitInput {
  /** His reaction: the hook's top half, his voice kept. */
  reaction: Blob
  /** The match clip under it. */
  under: Blob
  /** Him at the computer: the body's top half. */
  desk: Blob
  /** The product playthrough under him. */
  product: Blob
  music: { audio: Blob; name: string; drop: number | null } | null
  look: VideoLook
  /** The title over the hook; empty for none. */
  headlineText: string
  lines: SplitLine[]
  /** "+$586.68 US", popping up on the goal. */
  amount: string
  reactionName?: string
}

/** A top-half clip's frame at each moment, read in order: held on its last
 *  frame when shorter (`loop` false), or started over. */
class TopFrames {
  private iterator: AsyncIterator<VideoSample> | null = null
  private current: VideoSample | null = null
  private next: VideoSample | null = null
  private lastAt = -1
  private readonly track: InputVideoTrack
  private readonly first: number
  private readonly length: number
  private readonly loop: boolean

  constructor(track: InputVideoTrack, first: number, length: number, loop: boolean) {
    this.track = track
    this.first = first
    this.length = length
    this.loop = loop
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

  async at(t: number): Promise<VideoSample | null> {
    const into = this.loop ? t % Math.max(0.05, this.length) : Math.min(t, this.length)
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

/** A clip's whole sound, `frames` long (silence past its end). */
async function soundOf(clip: Clip, frames: number): Promise<Float32Array[]> {
  const out = Array.from({ length: CHANNELS }, () => new Float32Array(frames))
  if (!clip.audio && !clip.hasSound) return out
  let at = 0
  await eachSound(clip, [{ start: clip.first, end: clip.duration }], RATE, CHANNELS, (planes) => {
    const n = Math.min(planes[0].length, frames - at)
    if (n <= 0) return
    for (let c = 0; c < CHANNELS; c++) out[c].set((planes[c] ?? planes[0]).subarray(0, n), at)
    at += n
  }).catch(() => undefined)
  return out
}

/** Loudness levels (RMS) of a sound in windows `step` seconds long. */
export function levelsOf(planes: Float32Array[], rate: number, step = 0.05): number[] {
  const size = Math.max(1, Math.round(rate * step))
  const length = planes[0]?.length ?? 0
  const out: number[] = []
  for (let i = 0; i + size <= length; i += size) {
    let sum = 0
    for (const plane of planes) for (let k = i; k < i + size; k++) sum += plane[k] * plane[k]
    out.push(Math.sqrt(sum / (size * planes.length)))
  }
  return out
}

/** Adds `from` into `into` at `at` frames, times `gain`. */
function mixIn(into: Float32Array[], from: Float32Array[], at: number, gain: number): void {
  if (!(gain > 0)) return
  for (let c = 0; c < into.length; c++) {
    const src = from[c] ?? from[0]
    if (!src) continue
    const n = Math.min(src.length, into[c].length - at)
    for (let k = 0; k < n; k++) into[c][at + k] += src[k] * gain
  }
}

const gainTo = (planes: Float32Array[], lufs: number, most: number) => {
  const now = trackLoudness(planes, RATE)
  return Number.isFinite(now) ? Math.min(most, 10 ** ((lufs - now) / 20)) : 0
}

/** The amount's pop: small to full size in its first moments. */
export function popScale(since: number): number {
  if (since <= 0) return 0
  if (since >= 0.18) return 1
  const p = since / 0.18
  return 0.5 + 0.62 * p - 0.12 * p * p
}

export async function renderSplit(input: SplitInput, onProgress?: (fraction: number) => void): Promise<{ blob: Blob; storedAs: string | null; totalSec: number; goalAt: number; musicFailed?: string }> {
  if (!(await isSilenceCutSupported())) {
    throw new SilenceCutError("This browser can't make video yet. Update to the newest iOS/Safari, or use a computer.")
  }
  if (!(await canEncodeAudio('aac', { sampleRate: RATE, numberOfChannels: CHANNELS }))) {
    throw new SilenceCutError("This browser can't write the video's sound. Try Safari or Chrome.")
  }
  const clips: Clip[] = []
  const tops: TopFrames[] = []
  const sink = await createOutputSink()
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: false }), target: sink.target })
  let finished = false
  try {
    const reaction = await openClip(input.reaction, 'reaction')
    const under = await openClip(input.under, 'match clip')
    const desk = await openClip(input.desk, 'computer clip')
    const product = await openClip(input.product, 'product')
    clips.push(reaction, under, desk, product)
    const lengthOf = (clip: Clip) => Math.max(0.1, clip.duration - clip.first)
    const hook = lengthOf(under)
    const total = hook + lengthOf(product)
    const frames = Math.ceil(total * RATE)

    // The sound, mixed once.
    const underSound = await soundOf(under, Math.ceil(hook * RATE))
    const goalAt = goalIn(levelsOf(underSound, RATE), 0.05) ?? hook * GOAL_GUESS
    const productSound = await soundOf(product, frames - underSound[0].length)
    const voice = await soundOf(reaction, underSound[0].length)
    const mix = Array.from({ length: CHANNELS }, () => new Float32Array(frames))
    mixIn(mix, underSound, 0, gainTo(underSound, -14, 8) * CLIP_SHARE)
    mixIn(mix, productSound, underSound[0].length, gainTo(productSound, -14, 8) * CLIP_SHARE)
    mixIn(mix, voice, 0, gainTo(voice, VOICE_LUFS, 16))
    let musicFailed: string | undefined
    if (input.music) {
      try {
        // The drop on the goal: the song starts that much before it.
        const from = input.music.drop ? songStart(input.music.drop, goalAt) : 0
        const { channels } = await prepareMusic(input.music.audio, input.music.name, total, RATE, from)
        const gain = soloMusicGain(trackLoudness(channels, RATE)) * MUSIC_SHARE
        if (gain > 0) {
          // Round again when the song is shorter than the video, faded out at the end.
          const song = channels
          const fade = Math.round(RATE * 0.6)
          for (let at = 0; at < frames && song[0].length > 0; at += song[0].length) mixIn(mix, song, at, gain)
          for (let c = 0; c < CHANNELS; c++) for (let k = Math.max(0, frames - fade); k < frames; k++) mix[c][k] *= (frames - k) / fade
        } else musicFailed = 'the track is silent'
      } catch (error) {
        musicFailed = error instanceof Error ? error.message : String(error)
      }
    }
    const limiter = new Limiter(RATE, CHANNELS)
    for (let at = 0; at < frames; at += RATE) limiter.process(mix.map((p) => p.subarray(at, Math.min(frames, at + RATE))))

    const { width, height } = makeSize((maxShort) => verticalSize(1080, 1920, maxShort))
    const half = Math.round(height / 2)
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new SilenceCutError("This phone couldn't prepare the canvas for the video.")
    await headlineFontReady()
    // The title over his half, near its top.
    const title = input.headlineText.trim() ? layoutHeadline(ctx, width, height, { ...input.look.headline, text: input.headlineText, place: null }) : null
    tops.push(new TopFrames(reaction.video, reaction.first, lengthOf(reaction), false), new TopFrames(desk.video, desk.first, lengthOf(desk), true))
    const [him, atDesk] = tops

    const videoSource = new VideoSampleSource({ codec: 'avc', quality: videoQuality(width, height, FPS), onEncodedPacket: onEncodedPacketMatchingColour })
    const audioSource = new AudioSampleSource({ codec: 'aac', quality: QUALITY_MEDIUM })
    output.addVideoTrack(videoSource)
    output.addAudioTrack(audioSource)
    await output.start()

    let soundAt = 0
    const soundTo = async (end: number) => {
      const until = Math.min(frames, Math.round(end * RATE))
      while (soundAt < until) {
        const length = Math.min(RATE / 10, until - soundAt)
        const data = new Float32Array(length * CHANNELS)
        for (let c = 0; c < CHANNELS; c++) data.set(mix[c].subarray(soundAt, soundAt + length), c * length)
        const sample = new AudioSample({ data, format: 'f32-planar', numberOfChannels: CHANNELS, sampleRate: RATE, timestamp: soundAt / RATE })
        try {
          await audioSource.add(sample)
        } finally {
          sample.close()
        }
        soundAt += length
      }
    }

    const fill = (frame: { draw: (c: OffscreenCanvasRenderingContext2D, x: number, y: number, w: number, h: number) => void } | null, w: number, h: number, y: number, rect: { width: number; height: number }) => {
      if (!frame) return
      const place = cover(rect.width, rect.height, w, h)
      ctx.save()
      ctx.beginPath()
      ctx.rect(0, y, w, h)
      ctx.clip()
      frame.draw(ctx, place.x, y + place.y, place.width, place.height)
      ctx.restore()
    }

    const drawAmount = (since: number) => {
      const scale = popScale(since)
      if (scale <= 0) return
      const size = Math.round(width * 0.105)
      ctx.save()
      ctx.translate(width * 0.46, half * 0.78)
      ctx.rotate(-0.16)
      ctx.scale(scale, scale)
      ctx.font = `900 ${size}px ${HEADLINE_FAMILY}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.lineJoin = 'round'
      ctx.lineWidth = size * 0.16
      ctx.strokeStyle = '#0b2b12'
      ctx.strokeText(input.amount, 0, 0)
      ctx.fillStyle = '#7CFC6A'
      ctx.fillText(input.amount, 0, 0)
      ctx.restore()
    }

    const drawLine = (text: string) => {
      const size = Math.round(width * 0.046)
      ctx.save()
      ctx.font = `700 ${size}px ${HEADLINE_FAMILY}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      let fit = size
      while (fit > 20 && ctx.measureText(text).width > width * 0.92) {
        fit -= 2
        ctx.font = `700 ${fit}px ${HEADLINE_FAMILY}`
      }
      const band = Math.round(fit * 1.7)
      ctx.fillStyle = 'rgba(0,0,0,0.92)'
      ctx.fillRect(0, half - band / 2, width, band)
      ctx.fillStyle = '#fff'
      ctx.fillText(text, width / 2, half)
      ctx.restore()
    }

    // One frame: the bottom clip's frame then, the top one's, the words.
    const draw = async (sample: VideoSample, size: { width: number; height: number }, timestamp: number) => {
      onProgress?.(Math.min(0.99, timestamp / total))
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, width, height)
      fill(sample, width, height - half, half, size)
      const inHook = timestamp < hook
      const top = inHook ? await him.at(timestamp) : await atDesk.at(timestamp - hook)
      const topClip = inHook ? reaction : desk
      fill(top, width, half, 0, topClip)
      if (inHook) {
        if (title) drawHeadline(ctx, title)
        if (timestamp >= goalAt) drawAmount(timestamp - goalAt)
      } else {
        const line = lineAt(input.lines, timestamp - hook)
        if (line) drawLine(line)
      }
      const out = new VideoSample(canvas, { timestamp, duration: 1 / FPS })
      await videoSource.add(out)
      out.close()
      await soundTo(timestamp + 1 / FPS)
    }

    let made = 0
    let shown: { sample: VideoSample; size: { width: number; height: number } } | null = null
    try {
      const videoClock = forwardOnly()
      const audioClock = contiguousAudio()
      let at = 0
      for (const clip of [under, product]) {
        const size = { width: clip.width, height: clip.height }
        at = await writeWhole(clip, at, {
          rate: RATE,
          channels: CHANNELS,
          videoClock,
          audioClock,
          maxRecoveries: MAX_RECOVERIES,
          onFrame: async (sample, timestamp) => {
            const before = shown ?? { sample, size }
            for (const by = framesBy(timestamp, FPS); made < by; made++) await draw(before.sample, before.size, made / FPS)
            shown?.sample.close()
            shown = { sample: sample.clone(), size }
          },
        })
        // The product starts right where the hook ends, as planned.
        if (clip === under) at = Math.max(at, hook)
      }
      const last = shown as { sample: VideoSample; size: { width: number; height: number } } | null
      if (last) for (const by = framesBy(Math.min(at, total), FPS); made < by; made++) await draw(last.sample, last.size, made / FPS)
      await soundTo(made / FPS)
      await output.finalize()
      const blob = await sink.finish()
      if (blob.size === 0) throw new SilenceCutError('Making the video finished but produced no file. Try again.')
      finished = true
      onProgress?.(1)
      return { blob, storedAs: sink.storedAs, totalSec: made / FPS, goalAt, ...(musicFailed ? { musicFailed } : {}) }
    } finally {
      ;(shown as { sample: VideoSample } | null)?.sample.close()
    }
  } finally {
    for (const top of tops) await top.dispose().catch(() => {})
    for (const clip of clips) clip.input.dispose()
    if (!finished) {
      await output.cancel().catch(() => {})
      await sink.discard()
    }
  }
}
