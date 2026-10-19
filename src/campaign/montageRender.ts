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
  QUALITY_MEDIUM,
  VideoSample,
  VideoSampleSource,
} from 'mediabunny'

import { SilenceCutError } from '../media/errors'
import { contiguousAudio, forwardOnly } from '../media/forwardOnly'
import { createOutputSink } from '../media/outputSink'
import { isSilenceCutSupported } from '../media/silenceCut'
import { openClip, writeWhole, type Clip } from './clipParts'
import { framingAt, planMotion, randomFrom, reactionZoom, zoomPlace } from './effects'
import { ONLY_HOOK_ELSE } from './batch'
import { drawFormula, formulaPush, layoutFormula } from './formulaOverlay'
import { headlineFontReady } from './headlineFont'
import type { VideoLook } from './look'
import { MusicBed, trackLoudness } from './music'
import { Limiter } from './voice'
import { drawHeadline, layoutHeadline, outputSize } from './overlay'
import { frameRateOf, makeSize, videoQuality } from './quality'
import { cover } from './reaction'
import { fitShowcase, pickPiece, readActivity } from './stepPiece'
import { musicProblem, prepareMusic } from './sounds'
import { report as reportProblem } from '../report'
import { onEncodedPacketMatchingColour } from './colourCheck'

const RATE = 48000
const CHANNELS = 2
const MAX_RECOVERIES = 4
/** With nothing else to hear, the music is the sound: every song is set to
 *  about where TikTok plays things - a loud master brought down, a quiet one
 *  brought up, its peaks held under a limiter so it never clips. A quiet
 *  song used to be left as it was, and in a batch some came out barely
 *  there: "just play the song no matter if it's quiet". */
const MUSIC_LUFS = -14
/** The most a quiet song is turned up - 24 dB - so a near-silent one stays
 *  a quiet song, not a wall of hiss. */
const MAX_LIFT = 10 ** (24 / 20)

export interface MontageRenderInput {
  clips: Blob[]
  /** The headline's look; the logo, pictures and effects are not used. */
  look: VideoLook
  headlineText: string
  music: { audio: Blob; name: string } | null
  /** Makes this video's effect variations its own (look.effects says which). */
  seed?: string
  /** The "Claude + X = $ a day" hook instead of a headline: the two logos,
   *  and this video's money line. The reaction pushes in slowly under it. */
  formula?: { left: Blob | null; right: Blob | null; line: string } | null
  /** Per clip, in order: true to play only the moment something happens in
   *  it (a batch's product steps, stepPiece.ts); false, or absent, for all
   *  of it. */
  windows?: boolean[]
  /** The first clip is his reaction (a batch): it slowly pushes in for its
   *  whole length, whatever the angle's effects (effects.reactionZoom). */
  reactionFirst?: boolean
  /** Per clip, in order: words over all of it in the headline's look - a
   *  batch's product step, its name (batch.stepTitle); null or absent for
   *  none. */
  titles?: (string | null)[]
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
export function verticalSize(width: number, height: number, maxShort = 2160): { width: number; height: number } {
  if (height > width) return outputSize(width, height, maxShort)
  const short = Math.max(1080, height)
  return outputSize(short, (short * 16) / 9, maxShort)
}

/** The linear gain that puts a track at MUSIC_LUFS, up or down. */
export function soloMusicGain(trackLufs: number): number {
  if (!Number.isFinite(trackLufs)) return 0
  return Math.min(MAX_LIFT, 10 ** ((MUSIC_LUFS - trackLufs) / 20))
}

/** `channels` at `gain`, in place, under the voice's limiter so a song
 *  turned up keeps its peaks under full scale. */
/** The sound of a batch video: the music alone, laid over the finished
 *  video as one unbroken track from its first moment to its last - nothing
 *  to do with where the clips change (cut per clip, it dropped out at every
 *  change: a pop). Each call writes it on up to `end` seconds. It is written
 *  as the picture goes, never after it: the file is written as it is made,
 *  and held back to the end it would keep every frame in memory first. */
export function musicTrack(bed: Pick<MusicBed, 'mixInto'> | null, add: (sample: AudioSample) => Promise<void>): (end: number) => Promise<void> {
  let at = 0
  return async (end) => {
    const until = Math.round(end * RATE)
    while (at < until) {
      const length = Math.min(RATE / 10, until - at)
      const data = new Float32Array(length * CHANNELS)
      const out = Array.from({ length: CHANNELS }, (_, c) => data.subarray(c * length, (c + 1) * length))
      bed?.mixInto(out, at)
      for (const plane of out) for (let k = 0; k < plane.length; k++) plane[k] = Math.max(-1, Math.min(1, plane[k]))
      const sample = new AudioSample({ data, format: 'f32-planar', numberOfChannels: CHANNELS, sampleRate: RATE, timestamp: at / RATE })
      try {
        await add(sample)
      } finally {
        sample.close()
      }
      at += length
    }
  }
}

export function liftMusic(channels: Float32Array[], gain: number, sampleRate: number): void {
  for (const c of channels) for (let i = 0; i < c.length; i++) c[i] *= gain
  new Limiter(sampleRate, channels.length).process(channels)
}

export async function renderMontage(
  { clips: files, look, headlineText, music, seed = '', formula = null, windows = [], reactionFirst = false, titles = [] }: MontageRenderInput,
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
  let logos: { left: ImageBitmap | null; right: ImageBitmap | null } | null = null
  try {
    for (const [i, file] of files.entries()) clips.push(await openClip(file, `number ${i + 1}`))
    // The part of each clip that plays: a step's moment, found in the clip
    // and picked with this video's own seed, or all of it.
    const random = randomFrom(`${seed || 'montage'}-steps`)
    const parts: { start: number; end: number }[] = []
    for (const [i, clip] of clips.entries()) {
      if (!windows[i]) {
        parts.push({ start: clip.first, end: clip.duration })
        continue
      }
      // Unreadable sizes only mean no moment is found: a random couple of
      // seconds plays instead.
      const activity = await readActivity(clip.video, clip.first, clip.duration).catch(() => null)
      parts.push(pickPiece(activity, clip.first, clip.duration, random))
    }
    const stepped = parts.flatMap((_, i) => (windows[i] ? [i] : []))
    fitShowcase(stepped.map((i) => parts[i])).forEach((piece, k) => (parts[stepped[k]] = piece))
    const total = parts.reduce((sum, p) => sum + (p.end - p.start), 0)

    let bed: MusicBed | null = null
    let musicFailed: string | undefined
    if (music) {
      try {
        // Only as much of the song as the video uses is decoded (sounds.ts).
        const { channels } = await prepareMusic(music.audio, music.name, total, RATE)
        const gain = soloMusicGain(trackLoudness(channels, RATE))
        if (gain > 0) {
          liftMusic(channels, gain, RATE)
          // Nothing else is heard, so nothing ever dips it.
          bed = new MusicBed(channels, RATE, Math.round(total * RATE), 1, Infinity)
        }
        else musicFailed = 'the track is silent'
      } catch (error) {
        musicFailed = error instanceof Error ? error.message : String(error)
      }
      if (musicFailed) reportProblem({ kind: 'fallback', phase: 'music', message: musicProblem(new Error(musicFailed), music.audio) })
    }

    // 1080p at its own frame rate, at a bitrate to match (quality.ts).
    const fps = await frameRateOf(clips[0].video)
    const { width, height } = makeSize((maxShort) => verticalSize(clips[0].width, clips[0].height, maxShort))
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new SilenceCutError("This browser couldn't prepare a canvas to draw the headline on.")
    await headlineFontReady()
    const headline = !formula && headlineText.trim() ? layoutHeadline(ctx, width, height, { ...look.headline, text: headlineText }) : null
    // Each step's name over its clip, laid out once - always in the outline
    // look: Snapchat (and the white box) is for the hook alone.
    const titleLayouts = clips.map((_, i) => (titles[i]?.trim() ? layoutHeadline(ctx, width, height, { ...look.headline, style: ONLY_HOOK_ELSE, text: titles[i]! }) : null))
    // The formula's logos, decoded once for every frame.
    const decode = async (blob: Blob | null) => {
      if (!blob) return null
      try {
        return await createImageBitmap(blob)
      } catch {
        throw new SilenceCutError("One of the hook's logos couldn't be read. Pick it again as a PNG or JPG.")
      }
    }
    logos = formula ? { left: await decode(formula.left), right: await decode(formula.right) } : null
    const formulaLayout =
      formula && logos
        ? layoutFormula(ctx, width, height, { left: logos.left, right: logos.right }, formula.line, { ...look.headline, style: ONLY_HOOK_ELSE })
        : null

    const videoSource = new VideoSampleSource({ codec: 'avc', quality: videoQuality(width, height, fps), onEncodedPacket: onEncodedPacketMatchingColour })
    const audioSource = new AudioSampleSource({ codec: 'aac', quality: QUALITY_MEDIUM })
    output.addVideoTrack(videoSource)
    output.addAudioTrack(audioSource)
    await output.start()

    // Zoom effects: each clip is a stretch, so a punch can land at every cut.
    const motion = planMotion(look.effects, parts.map((p) => Math.max(0.1, p.end - p.start)), seed || 'montage')
    const videoClock = forwardOnly()
    const soundTo = musicTrack(bed, (sample) => audioSource.add(sample))
    const seconds: number[] = []
    let at = 0
    for (const [i, clip] of clips.entries()) {
      const place = cover(clip.width, clip.height, width, height)
      const start = at
      const length = Math.max(0.1, parts[i].end - parts[i].start)
      at = await writeWhole(clip, at, {
        window: windows[i] ? parts[i] : undefined,
        rate: RATE,
        channels: CHANNELS,
        videoClock,
        audioClock: contiguousAudio(),
        maxRecoveries: MAX_RECOVERIES,
        onFrame: async (sample, timestamp) => {
          onProgress?.(Math.min(0.99, timestamp / total))
          ctx.fillStyle = '#000'
          ctx.fillRect(0, 0, width, height)
          // Under the formula, the reaction pushes in slowly for its whole
          // length instead of the usual opening push.
          // A batch's reaction always pushes in slowly too, or the angle's
          // own push-in where that is closer.
          const own = framingAt(motion, i, timestamp - start, [])
          const framing =
            i === 0 && formulaLayout
              ? formulaPush(timestamp - start, length)
              : i === 0 && reactionFirst
                ? { ...own, scale: Math.max(own.scale, reactionZoom(timestamp - start, length)) }
                : own
          const spot = zoomPlace(place, framing, width, height)
          sample.draw(ctx, spot.x, spot.y, spot.width, spot.height)
          if (i === 0 && headline) drawHeadline(ctx, headline)
          const title = titleLayouts[i]
          if (title) drawHeadline(ctx, title)
          if (i === 0 && formulaLayout && logos) drawFormula(ctx, formulaLayout, logos)
          const frame = new VideoSample(canvas, { timestamp, duration: sample.duration })
          await videoSource.add(frame)
          frame.close()
          // The music keeps up with the picture, in one piece.
          await soundTo(timestamp + sample.duration)
        },
      })
      seconds.push(at - start)
    }
    // To the very end of the last frame.
    await soundTo(at)

    await output.finalize()
    const blob = await sink.finish()
    if (blob.size === 0) throw new SilenceCutError('Making the video finished but produced no file. Try again.')
    finished = true
    onProgress?.(1)
    return { blob, storedAs: sink.storedAs, seconds, totalSec: at, ...(musicFailed ? { musicFailed } : {}) }
  } finally {
    logos?.left?.close()
    logos?.right?.close()
    for (const clip of clips) clip.input.dispose()
    if (!finished) {
      await output.cancel().catch(() => {})
      await sink.discard()
    }
  }
}
