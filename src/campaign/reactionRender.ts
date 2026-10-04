// A reaction video: the clip of him reacting, whole, with the headline over
// it; the switch sound as it cuts to the product; then the product clip -
// whole, or with the pauses cut when he talks over it, and captions if he
// does. Music under all of it, his voice made louder and clearer like the
// talking-head videos.
//
// A sibling of render.ts, which stays exactly as it is: that one reads one
// clip; this one reads two, one after the other, into the same file. The
// finished video takes the reaction clip's shape; the product fills the
// frame, its edges trimmed (reaction.ts, cover).

import {
  AudioSample,
  AudioSampleSource,
  canEncodeAudio,
  EncodedPacketSink,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  QUALITY_MEDIUM,
  VideoSample,
  VideoSampleSink,
  VideoSampleSource,
} from 'mediabunny'

import { SilenceCutError } from '../media/errors'
import { forwardOnly } from '../media/forwardOnly'
import { createOutputSink } from '../media/outputSink'
import { RangeReader, inTimestampOrder } from '../media/rangeReader'
import { isSilenceCutSupported } from '../media/silenceCut'
import type { Range } from '../media/silenceMath'
import { CAPTION_LEAD, captionAt, drawCaption, type CaptionPosition, type CaptionSize, type CaptionWord } from './captions'
import { framingAt, planMotion, zoomPlace } from './effects'
import { eachSound, openClip, type Clip } from './clipParts'
import { headlineFontReady } from './headlineFont'
import type { BuiltInSound, VideoLook } from './look'
import { MusicBed, musicGain, trackLoudness, type MusicLevel } from './music'
import { drawHeadline, layoutHeadline, outputSize } from './overlay'
import { cover, layOut, productMoment, type Segment } from './reaction'
import { dbToGain, mixInto, prepareSound, type PlacedSound } from './sounds'
import { Voice, measureLoudness, type WalkAudio } from './voice'

/** Every reaction video is written at one rate, whatever its clips were
 *  filmed at: what every AAC encoder takes. */
const RATE = 48000
const CHANNELS = 2
/** The switch sound starts a hair before the cut, so its swell lands on it. */
const SWITCH_LEAD_SEC = 0.12
const SWITCH_GAIN_DB = -3

export interface ReactionRenderInput {
  reaction: Blob
  product: Blob
  /** The product clip's kept parts - with the pauses cut when he talks over
   *  it - or null for all of it. */
  productKeep: Range[] | null
  /** The headline's look; the logo, pictures and effects are not used. */
  look: VideoLook
  headlineText: string
  switchSound: BuiltInSound | null
  /** On the product clip's own timeline. */
  captions?: CaptionWord[]
  voice?: boolean
  music?: { audio: Blob; level: MusicLevel } | null
  /** Makes this video's effect variations its own (look.effects says which). */
  seed?: string
  /** Where the captions sit on the product clip. */
  captionPosition?: CaptionPosition
  /** How big the captions are. */
  captionSize?: CaptionSize
}

export interface ReactionRenderResult {
  blob: Blob
  storedAs: string | null
  reactionSec: number
  productSec: number
  totalSec: number
}

export async function renderReaction(
  { reaction, product, productKeep, look, headlineText, switchSound, captions = [], voice: boostVoice = false, music = null, seed = '', captionPosition = 'usual', captionSize = 'normal' }: ReactionRenderInput,
  onProgress?: (fraction: number) => void,
): Promise<ReactionRenderResult> {
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
  const readers: RangeReader<VideoSample>[] = []

  try {
    clips.push(await openClip(reaction, 'reaction'))
    clips.push(await openClip(product, 'product'))
    const [reactionClip, productClip] = clips
    const productRanges = (productKeep ?? [{ start: productClip.first, end: productClip.duration }]).filter((r) => r.end > r.start)
    if (productRanges.length === 0) throw new SilenceCutError('Nothing of the product clip is kept.')
    const { segments, switchAt, total } = layOut({ start: reactionClip.first, end: reactionClip.duration }, productRanges)
    const rangesOf = (part: Segment['part']) => segments.filter((s) => s.part === part)

    // The whole video's sound, as it will be, for measuring the voice.
    const walk: WalkAudio = async (visit) => {
      await eachSound(reactionClip, rangesOf('reaction'), RATE, CHANNELS, visit)
      await eachSound(productClip, rangesOf('product'), RATE, CHANNELS, visit)
    }
    let voice: Voice | null = null
    if (boostVoice) {
      try {
        voice = await Voice.measure(RATE, CHANNELS, walk)
      } catch (error) {
        console.warn('The voice could not be measured, so it is left as recorded:', error)
      }
    }
    let bed: MusicBed | null = null
    if (music) {
      try {
        const track = await prepareSound({ kind: 'file', name: 'music', audio: music.audio }, RATE)
        const needed = Math.ceil(total * RATE) + RATE
        const channels = track.channels.map((c) => (c.length > needed ? c.slice(0, needed) : c))
        const voiceLufs = voice?.lufs ?? (await measureLoudness(RATE, CHANNELS, walk))
        const gain = musicGain(trackLoudness(channels, RATE), Number.isFinite(voiceLufs) ? voiceLufs : -20, music.level)
        if (gain > 0) bed = new MusicBed(channels, RATE, Math.round(total * RATE), gain, Number.isFinite(voiceLufs) ? voiceLufs : -20)
      } catch (error) {
        console.warn('The music could not be added, so the video is made without it:', error)
      }
    }
    const placed: PlacedSound[] = []
    if (switchSound) {
      const sound = await prepareSound({ kind: 'built-in', name: switchSound }, RATE)
      placed.push({ ...sound, startFrame: Math.max(0, Math.round((switchAt - SWITCH_LEAD_SEC) * RATE)), gain: dbToGain(SWITCH_GAIN_DB) })
    }

    // Captions only where the product clip is kept, at their place on the
    // finished video.
    const shown = captions
      .map((word) => ({ word, at: productMoment(segments, word.start) }))
      .filter((c): c is { word: CaptionWord; at: number } => c.at !== null)
    const captionWords = shown.map((c) => c.word)
    const captionTimes = shown.map((c) => c.at)

    const { width, height } = outputSize(reactionClip.width, reactionClip.height)
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new SilenceCutError("This browser couldn't prepare a canvas to draw the headline on.")
    await headlineFontReady()
    const headline = layoutHeadline(ctx, width, height, { ...look.headline, text: headlineText })
    const productPlace = cover(productClip.width, productClip.height, width, height)
    // Zoom effects: two stretches - the reaction, then the product - so a punch
    // can land at the switch, and the hook push opens the reaction.
    const motion = planMotion(look.effects, [switchAt, Math.max(0.1, total - switchAt)], seed || 'reaction')
    const reactionPlace = { x: 0, y: 0, width, height }

    const videoSource = new VideoSampleSource({ codec: 'avc', quality: QUALITY_HIGH })
    const audioSource = new AudioSampleSource({ codec: 'aac', quality: QUALITY_MEDIUM })
    output.addVideoTrack(videoSource)
    output.addAudioTrack(audioSource)
    await output.start()

    const videoClock = forwardOnly()
    let writtenFrames = 0

    for (const clip of clips) {
      const part: Segment['part'] = clip === reactionClip ? 'reaction' : 'product'
      const mine = rangesOf(part)
      const packets = new EncodedPacketSink(clip.video)
      const keyAt = async (t: number) => (await packets.getKeyPacket(t, { verifyKeyPackets: true }))?.timestamp ?? -Infinity
      const frames = new RangeReader(inTimestampOrder(new VideoSampleSink(clip.video).samples(mine[0].start, mine[mine.length - 1].end)))
      readers.push(frames)

      await Promise.all([
        (async () => {
          for (const segment of mine) {
            for await (const sample of frames.range(segment.start, segment.end, await keyAt(segment.start))) {
              const timestamp = videoClock(segment.at + Math.max(0, sample.timestamp - segment.start))
              const duration = sample.duration
              onProgress?.(Math.min(0.99, timestamp / total))
              if (part === 'reaction') {
                const spot = zoomPlace(reactionPlace, framingAt(motion, 0, timestamp, []), width, height)
                sample.draw(ctx, spot.x, spot.y, spot.width, spot.height)
                if (headline) drawHeadline(ctx, headline)
              } else {
                ctx.fillStyle = '#000'
                ctx.fillRect(0, 0, width, height)
                const spot = zoomPlace(productPlace, framingAt(motion, 1, timestamp - switchAt, []), width, height)
                sample.draw(ctx, spot.x, spot.y, spot.width, spot.height)
                const word = captionAt(captionTimes, captionWords, timestamp)
                if (word >= 0) drawCaption(ctx, width, height, captionWords[word].text, timestamp + CAPTION_LEAD - captionTimes[word], false, captionPosition, captionSize)
              }
              sample.close()
              const frame = new VideoSample(canvas, { timestamp, duration })
              await videoSource.add(frame)
              frame.close()
            }
          }
        })(),
        eachSound(clip, mine, RATE, CHANNELS, async (planes) => {
          const firstFrame = writtenFrames
          writtenFrames += planes[0].length
          const data = new Float32Array(planes[0].length * CHANNELS)
          const out = [data.subarray(0, planes[0].length), data.subarray(planes[0].length)]
          out[0].set(planes[0])
          out[1].set(planes[1])
          voice?.shape(out)
          bed?.mixInto(out, firstFrame)
          mixInto(out, firstFrame, placed, !voice)
          if (voice) voice.limit(out)
          else for (const plane of out) for (let i = 0; i < plane.length; i++) plane[i] = Math.max(-1, Math.min(1, plane[i]))
          const sample = new AudioSample({ data, format: 'f32-planar', numberOfChannels: CHANNELS, sampleRate: RATE, timestamp: firstFrame / RATE })
          await audioSource.add(sample)
          sample.close()
        }),
      ])
    }

    await output.finalize()
    const blob = await sink.finish()
    if (blob.size === 0) throw new SilenceCutError('Making the video finished but produced no file. Try again.')
    finished = true
    onProgress?.(1)
    const reactionSec = switchAt
    return { blob, storedAs: sink.storedAs, reactionSec, productSec: total - reactionSec, totalSec: total }
  } finally {
    await Promise.all(readers.map((r) => r.dispose().catch(() => {})))
    for (const clip of clips) clip.input.dispose()
    if (!finished) {
      await output.cancel().catch(() => {})
      await sink.discard()
    }
  }
}
