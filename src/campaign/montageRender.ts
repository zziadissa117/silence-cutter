// A video with no talking: his clips one after another - a reaction, then a
// product showcase, or however many he picks - with the headline over the
// first, and nothing heard but the music. The clips' own sound is left out.
//
// The frame is always upright. Each clip is written whole: an upright one
// filling it (its edges trimmed if its shape is a little off), a wide one -
// landscape, square, 3:4 - shown whole across the middle on black, nothing
// cut off and nothing moved (his ask, 2026-11-13: "it keeps being
// horizontal, and that's it ... just don't change anything about the video
// itself"); an upright clip with black bands already made into it is left
// exactly as it is too (blackBands.ts).
// The phone's decoder giving up
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

import { throttled } from '../media/audio'
import { SilenceCutError } from '../media/errors'
import { contiguousAudio, forwardOnly } from '../media/forwardOnly'
import { createOutputSink } from '../media/outputSink'
import { MAX_RECOVERIES } from '../media/recovery'
import { MAX_CHANNELS, SAFE_SAMPLE_RATE, isSilenceCutSupported } from '../media/silenceCut'
import { openClip, usualFrame, writeWhole, type Clip } from './clipParts'
import { framingAt, planMotion, randomFrom, reactionZoom, zoomPlace } from './effects'
import { ONLY_HOOK_ELSE } from './batch'
import { CAPTION_LEAD, PHRASE_HOLD_SEC, captionAt, captionRanges, drawStyledCaption, type CaptionPosition, type CaptionSize, type CaptionStyle, type CaptionWord } from './captions'
import { drawFormula, formulaPush, layoutFormula, type FormulaLayout } from './formulaOverlay'
import { headlineFontReady } from './headlineFont'
import type { VideoLook } from './look'
import { MusicBed, musicGain, trackLoudness } from './music'
import { Limiter } from './voice'
import { TIKTOK_ZONES, drawHeadline, layoutHeadline, outputSize, type HeadlineLayout, type LogoLayout } from './overlay'
import { makeSize, videoQuality } from './quality'
import { cover } from './reaction'
import { isUpright } from './framing916'
import { bandsIn } from './blackBands'
import { fitShowcase, pickPiece, readActivity } from './stepPiece'
import { musicProblem, prepareMusic } from './sounds'
import { report as reportProblem } from '../report'
import { onEncodedPacketMatchingColour } from './colourCheck'

/** Every video written at one rate, stereo - what every AAC encoder takes
 *  (media/silenceCut.ts). */
const RATE = SAFE_SAMPLE_RATE
const CHANNELS = MAX_CHANNELS
/** With nothing else to hear, the music is the sound: every song is set to
 *  about where TikTok plays things - a loud master brought down, a quiet one
 *  brought up, its peaks held under a limiter so it never clips. A quiet
 *  song used to be left as it was, and in a batch some came out barely
 *  there: "just play the song no matter if it's quiet". */
const MUSIC_LUFS = -14
/** A talking batch's voice is taken as about this loud, for the music under
 *  it - what an iPhone's mic gives a voice at arm's length. */
const VOICE_LUFS = -20
/** How far the sound is written behind the picture in a talking batch, in
 *  seconds: a clip's sound can come a little after its frames. */
const VOICE_LEAD = 1.5
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

/** Where a clip goes in the upright frame, and whether it is shown whole: an
 *  upright clip (a phone held upright) fills the frame, its edges trimmed if
 *  its shape is a little off; a wide one keeps its shape, as wide as the
 *  frame, in the middle. */
export function clipPlace(clipWidth: number, clipHeight: number, width: number, height: number): { box: { x: number; y: number; width: number; height: number }; whole: boolean } {
  if (clipWidth <= 0 || clipHeight <= 0 || isUpright(clipWidth, clipHeight)) return { box: cover(clipWidth, clipHeight, width, height), whole: false }
  const scale = Math.min(width / clipWidth, height / clipHeight)
  const w = clipWidth * scale
  const h = clipHeight * scale
  return { box: { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h }, whole: true }
}

/** How many frames of a steady `fps` start before `until` seconds - the ones
 *  a clip's frame starting there takes over from. */
export function framesBy(until: number, fps: number): number {
  return Math.max(0, Math.ceil(until * fps - 1e-6))
}

/** How much of the start of a video is watched for a hook that froze or lagged. */
export const OPENING = 1.5

/** What was wrong with how the first clip's frames came at the start of the
 *  video, in words, or null when they came steadily. `opening` says when each
 *  of its frames came, in its own time and the video's; `frame` is how long
 *  one of its own frames lasts (clipParts.usualFrame).
 *
 *  Counted as it is watched: of the steady frames up to its last one here,
 *  how many show the same picture as the one before - a first picture held,
 *  a gap, or frames that come every other one, each shown twice ("laggy") -
 *  beyond what its own rate explains (a 24 a second clip repeats one in
 *  five). One spare is allowed: a clip a hair slower than 30 a second can
 *  show its first picture twice, which nobody sees. */
export function openingProblem(opening: readonly { own: number; at: number }[], frame = 1 / FPS): string | null {
  if (opening.length === 0) return 'no frame in its first second and a half'
  const steady = opening.map((f) => framesBy(f.at, FPS))
  // Each picture stays until the next one's steady frame; the first is also
  // on every steady frame before its own.
  let repeats = steady[0]
  for (let k = 1; k < steady.length; k++) repeats += Math.max(0, steady[k] - steady[k - 1] - 1)
  const watched = steady[steady.length - 1] + 1
  const explained = watched * Math.max(0, 1 - 1 / (frame * FPS))
  if (repeats <= explained + 1) return null
  const held = opening[0].at
  const gaps = opening.slice(1).map((f, k) => f.at - opening[k].at)
  const worst = gaps.length ? Math.max(...gaps) : 0
  const ms = (s: number) => `${Math.round(s * 1000)} ms`
  const own = opening.slice(0, 16).map((f) => Math.round(f.own * 1000)).join(' ')
  return (
    `${repeats} of its first ${watched} frames repeat the one before (${Math.round(explained)} from its own ${Math.round(1 / frame)} a second), ` +
    `first frame at ${ms(held)}, longest gap ${ms(worst)}, ${opening.length} frames in 1.5 s; its own times ${own}`
  )
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
  /** The headline's look and the campaign's effects; the logo and pictures are not used. */
  look: VideoLook
  headlineText: string
  music: { audio: Blob; name: string } | null
  /** Makes this video's effect variations its own (look.effects says which). */
  seed?: string
  /** The "Claude + X = $ a day" hook instead of a headline: the two logos,
   *  and this video's money line. The reaction pushes in slowly under it. */
  formula?: { left: Blob | null; right: Blob | null; line: string; plain?: boolean } | null
  /** Per clip, in order: true to play only the moment something happens in
   *  it (a batch's product steps, stepPiece.ts); false, or absent, for all
   *  of it. */
  windows?: boolean[]
  /** The first clip is his reaction (a batch): it slowly pushes in for its
   *  whole length when the campaign's push-in is on (effects.reactionZoom). */
  reactionFirst?: boolean
  /** A talking batch: the first clip's own sound - his voice - is kept, and
   *  the music goes under it, dipping while he talks (his ask, 2026-11-03:
   *  "some talking batches and some reaction-only"). Absent: music alone. */
  voice?: boolean
  /** A talking head batch: every clip keeps its own sound, not only the
   *  first - his product steps come edited, with him saying what to do over
   *  them ("Step one: go to this website", his ask 2026-11-08). The music
   *  goes under all of it, dipping while he talks. */
  voiceAll?: boolean
  /** Per clip, in order: words over all of it in the headline's look - a
   *  batch's product step, its name (batch.stepTitle); null or absent for
   *  none. */
  titles?: (string | null)[]
  /** Per clip, in order: a product step's own words, each where he put it
   *  (batch.StepText) - in place of `titles` for that clip when given. */
  stepTexts?: ({ text: string; place?: { x: number; y: number; scale: number }; style?: 'outline' | 'box' | 'snap' }[] | null)[]
  /** A Trial loop's video (trialLoop.ts): white (above 0) or black (below)
   *  this strong over every frame, under the words - a touch brighter or
   *  darker. 0 or absent: the frame as it is. */
  brightness?: number
  /** A Trial loop's video: the words keep the viral reel's own lines - a
   *  little smaller rather than break onto another line it didn't have. */
  keepLines?: boolean
  /** The video keeps the first clip's own shape - a horizontal clip stays
   *  horizontal (a Trial reel, his ask 2026-11-06) - instead of 9:16. */
  keepShape?: boolean
  /** A Trial loop's video: this many seconds off the end of the first clip -
   *  an 8 s reel sometimes 7 or 6, so Instagram doesn't take every copy for
   *  the same video (his ask, 2026-11-11). Never more than a quarter of it. */
  shorterBy?: number
  /** A talking batch's captions: what he says in the first clip, on that
   *  clip's own timeline (talkCaptions.ts), drawn as his talking videos'. */
  captions?: {
    words: CaptionWord[]
    position: CaptionPosition
    size: CaptionSize
    style: CaptionStyle
    /** A talking head batch: what he says in each clip after the first (his
     *  product steps, talked over), on each clip's own timeline - null for a
     *  clip he doesn't talk in (his ask, 2026-11-13: captions on the steps). */
    steps?: (CaptionWord[] | null)[]
  } | null
}

/** The headline laid out a little smaller, step by step, until it takes no
 *  more lines than its words have (a Trial loop's copy of a viral reel's
 *  one-line hook stays one line). Never under 60% of its size. */
function keepingLines(
  lay: (place: HeadlineLayoutInput['place']) => HeadlineLayout | null,
  headline: HeadlineLayoutInput,
): HeadlineLayout | null {
  const wanted = headline.text.trim().split('\n').length
  const place = headline.place ?? { x: 0.5, y: 0.3, scale: 1 }
  let layout = lay(headline.place)
  for (let scale = place.scale - 0.05; layout && layout.lines.length > wanted && scale >= 0.6 * place.scale; scale -= 0.05) {
    layout = lay({ ...place, scale })
  }
  return layout
}

type HeadlineLayoutInput = Parameters<typeof layoutHeadline>[3]

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

/** The video's frame: 9:16 (verticalSize), or - keeping its shape - the
 *  first clip's own, horizontal or upright, at most 1080 on its short side. */
export function montageSize(width: number, height: number, keepShape: boolean, maxShort = 2160): { width: number; height: number } {
  return keepShape ? outputSize(width, height, maxShort) : verticalSize(width, height, maxShort)
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
export function musicTrack(
  bed: Pick<MusicBed, 'mixInto'> | null,
  add: (sample: AudioSample) => Promise<void>,
  /** A talking batch's voice, the whole video long: put in first, the music
   *  under it, through a limiter. */
  voice: Float32Array[] | null = null,
): (end: number) => Promise<void> {
  let at = 0
  const limiter = voice ? new Limiter(RATE, CHANNELS) : null
  return async (end) => {
    const until = Math.round(end * RATE)
    while (at < until) {
      const length = Math.min(RATE / 10, until - at)
      const data = new Float32Array(length * CHANNELS)
      const out = Array.from({ length: CHANNELS }, (_, c) => data.subarray(c * length, (c + 1) * length))
      if (voice) for (let c = 0; c < CHANNELS; c++) out[c].set(voice[c].subarray(at, Math.min(voice[c].length, at + length)))
      bed?.mixInto(out, at)
      if (limiter) limiter.process(out)
      else for (const plane of out) for (let k = 0; k < plane.length; k++) plane[k] = Math.max(-1, Math.min(1, plane[k]))
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
  { clips: files, look, headlineText, music, seed = '', formula = null, windows = [], reactionFirst = false, titles = [], stepTexts = [], voice = false, voiceAll = false, brightness = 0, keepLines = false, keepShape = false, shorterBy = 0, captions = null }: MontageRenderInput,
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
    if (shorterBy > 0 && parts[0]) {
      const first = parts[0]
      first.end = Math.max(first.start + (first.end - first.start) * 0.75, first.end - shorterBy)
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
        const loudness = trackLoudness(channels, RATE)
        if (voice) {
          // Under his voice, as in a talking video, dipping while he talks -
          // quieter than in a talking video of his: he says what to do, and
          // every word has to be heard (his ask, 2026-11-08).
          const gain = musicGain(loudness, VOICE_LUFS, 'low')
          if (gain > 0) bed = new MusicBed(channels, RATE, Math.round(total * RATE), gain, VOICE_LUFS)
          else musicFailed = 'the track is silent'
        } else {
          const gain = soloMusicGain(loudness)
          if (gain > 0) {
            liftMusic(channels, gain, RATE)
            // Nothing else is heard, so nothing ever dips it. A Trial reel's
            // sound is the viral reel's own, for this clip: it never starts
            // over (Ilyan's copies looped, 2026-11-06).
            bed = new MusicBed(channels, RATE, Math.round(total * RATE), 1, Infinity, !keepLines)
          }
          else musicFailed = 'the track is silent'
        }
      } catch (error) {
        musicFailed = error instanceof Error ? error.message : String(error)
      }
      if (musicFailed) reportProblem({ kind: 'fallback', phase: 'music', message: musicProblem(new Error(musicFailed), music.audio) })
    }

    // 1080p at a steady FPS, at a bitrate to match (quality.ts).
    const { width, height } = makeSize((maxShort) => montageSize(clips[0].width, clips[0].height, keepShape, maxShort))
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new SilenceCutError("This browser couldn't prepare a canvas to draw the headline on.")
    await headlineFontReady()
    // A batch's words sit a little lower (BATCH_LOWER).
    const place = (layout: HeadlineLayout | null) => (reactionFirst ? lowered(layout, height) : layout)
    const words = { ...look.headline, text: headlineText }
    const headline = place(
      formula || !headlineText.trim()
        ? null
        : keepLines
          ? keepingLines((at) => layoutHeadline(ctx, width, height, { ...words, place: at }), words)
          : layoutHeadline(ctx, width, height, words),
    )
    // Each step's name over its clip, laid out once - always in the outline
    // look: Snapchat (and the white box) is for the hook alone.
    const titleLayouts = clips.map((_, i) => {
      // His own words for the step, each where he put it: drawn exactly there.
      const own = stepTexts[i]
      if (own) {
        return own
          .map((w) => {
            const laid = layoutHeadline(ctx, width, height, { ...look.headline, style: w.style ?? ONLY_HOOK_ELSE, text: w.text, place: w.place ?? null })
            return w.place ? laid : place(laid)
          })
          .filter((l): l is HeadlineLayout => l !== null)
      }
      const laid = place(titles[i]?.trim() ? layoutHeadline(ctx, width, height, { ...look.headline, style: ONLY_HOOK_ELSE, text: titles[i]! }) : null)
      return laid ? [laid] : []
    })
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
        ? layoutFormula(ctx, width, height, { left: logos.left, right: logos.right }, formula.line, { ...look.headline, style: ONLY_HOOK_ELSE }, formula.plain === true)
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
    // A talking batch: his voice, written here as its clip is read, and the
    // sound written a little behind the picture so his voice is always in
    // before the music is laid under it.
    const voicePlanes = voice ? Array.from({ length: CHANNELS }, () => new Float32Array(Math.ceil((total + 2) * RATE))) : null
    const soundTo = musicTrack(bed, (sample) => audioSource.add(sample), voicePlanes)
    const behind = voicePlanes ? VOICE_LEAD : 0
    /** How loud his voice got, for the report when a talking clip gave no sound. */
    let voicePeak = 0
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
    /** Each clip's place, and whether it is drawn exactly as it is (`still`):
     *  a wide one shown whole, or an upright one with bands made into it -
     *  undecided (null) until a frame shows enough to tell. */
    const stretches: { fill: ReturnType<typeof cover>; whole: boolean; still: boolean | null; start: number; length: number }[] = []
    /** What he says over each clip after the first, on the video's timeline. */
    const stepSaid: { words: CaptionWord[]; times: number[]; ranges: ReturnType<typeof captionRanges> }[] = []
    // His words over the first clip, on the video's timeline: the clip plays
    // from its first frame shown (clips[0].first).
    const said = captions?.words.length ? captions.words.map((w) => ({ ...w, start: w.start - clips[0].first, end: w.end - clips[0].first })) : []
    const saidRanges = captions ? captionRanges(said, captions.style) : []
    const saidTimes = said.map((w) => w.start)
    const report = throttled(onProgress)
    const frameAt = async (sample: VideoSample, i: number, t: number) => {
      const stretch = stretches[i]
      const { fill, whole, start, length } = stretch
      if (!whole && stretch.still === null) {
        const banded = bandsIn((c, w, h) => sample.draw(c, 0, 0, w, h))
        if (banded !== null) stretch.still = banded
      }
      report(t / total)
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, width, height)
      // Under the formula, the reaction pushes in slowly for its whole
      // length instead of the usual opening push.
      // A batch's reaction always pushes in slowly too, or the angle's
      // own push-in where that is closer.
      // Both are push-ins, so they come only with the campaign's push-in on:
      // a campaign with no effects has none at all (his rule, 2026-11-03).
      const own = framingAt(motion, i, t - start, [])
      const pushes = look.effects.hookPush !== 'off'
      const framing =
        i === 0 && formulaLayout && pushes
          ? formulaPush(t - start, length)
          : i === 0 && reactionFirst && pushes
            ? { ...own, scale: Math.max(own.scale, reactionZoom(t - start, length)) }
            : own
      if (whole || stretch.still !== false) {
        // Drawn exactly as it is: a wide clip whole on black, a clip with its
        // own bands as made - nothing zoomed (a clip still undecided: its
        // first dark frames, not moved either).
        sample.draw(ctx, fill.x, fill.y, fill.width, fill.height)
      } else {
        const spot = zoomPlace(fill, framing, width, height)
        sample.draw(ctx, spot.x, spot.y, spot.width, spot.height)
      }
      if (brightness) {
        // A see-through wash rather than a canvas filter: the same on every
        // browser the app runs in. Over the picture only, not the black
        // around a wide clip.
        ctx.fillStyle = brightness > 0 ? `rgba(255,255,255,${Math.min(1, brightness)})` : `rgba(0,0,0,${Math.min(1, -brightness)})`
        if (whole) ctx.fillRect(fill.x, fill.y, fill.width, fill.height)
        else ctx.fillRect(0, 0, width, height)
      }
      if (i === 0 && headline) drawHeadline(ctx, headline)
      for (const title of titleLayouts[i] ?? []) drawHeadline(ctx, title)
      if (i === 0 && formulaLayout && logos) drawFormula(ctx, formulaLayout, logos)
      // What he says, on top of everything, while his clip plays.
      if (i === 0 && captions && said.length > 0) {
        const word = captionAt(saidTimes, said, t, captions.style === 'word' ? undefined : PHRASE_HOLD_SEC)
        if (word >= 0) drawStyledCaption(ctx, width, height, said, saidRanges, word, t + CAPTION_LEAD - saidTimes[word], false, captions.position, captions.size, captions.style)
      }
      // And what he says over a product step, the same way.
      const over = i > 0 && captions ? stepSaid[i] : undefined
      if (over && captions) {
        const word = captionAt(over.times, over.words, t, captions.style === 'word' ? undefined : PHRASE_HOLD_SEC)
        if (word >= 0) drawStyledCaption(ctx, width, height, over.words, over.ranges, word, t + CAPTION_LEAD - over.times[word], false, captions.position, captions.size, captions.style)
      }
      const frame = new VideoSample(canvas, { timestamp: t, duration: 1 / FPS })
      try {
        await videoSource.add(frame)
      } finally {
        frame.close()
      }
      // The music keeps up with the picture, in one piece.
      await soundTo(t + 1 / FPS - behind)
    }
    try {
      for (const [i, clip] of clips.entries()) {
        const start = at
        const placed = clipPlace(clip.width, clip.height, width, height)
        stretches[i] = { fill: placed.box, whole: placed.whole, still: placed.whole ? true : null, start, length: Math.max(0.1, parts[i].end - parts[i].start) }
        // His words over a step he talks in, played whole: from its first
        // frame shown, onto the video's timeline.
        const own = i > 0 && !windows[i] ? captions?.steps?.[i - 1] : null
        if (own?.length && captions) {
          const words = own.map((w) => ({ ...w, start: w.start - clip.first + start, end: w.end - clip.first + start }))
          stepSaid[i] = { words, times: words.map((w) => w.start), ranges: captionRanges(words, captions.style) }
        }
        at = await writeWhole(clip, at, {
          window: windows[i] ? parts[i] : undefined,
          rate: RATE,
          channels: CHANNELS,
          videoClock,
          audioClock: contiguousAudio(),
          maxRecoveries: MAX_RECOVERIES,
          ...(voicePlanes && (i === 0 || voiceAll)
            ? {
                onSound: async (planes: Float32Array[], timestamp: number) => {
                  const from = Math.round(timestamp * RATE)
                  for (let c = 0; c < CHANNELS; c++) {
                    const into = voicePlanes[c]
                    const plane = planes[c] ?? planes[0]
                    if (!plane || from >= into.length) continue
                    for (let k = 0; k < plane.length; k += 64) voicePeak = Math.max(voicePeak, Math.abs(plane[k]))
                    into.set(from < 0 ? plane.subarray(-from) : plane.subarray(0, into.length - from), Math.max(0, from))
                  }
                },
              }
            : {}),
          onFrame: async (sample, timestamp) => {
            if (i === 0 && timestamp < OPENING) opening.push({ own: sample.timestamp, at: timestamp })
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
    // A talking clip that gave no sound: said, so a muted video is never a
    // mystery (his report, 2026-11-08: "all the reaction clips are muted").
    if (voicePlanes && voicePeak < 0.002) {
      reportProblem({
        kind: 'check',
        phase: 'voice',
        message: `${files[0] instanceof File ? files[0].name : 'clip 1'}: his voice was to be kept but the clip gave ${voicePeak > 0 ? 'almost ' : ''}no sound (sound track: ${clips[0].hasSound ? (clips[0].audio ? 'readable' : 'not readable here') : 'none'})`,
      })
    }
    const start = openingProblem(opening, await usualFrame(clips[0].video, clips[0].first))
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
