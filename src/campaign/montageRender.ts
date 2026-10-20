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
import { drawFormula, formulaPush, layoutFormula, type FormulaLayout } from './formulaOverlay'
import { headlineFontReady } from './headlineFont'
import type { VideoLook } from './look'
import { MusicBed, trackLoudness } from './music'
import { Limiter } from './voice'
import { TIKTOK_ZONES, drawHeadline, layoutHeadline, outputSize, type HeadlineLayout, type LogoLayout } from './overlay'
import { makeSize, videoQuality } from './quality'
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
/** Frames a second of every video made here, steady from its first moment.
 *  The clips' own frames came through as they were - a screen recording's
 *  uneven ones, a reaction at another rate, a first frame late - and posted,
 *  some batch videos stuttered at the start, though they played smoothly
 *  here: the platforms re-encode to a steady rate, and an uneven start is
 *  where that shows. */
export const FPS = 30
/** A batch video's words - the hook, the step names, Claude + X - sit this
 *  much lower than the angle puts its headline, as a share of the height:
 *  "i want the text to be a little lower". */
export const BATCH_LOWER = 0.04

/** How many frames of a steady `fps` start before `until` seconds - the ones
 *  a clip's frame starting there takes over from. */
/** What was wrong with how the first clip's frames came at the start of the
 *  video - held on its first frame, or a gap of several frames - in words,
 *  or null when they came steadily. */
export function openingProblem(opening: readonly { own: number; at: number }[]): string | null {
  if (opening.length === 0) return 'no frame in its first second and a half'
  const held = opening[0].at
  const gaps = opening.slice(1).map((f, k) => f.at - opening[k].at)
  const worst = gaps.length ? Math.max(...gaps) : 0
  if (held <= 0.07 && worst <= 0.1) return null
  const ms = (s: number) => `${Math.round(s * 1000)} ms`
  const own = opening.slice(0, 12).map((f) => Math.round(f.own * 1000)).join(' ')
  return `first frame at ${ms(held)}, longest gap ${ms(worst)}, ${opening.length} frames in 1.5 s; its own times ${own}`
}

export function framesBy(until: number, fps: number): number {
  return Math.max(0, Math.ceil(until * fps - 1e-6))
}

/** A headline moved BATCH_LOWER down, never into the caption at the bottom. */
export function lowered(layout: HeadlineLayout | null, height: number): HeadlineLayout | null {
  if (!layout) return null
  const room = height * (1 - TIKTOK_ZONES.bottom) - (layout.top + layout.lines.length * layout.lineHeight)
  return { ...layout, top: layout.top + Math.max(0, Math.min(height * BATCH_LOWER, room)) }
}

/** Claude + X's logos and money line moved BATCH_LOWER down together. */
function loweredFormula(layout: FormulaLayout | null, height: number): FormulaLayout | null {
  if (!layout) return null
  const dy = height * BATCH_LOWER
  const down = (logo: LogoLayout | null) => (logo ? { ...logo, y: logo.y + dy } : null)
  return {
    left: down(layout.left),
    right: down(layout.right),
    plus: { ...layout.plus, y: layout.plus.y + dy },
    line: layout.line ? { ...layout.line, top: layout.line.top + dy } : null,
  }
}

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

    // 1080p at a steady FPS, at a bitrate to match (quality.ts).
    const { width, height } = makeSize((maxShort) => verticalSize(clips[0].width, clips[0].height, maxShort))
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new SilenceCutError("This browser couldn't prepare a canvas to draw the headline on.")
    await headlineFontReady()
    // A batch's words sit a little lower (BATCH_LOWER).
    const place = (layout: HeadlineLayout | null) => (reactionFirst ? lowered(layout, height) : layout)
    const headline = place(!formula && headlineText.trim() ? layoutHeadline(ctx, width, height, { ...look.headline, text: headlineText }) : null)
    // Each step's name over its clip, laid out once - always in the outline
    // look: Snapchat (and the white box) is for the hook alone.
    const titleLayouts = clips.map((_, i) =>
      place(titles[i]?.trim() ? layoutHeadline(ctx, width, height, { ...look.headline, style: ONLY_HOOK_ELSE, text: titles[i]! }) : null),
    )
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
    const laidFormula =
      formula && logos
        ? layoutFormula(ctx, width, height, { left: logos.left, right: logos.right }, formula.line, { ...look.headline, style: ONLY_HOOK_ELSE })
        : null
    const formulaLayout = reactionFirst ? loweredFormula(laidFormula, height) : laidFormula

    const videoSource = new VideoSampleSource({ codec: 'avc', quality: videoQuality(width, height, FPS), onEncodedPacket: onEncodedPacketMatchingColour })
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
    // Frames written so far, at a steady FPS. Each steady frame shows the
    // clip's frame on screen at that moment - the last one starting at or
    // before it - read off the frames' own timestamps alone: a 60 fps screen
    // recording's every other frame, a slower clip's twice, a first frame that
    // came late from the very start. Never off a frame's duration, which a
    // file can state wrong and which had frames skipped or held too long.
    let made = 0
    // The frame on screen until the next one starts, kept past its own turn.
    let shown: { sample: VideoSample; clip: number } | null = null
    // When the first clip's frames came, in its own time and in the video's,
    // for its first second and a half: a start that froze or lagged says so.
    const opening: { own: number; at: number }[] = []
    const stretches: { fill: ReturnType<typeof cover>; start: number; length: number }[] = []
    const frameAt = async (sample: VideoSample, i: number, t: number) => {
      const { fill, start, length } = stretches[i]
      onProgress?.(Math.min(0.99, t / total))
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, width, height)
      // Under the formula, the reaction pushes in slowly for its whole
      // length instead of the usual opening push.
      // A batch's reaction always pushes in slowly too, or the angle's
      // own push-in where that is closer.
      const own = framingAt(motion, i, t - start, [])
      const framing =
        i === 0 && formulaLayout
          ? formulaPush(t - start, length)
          : i === 0 && reactionFirst
            ? { ...own, scale: Math.max(own.scale, reactionZoom(t - start, length)) }
            : own
      const spot = zoomPlace(fill, framing, width, height)
      sample.draw(ctx, spot.x, spot.y, spot.width, spot.height)
      if (i === 0 && headline) drawHeadline(ctx, headline)
      const title = titleLayouts[i]
      if (title) drawHeadline(ctx, title)
      if (i === 0 && formulaLayout && logos) drawFormula(ctx, formulaLayout, logos)
      const frame = new VideoSample(canvas, { timestamp: t, duration: 1 / FPS })
      await videoSource.add(frame)
      frame.close()
      // The music keeps up with the picture, in one piece.
      await soundTo(t + 1 / FPS)
    }
    try {
      for (const [i, clip] of clips.entries()) {
        const start = at
        stretches[i] = { fill: cover(clip.width, clip.height, width, height), start, length: Math.max(0.1, parts[i].end - parts[i].start) }
        at = await writeWhole(clip, at, {
          window: windows[i] ? parts[i] : undefined,
          rate: RATE,
          channels: CHANNELS,
          videoClock,
          audioClock: contiguousAudio(),
          maxRecoveries: MAX_RECOVERIES,
          onFrame: async (sample, timestamp) => {
            if (i === 0 && timestamp < 1.5) opening.push({ own: sample.timestamp, at: timestamp })
            // Every steady frame before this one starts shows the one before
            // it (the very first frame of the video: this one).
            const before = shown ?? { sample, clip: i }
            for (const by = framesBy(timestamp, FPS); made < by; made++) await frameAt(before.sample, before.clip, made / FPS)
            shown?.sample.close()
            shown = { sample: sample.clone(), clip: i }
          },
        })
        seconds.push(at - start)
      }
      // The last frame, to the very end.
      const last = shown as { sample: VideoSample; clip: number } | null
      if (last) for (const by = framesBy(at, FPS); made < by; made++) await frameAt(last.sample, last.clip, made / FPS)
    } finally {
      ;(shown as { sample: VideoSample } | null)?.sample.close()
    }
    at = Math.max(at, made / FPS)
    await soundTo(at)
    const start = openingProblem(opening)
    if (start) reportProblem({ kind: 'check', phase: 'start', message: `${files[0] instanceof File ? files[0].name : 'clip 1'}: ${start}` })

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
