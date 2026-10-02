// A video with no talking: his clips one after another - a reaction, then a
// product showcase, or however many he picks - with the headline over the
// first, and nothing heard but the music. The clips' own sound is left out.
//
// The frame is always upright. Each clip is written whole, filling it (its
// edges trimmed if its shape differs), and the phone's decoder giving up
// partway is picked up again from the last frame, as everywhere else
// (clipParts.ts).

import {
  AudioSample,
  AudioSampleSource,
  canEncodeAudio,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  QUALITY_MEDIUM,
  VideoSample,
  VideoSampleSource,
} from 'mediabunny'

import { SilenceCutError } from '../media/errors'
import { contiguousAudio, forwardOnly } from '../media/forwardOnly'
import { createOutputSink } from '../media/outputSink'
import { isSilenceCutSupported } from '../media/silenceCut'
import { openClip, writeWhole, type Clip } from './clipParts'
import { headlineFontReady } from './headlineFont'
import type { VideoLook } from './look'
import { MusicBed, trackLoudness } from './music'
import { drawHeadline, layoutHeadline, outputSize } from './overlay'
import { cover } from './reaction'
import { prepareSound } from './sounds'

const RATE = 48000
const CHANNELS = 2
const MAX_RECOVERIES = 4
/** With nothing else to hear, the music is the sound: a loud master is
 *  brought down to about where TikTok plays things, a quiet one left as it
 *  is - never turned up, so it can never clip. */
const MUSIC_LUFS = -14

export interface MontageRenderInput {
  clips: Blob[]
  /** The headline's look; the logo, pictures and effects are not used. */
  look: VideoLook
  headlineText: string
  music: { audio: Blob; name: string } | null
}

export interface MontageRenderResult {
  blob: Blob
  storedAs: string | null
  /** How long each clip came out, in order. */
  seconds: number[]
  totalSec: number
  /** Why the music couldn't go on, when it couldn't. */
  musicFailed?: string
}

/** The finished video's frame: the first clip's own when it is upright -
 *  a phone video, a screen recording - and a 1080x1920 one when it lies on
 *  its side, so a landscape reaction still makes a video for TikTok and
 *  Reels, filled edge to edge. */
export function verticalSize(width: number, height: number): { width: number; height: number } {
  return height > width ? outputSize(width, height) : { width: 1080, height: 1920 }
}

/** The linear gain that puts a track at MUSIC_LUFS, never above 1. */
export function soloMusicGain(trackLufs: number): number {
  if (!Number.isFinite(trackLufs)) return 0
  return Math.min(1, 10 ** ((MUSIC_LUFS - trackLufs) / 20))
}

export async function renderMontage(
  { clips: files, look, headlineText, music }: MontageRenderInput,
  onProgress?: (fraction: number) => void,
): Promise<MontageRenderResult> {
  if (files.length === 0) throw new SilenceCutError('Add at least one clip.')
  if (!(await isSilenceCutSupported())) {
    throw new SilenceCutError("This browser can't make video yet. Update to the newest iOS/Safari, or use a computer.")
  }
  if (!(await canEncodeAudio('aac', { sampleRate: RATE, numberOfChannels: CHANNELS }))) {
    throw new SilenceCutError("This browser can't write the video's sound. Try Safari or Chrome.")
  }

  const clips: Clip[] = []
  const sink = await createOutputSink()
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: false }), target: sink.target })
  let finished = false
  try {
    for (const [i, file] of files.entries()) clips.push(await openClip(file, `number ${i + 1}`))
    const total = clips.reduce((sum, c) => sum + (c.duration - c.first), 0)

    let bed: MusicBed | null = null
    let musicFailed: string | undefined
    if (music) {
      try {
        const track = await prepareSound({ kind: 'file', name: music.name, audio: music.audio }, RATE)
        const needed = Math.ceil(total * RATE) + RATE
        const channels = track.channels.map((c) => (c.length > needed ? c.slice(0, needed) : c))
        const gain = soloMusicGain(trackLoudness(channels, RATE))
        // Nothing else is heard, so nothing ever dips it.
        if (gain > 0) bed = new MusicBed(channels, RATE, Math.round(total * RATE), gain, Infinity)
        else musicFailed = 'the track is silent'
      } catch (error) {
        musicFailed = error instanceof Error ? error.message : String(error)
      }
    }

    const { width, height } = verticalSize(clips[0].width, clips[0].height)
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new SilenceCutError("This browser couldn't prepare a canvas to draw the headline on.")
    await headlineFontReady()
    const headline = headlineText.trim() ? layoutHeadline(ctx, width, height, { ...look.headline, text: headlineText }) : null

    const videoSource = new VideoSampleSource({ codec: 'avc', quality: QUALITY_HIGH })
    const audioSource = new AudioSampleSource({ codec: 'aac', quality: QUALITY_MEDIUM })
    output.addVideoTrack(videoSource)
    output.addAudioTrack(audioSource)
    await output.start()

    const videoClock = forwardOnly()
    const audioClock = contiguousAudio()
    const seconds: number[] = []
    let at = 0
    for (const [i, clip] of clips.entries()) {
      const place = cover(clip.width, clip.height, width, height)
      const start = at
      at = await writeWhole(clip, at, {
        rate: RATE,
        channels: CHANNELS,
        videoClock,
        audioClock,
        maxRecoveries: MAX_RECOVERIES,
        onFrame: async (sample, timestamp) => {
          onProgress?.(Math.min(0.99, timestamp / total))
          ctx.fillStyle = '#000'
          ctx.fillRect(0, 0, width, height)
          sample.draw(ctx, place.x, place.y, place.width, place.height)
          if (i === 0 && headline) drawHeadline(ctx, headline)
          const frame = new VideoSample(canvas, { timestamp, duration: sample.duration })
          await videoSource.add(frame)
          frame.close()
        },
        // The clip's own sound only keeps time: what goes in is the music.
        onSound: async (planes, timestamp) => {
          const length = planes[0].length
          const data = new Float32Array(length * CHANNELS)
          const out = [data.subarray(0, length), data.subarray(length)]
          bed?.mixInto(out, Math.round(timestamp * RATE))
          for (const plane of out) for (let k = 0; k < plane.length; k++) plane[k] = Math.max(-1, Math.min(1, plane[k]))
          const sample = new AudioSample({ data, format: 'f32-planar', numberOfChannels: CHANNELS, sampleRate: RATE, timestamp })
          await audioSource.add(sample)
          sample.close()
        },
      })
      seconds.push(at - start)
    }

    await output.finalize()
    const blob = await sink.finish()
    if (blob.size === 0) throw new SilenceCutError('Making the video finished but produced no file. Try again.')
    finished = true
    onProgress?.(1)
    return { blob, storedAs: sink.storedAs, seconds, totalSec: at, ...(musicFailed ? { musicFailed } : {}) }
  } finally {
    for (const clip of clips) clip.input.dispose()
    if (!finished) {
      await output.cancel().catch(() => {})
      await sink.discard()
    }
  }
}
