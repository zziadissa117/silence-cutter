// Cuts the pauses out AND puts the campaign's look on, in one pass: one
// decode, one encode, one file.
//
// This is a sibling of renderCut in media/silenceCut.ts, not a change to it.
// The plain cutter works and stays exactly as it is; this borrows its parts
// (the one-decoder range reader, the forward-only clocks, the streamed output)
// and walks the kept ranges the same way. What differs:
//
//   - every frame is drawn onto a canvas, because that is how the headline
//     and logo get onto it. The canvas is at most 1080×1920 - TikTok plays
//     nothing bigger, and a 4K canvas is four times the memory. It also means
//     HDR footage comes out as ordinary colour, which is the plain cutter's
//     own fallback and what TikTok shows anyway.
//   - the sounds are mixed into the audio as it goes past.
//   - the voice is made louder and clearer on the way (voice.ts), measured
//     first from the kept audio alone.
//   - his background music goes under the voice, set by the voice's
//     loudness and dipping while he talks (music.ts).
//   - moments he said the brand's name are placed with each range's real
//     shift, not its nominal length; see timeline.ts.
//   - the angle's effects move the frame (zooms at cuts, the hook push-in,
//     the brand punch) before the headline and logo go on top, steady; see
//     effects.ts.
//   - a clip can be joined on before and after him (clips.ts): whole, filling
//     the frame, nothing drawn over it, its sound set to his voice's level.
//     Everything of his own - the headline, the start sounds, the hook
//     push-in - starts when he comes on, so the clip before plays clean.

import {
  ALL_FORMATS,
  AudioSample,
  AudioSampleSink,
  AudioSampleSource,
  BlobSource,
  CanvasSink,
  canEncodeAudio,
  EncodedPacketSink,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_MEDIUM,
  VideoSample,
  VideoSampleSink,
  VideoSampleSource,
  type WrappedCanvas,
} from 'mediabunny'

import { SilenceCutError } from '../media/errors'
import { contiguousAudio, forwardOnly } from '../media/forwardOnly'
import { createOutputSink } from '../media/outputSink'
import { RangeReader, inTimestampOrder } from '../media/rangeReader'
import { isSilenceCutSupported } from '../media/silenceCut'
import { totalDuration, type Range } from '../media/silenceMath'
import type { VideoLook } from './look'
import { CAPTION_LEAD, captionAt, drawStyledCaption, captionRanges, type CaptionPosition, type CaptionSize, type CaptionStyle, type CaptionWord } from './captions'
import { decoderGaveUp, eachSound, firstShown, openClip, pause, visibleAgain, wholeOf, writeWhole, type Clip } from './clipParts'
import { traceRead, traceStart, traceStep, traceWritten } from './renderTrace'
import type { ClipPlace } from './clips'
import { framingAt, logoPop, placeFrame, planMotion } from './effects'
import { ColourCheck } from './colourCheck'
import { cutEdges, fadeAtCuts, nearCut } from './cutFades'
import { headlineFontReady } from './headlineFont'
import { framedSize, landscapeMode, makeBlurBackdrop, planFrame } from './framing916'
import { TOGETHER_SEC, cameUpTogether, drawHeadline, drawLogo, drawPoppedLogo, layoutHeadline, layoutLogo, sideBySide } from './overlay'
import { dbToGain, mixInto, musicProblem, prepareMusic, prepareSound, type PlacedSound, type PreparedSound } from './sounds'
import { MomentPlacer, inWindow } from './timeline'
import { MusicBed, musicGain, trackLoudness, type MusicLevel } from './music'
import { cover } from './reaction'
import { Voice, measureLoudness, type WalkAudio } from './voice'
import { frameRateOf, makeSize, videoQuality } from './quality'
import { PopFrames, drawPop, occurrencesOf, popAt, popLayout, type PopLayout, type PopPosition } from './popVideo'
import { report as reportProblem } from '../report'

/** A pop-up clip's frames from its own start, timed from 0. */
async function* fromStart(sink: CanvasSink, first: number, seconds: number): AsyncGenerator<WrappedCanvas> {
  for await (const frame of sink.canvases(first, first + seconds)) yield { ...frame, timestamp: frame.timestamp - first }
}

/** How many times one video may bring up a fresh decoder after the phone's
 *  gives up partway, before the failure is passed on. */
const MAX_RECOVERIES = 4


/** The most a quiet clip is lifted to meet his voice: more only brings up
 *  its hiss. */
const CLIP_MAX_LIFT_DB = 12


const UNREADABLE_FORMAT =
  "This browser can't read this video's format. On a computer, open this page in Safari or Chrome; on a phone, update to the newest iOS."

/** What every AAC encoder takes: 48kHz, at most stereo. Same rule as the
 *  plain cutter's. */
const SAFE_SAMPLE_RATE = 48000
const MAX_CHANNELS = 2

async function audioConversionFor(
  audioTrack: NonNullable<Awaited<ReturnType<Input['getPrimaryAudioTrack']>>>,
): Promise<{ transform?: { sampleRate: number; numberOfChannels: number } }> {
  const [sampleRate, channels] = await Promise.all([audioTrack.getSampleRate(), audioTrack.getNumberOfChannels()])
  const numberOfChannels = Math.min(channels, MAX_CHANNELS)
  if (numberOfChannels === channels && (await canEncodeAudio('aac', { sampleRate, numberOfChannels }))) return {}
  if (await canEncodeAudio('aac', { sampleRate: SAFE_SAMPLE_RATE, numberOfChannels })) {
    return { transform: { sampleRate: SAFE_SAMPLE_RATE, numberOfChannels } }
  }
  throw new SilenceCutError(
    `This video's sound (${channels} channels at ${sampleRate} Hz) can't be re-encoded by this browser. Try Safari or Chrome.`,
  )
}

function throttled(onProgress?: (fraction: number) => void): (fraction: number) => void {
  let last = -1
  return (fraction) => {
    const capped = Math.max(0, Math.min(0.99, fraction))
    if (!onProgress || capped - last < 0.01) return
    last = capped
    onProgress(capped)
  }
}

export interface CampaignRenderInput {
  keep: Range[]
  look: VideoLook
  /** The headline for this video - the look's, or what he changed it to for
   *  this batch. Empty for none. */
  headlineText: string
  /** When the logo's words were said, on the raw video's timeline. */
  logoMoments: number[]
  /** Per sound in look.sounds, when it plays on the raw video's timeline.
   *  Start sounds are not listed here; they play at 0:00 of the output. */
  soundMoments: number[][]
  /** When the brand was said, for the brand punch-in. Empty when it is off. */
  brandMoments: number[]
  /** Per picture in look.pictures, when its words were said. */
  pictureMoments: number[][]
  /** The bank's pictures that were mentioned, and when. Shown in the
   *  angle's bank placement, one at a time. */
  bankCues: { image: Blob; moments: number[] }[]
  /** Makes this video's variations its own; the same seed moves the same
   *  way. */
  seed: string
  /** A second go after the phone's decoder gave up: no zooms, the heaviest
   *  thing drawn, so the phone has less to do. Headline, logo, pictures and
   *  sounds are all still there. */
  gentle?: boolean
  /** One word at a time, as he checked them. None when captions are off. */
  captions?: CaptionWord[]
  /** Where the captions sit on the frame; usual when not given. */
  captionPosition?: CaptionPosition
  /** How big the captions are. */
  captionSize?: CaptionSize
  /** One word at a time, or the phrase with the spoken word lit. */
  captionStyle?: CaptionStyle
  /** Make it 9:16 even when the Wide clips setting is Off. */
  forceVertical?: boolean
  /** Makes the voice louder and clearer; see voice.ts. */
  voice?: boolean
  /** A track to play under the voice; see music.ts. */
  music?: { audio: Blob; level: MusicLevel } | null
  /** Videos joined on whole, before him and after him. */
  clips?: Partial<Record<ClipPlace, Blob | null>>
  /** Videos played whole in the middle of him, each after kept part `after`
   *  (cueClips.ts splits the cut so each lands between two parts). */
  inserts?: { after: number; file: Blob }[]
  /** Bank videos that pop up over him when their words are said, muted,
   *  each playing to its end - see popVideo.ts. */
  pops?: {
    clips: { file: Blob; seconds: number; width: number; height: number; moments: number[] }[]
    sizePct: number
    position: PopPosition
  }
}

export interface CampaignRenderResult {
  blob: Blob
  storedAs: string | null
  /** When the logo actually came up in the finished video, in seconds. */
  logoAt: number[]
  /** When each picture came up, in seconds, in look.pictures order. */
  picturesAt: number[][]
  /** When a bank picture came up, in seconds. */
  bankAt: number[]
  /** How many times the phone's decoder gave up partway and a fresh one
   *  carried on from the last frame written. */
  recovered: number
  /** How long the clips joined on came out, and any that couldn't be read
   *  and were left out. */
  clips: { beforeSec: number; afterSec: number; leftOut: ClipPlace[]; middleSec: number; middleLeftOut: number }
  /** When a pop-up video came up, in seconds. */
  popsAt: number[]
  /** Pop-up videos that couldn't be played here and were left out. */
  popsLeftOut: number
}

export async function renderCampaignCut(
  file: Blob,
  {
    keep,
    look,
    headlineText,
    logoMoments,
    soundMoments,
    brandMoments,
    pictureMoments,
    bankCues,
    seed,
    gentle,
    captions = [],
    captionPosition = 'usual',
    captionSize = 'normal',
    captionStyle = 'word',
    forceVertical = false,
    voice: boostVoice = false,
    music = null,
    clips: joining = {},
    inserts = [],
    pops,
  }: CampaignRenderInput,
  onProgress?: (fraction: number) => void,
): Promise<CampaignRenderResult> {
  if (!(await isSilenceCutSupported())) {
    throw new SilenceCutError(
      "This browser can't cut video yet. Update to the newest iOS/Safari, or use the Mac version.",
    )
  }

  const report = throttled(onProgress)
  traceStart()
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
  traceStep('opening where the video is written')
  const sink = await createOutputSink()
  traceStep('reading the video')
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: false }), target: sink.target })
  let finished = false
  let videoFrames: RangeReader<VideoSample> | null = null
  let audioFrames: RangeReader<AudioSample> | null = null
  let logoImage: ImageBitmap | null = null
  const pictureImages: ImageBitmap[] = []
  const bankImages: ImageBitmap[] = []
  const joined: Clip[] = []
  const popInputs: Input[] = []
  let popPlayer: PopFrames<WrappedCanvas> | null = null

  try {
    const [videoTrack, audioTrack] = await Promise.all([input.getPrimaryVideoTrack(), input.getPrimaryAudioTrack()])
    if (!videoTrack) throw new SilenceCutError('No video track found in this file.')
    if (!audioTrack) throw new SilenceCutError('This video has no sound, so there is nothing to detect silence from.')
    const [videoReadable, audioReadable] = await Promise.all([videoTrack.canDecode(), audioTrack.canDecode()])
    if (!videoReadable || !audioReadable) throw new SilenceCutError(UNREADABLE_FORMAT)

    const [displayWidth, displayHeight, sampleRate, channels] = await Promise.all([
      videoTrack.getDisplayWidth(),
      videoTrack.getDisplayHeight(),
      audioTrack.getSampleRate(),
      audioTrack.getNumberOfChannels(),
    ])
    const videoPackets = new EncodedPacketSink(videoTrack)
    const audioPackets = new EncodedPacketSink(audioTrack)
    const keyAt = async (packets: EncodedPacketSink, timestamp: number) =>
      (await packets.getKeyPacket(timestamp, { verifyKeyPackets: true }))?.timestamp ?? -Infinity
    const spanStart = keep[0].start
    const spanEnd = keep[keep.length - 1].end

    // Everything that can fail on the look's own files fails here, before a
    // single frame is written.
    if (look.logo.image) {
      try {
        logoImage = await createImageBitmap(look.logo.image)
      } catch {
        throw new SilenceCutError("The campaign's logo image couldn't be opened. Pick it again in the campaign's setup.")
      }
    }
    for (const [i, picture] of look.pictures.entries()) {
      try {
        pictureImages.push(await createImageBitmap(picture.image))
      } catch {
        throw new SilenceCutError(`Picture ${i + 1} couldn't be opened. Pick it again in the angle's setup.`)
      }
    }
    for (const cue of bankCues) {
      try {
        bankImages.push(await createImageBitmap(cue.image))
      } catch {
        throw new SilenceCutError("A picture from the bank couldn't be opened. Replace it in the picture bank.")
      }
    }
    const prepared: PreparedSound[] = []
    for (const sound of look.sounds) {
      try {
        prepared.push(await prepareSound(sound.source, sampleRate))
      } catch (error) {
        throw new SilenceCutError(error instanceof Error ? `${error.message[0].toUpperCase()}${error.message.slice(1)}.` : String(error))
      }
    }
    // The clips joined on are opened here too - but one that can't be read
    // is left out, never the reason the video isn't made.
    const leftOut: ClipPlace[] = []
    const openJoined = async (place: ClipPlace): Promise<Clip | null> => {
      const file = joining[place]
      if (!file) return null
      try {
        const clip = await openClip(file, `video ${place}`)
        joined.push(clip)
        return clip
      } catch (error) {
        console.warn(`The video ${place} couldn't be read, so it is left out:`, error)
        leftOut.push(place)
        return null
      }
    }
    const beforeClip = await openJoined('before')
    const afterClip = await openJoined('after')
    const beforeSec = beforeClip ? beforeClip.duration - beforeClip.first : 0
    const afterSec = afterClip ? afterClip.duration - afterClip.first : 0
    // The videos in the middle, the same way: one that can't be read is left out.
    let middleLeftOut = 0
    const middle: { after: number; clip: Clip }[] = []
    for (const insert of inserts) {
      try {
        const clip = await openClip(insert.file, 'video in the middle')
        joined.push(clip)
        middle.push({ after: insert.after, clip })
      } catch (error) {
        console.warn("A video in the middle couldn't be read, so it is left out:", error)
        middleLeftOut++
      }
    }
    const middleSec = middle.reduce((sum, m) => sum + (m.clip.duration - m.clip.first), 0)
    const keptSec = totalDuration(keep)
    const allSec = beforeSec + keptSec + middleSec + afterSec

    // The voice is measured on exactly the audio the video will have, read
    // through once or twice more - a second or two, audio only - so it lands
    // at the same loudness whatever the take. If that goes wrong the video is
    // still made, just as it was recorded.
    const walkKeptAudio: WalkAudio = async (visit) => {
      const reader = new RangeReader(inTimestampOrder(new AudioSampleSink(audioTrack).samples(spanStart, spanEnd)))
      try {
        for (const { start, end } of keep) {
          for await (const sample of reader.range(start, end, await keyAt(audioPackets, start))) {
            visit(planesOf(sample).planes)
            sample.close()
          }
        }
      } finally {
        await reader.dispose().catch(() => {})
      }
    }
    let voice: Voice | null = null
    traceStep('measuring the voice')
    if (boostVoice) {
      try {
        voice = await Voice.measure(sampleRate, channels, walkKeptAudio)
      } catch (error) {
        console.warn('The voice could not be measured, so it is left as recorded:', error)
        voice = null
      }
    }

    // The music, set under the voice as it will sound: where the boost lands
    // it, or as recorded. A track that can't be read leaves the video
    // without music rather than without a video.
    let bed: MusicBed | null = null
    traceStep('the music')
    if (music) {
      try {
        // Only as much of the track as the video uses is decoded (sounds.ts).
        const channelsNeeded = (await prepareMusic(music.audio, 'music', allSec, sampleRate)).channels
        const voiceLufs = voice?.lufs ?? (await measureLoudness(sampleRate, channels, walkKeptAudio))
        const gain = musicGain(trackLoudness(channelsNeeded, sampleRate), voiceLufs, music.level)
        if (gain > 0) bed = new MusicBed(channelsNeeded, sampleRate, Math.round(allSec * sampleRate), gain, voiceLufs)
      } catch (error) {
        console.warn('The music could not be added, so the video is made without it:', error)
        reportProblem({ kind: 'fallback', phase: 'music', message: musicProblem(error, music.audio) })
        bed = null
      }
    }

    // A clip's own sound, set to where his voice sits, so the video doesn't
    // jump in loudness at the join. Left as it is if it can't be measured.
    let voiceLevel: number | null = null
    const levelFor = async (clip: Clip | null): Promise<number> => {
      if (!clip?.audio) return 1
      try {
        const clipLufs = await measureLoudness(sampleRate, channels, (visit) =>
          eachSound(clip, [wholeOf(clip)], sampleRate, channels, visit),
        )
        voiceLevel ??= voice?.lufs ?? (await measureLoudness(sampleRate, channels, walkKeptAudio))
        if (!Number.isFinite(clipLufs) || !Number.isFinite(voiceLevel)) return 1
        return dbToGain(Math.min(CLIP_MAX_LIFT_DB, voiceLevel - clipLufs))
      } catch (error) {
        console.warn('A clip could not be measured, so its sound is left as recorded:', error)
        return 1
      }
    }
    traceStep('the clips joined on')
    const beforeGain = await levelFor(beforeClip)
    const afterGain = await levelFor(afterClip)
    const middleGains: number[] = []
    for (const m of middle) middleGains.push(await levelFor(m.clip))

    // A wide clip (Meta glasses) becomes 9:16; one already 9:16 is untouched.
    const mode = forceVertical && landscapeMode() === 'off' ? 'fill' : landscapeMode()
    // 1080p at its own frame rate, at a bitrate to match (quality.ts).
    const fps = await frameRateOf(videoTrack)
    const { width, height } = makeSize((maxShort) => framedSize(displayWidth, displayHeight, mode, maxShort))
    const framePlan = planFrame(displayWidth, displayHeight, width, height, mode)
    const backdrop = framePlan.blurred ? makeBlurBackdrop() : null
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new SilenceCutError("This browser couldn't prepare a canvas to draw the headline on.")
    // Measured in TikTok Sans, so it has to be here before the lines are laid out.
    traceStep('the headline font')
    await headlineFontReady()
    const headline = layoutHeadline(ctx, width, height, { ...look.headline, text: headlineText })
    const logo = logoImage ? layoutLogo(width, height, logoImage, look.logo) : null
    const pictures = look.pictures.map((picture, i) => ({
      picture,
      image: pictureImages[i],
      layout: layoutLogo(width, height, pictureImages[i], picture),
      placer: new MomentPlacer(pictureMoments[i] ?? [], keep),
    }))
    const bank = bankCues.map((cue, i) => ({
      image: bankImages[i],
      layout: layoutLogo(width, height, bankImages[i], look.bankPlacement),
      placer: new MomentPlacer(cue.moments, keep),
    }))
    // Pop-up videos: each read already shrunk to its box, so a 4K clip costs
    // no more than a small one. One that can't be read here is left out,
    // never the whole video.
    let popsLeftOut = 0
    traceStep('the pop-up videos')
    const popClips: { seconds: number; layout: PopLayout; placer: MomentPlacer; open: () => AsyncIterator<WrappedCanvas> }[] = []
    for (const clip of pops?.clips ?? []) {
      try {
        const popInput = new Input({ source: new BlobSource(clip.file), formats: ALL_FORMATS })
        popInputs.push(popInput)
        const track = await popInput.getPrimaryVideoTrack()
        if (!track || !(await track.canDecode())) throw new Error("this phone can't play it here")
        const first = await firstShown(track)
        const layout = popLayout(width, height, clip, pops!.sizePct, pops!.position)
        const sink = new CanvasSink(track, { width: layout.width, height: layout.height, fit: 'cover', poolSize: 3 })
        popClips.push({ seconds: clip.seconds, layout, placer: new MomentPlacer(clip.moments, keep), open: () => fromStart(sink, first, clip.seconds) })
      } catch (error) {
        popsLeftOut += clip.moments.length > 0 ? 1 : 0
        reportProblem({ kind: 'fallback', phase: 'pop-up video', message: error instanceof Error ? error.message : String(error) })
      }
    }
    if (popClips.length > 0) popPlayer = new PopFrames((i) => popClips[i].open())
    let popsOn = popClips.length > 0

    traceStep('starting the encoder')
    // What the colour went through, sent once (colourCheck.ts).
    const colour = new ColourCheck()
    await colour.noteSource(videoTrack)
    const videoSource = new VideoSampleSource({
      codec: 'avc',
      quality: videoQuality(width, height, fps),
      onEncodedPacket: colour.onEncodedPacket,
    })
    const audioSource = new AudioSampleSource({
      codec: 'aac',
      quality: QUALITY_MEDIUM,
      ...(await audioConversionFor(audioTrack)),
    })
    // `draw` bakes the rotation into the pixels, so the track carries none.
    output.addVideoTrack(videoSource)
    output.addAudioTrack(audioSource)
    await output.start()

    const logoPlacer = new MomentPlacer(logoMoments, keep)
    // Each word placed on the output's timeline with its range's real shift,
    // like the logo, so it pops on the frame the word is heard.
    // Highlight shows each word in its phrase; worked out once for the video.
    const captionPhrases = captionRanges(captions, captionStyle)
    const captionPlacer = new MomentPlacer(
      captions.map((w) => w.start),
      keep,
    )
    const brandPlacer = new MomentPlacer(brandMoments, keep)
    const motion = planMotion(
      gentle ? { ...look.effects, cutPunch: 'off', hookPush: 'off', brandHit: 'off' } : look.effects,
      keep.map((r) => r.end - r.start),
      seed,
      brandMoments.length,
    )
    const soundPlacers = look.sounds.map((sound, i) =>
      sound.trigger.kind === 'start' ? null : new MomentPlacer(soundMoments[i] ?? [], keep),
    )
    // Start sounds go in when he comes on; the rest are added range by range
    // as their moments are placed.
    const placed: PlacedSound[] = []
    const placeStartSounds = (at: number) =>
      look.sounds.forEach((sound, i) => {
        if (sound.trigger.kind === 'start') placed.push({ ...prepared[i], startFrame: Math.round(at * sampleRate), gain: dbToGain(sound.volumeDb) })
      })
    const placeSounds = (index: number, shift: number) => {
      soundPlacers.forEach((placer, i) => {
        if (!placer) return
        const before = placer.times.length
        placer.enterRange(index, shift)
        for (const t of placer.times.slice(before)) {
          placed.push({ ...prepared[i], startFrame: Math.round(t * sampleRate), gain: dbToGain(look.sounds[i].volumeDb) })
        }
      })
    }

    traceStep('making the frames')
    videoFrames = new RangeReader(inTimestampOrder(new VideoSampleSink(videoTrack).samples(spanStart, spanEnd)))
    audioFrames = new RangeReader(inTimestampOrder(new AudioSampleSink(audioTrack).samples(spanStart, spanEnd)))
    const audioReader = audioFrames
    // On an iPhone the video decoder can give up partway through a long 4K
    // video ("Decoder failure") - drawing every frame onto the canvas keeps
    // it far busier than the plain cutter does. Starting the whole video
    // again only walks into the same wall, so a fresh decoder picks up just
    // after the last frame written, and nothing already made is lost.
    let lastWritten = -Infinity
    let recovered = 0

    const total = allSec
    let doneSoFar = 0
    let cursor = 0
    const videoClock = forwardOnly()
    const audioClock = contiguousAudio()

    /** A clip joined on whole, from `at` on the finished video: its picture
     *  filling the frame with nothing over it, its sound levelled by `gain`
     *  with the music under it. Returns where it ends. */
    const writeClip = (clip: Clip, at: number, gain: number): Promise<number> => {
      const place = cover(clip.width, clip.height, width, height)
      // Its sound fades in and out over a few ms too, so it doesn't click
      // against him either side (cutFades.ts).
      const clipEnd = at + (clip.duration - clip.first)
      const clipEdges = { fadeIn: true, fadeOut: true }
      return writeWhole(clip, at, {
        rate: sampleRate,
        channels,
        videoClock,
        audioClock,
        maxRecoveries: MAX_RECOVERIES,
        onFrame: async (sample, timestamp) => {
          traceRead()
          report(timestamp / total)
          ctx.fillStyle = '#000'
          ctx.fillRect(0, 0, width, height)
          sample.draw(ctx, place.x, place.y, place.width, place.height)
          const frame = new VideoSample(canvas, { timestamp, duration: sample.duration })
          await videoSource.add(frame)
          traceWritten()
          frame.close()
        },
        onSound: async (planes, timestamp) => {
          const length = planes[0].length
          const data = new Float32Array(length * channels)
          const out = planes.map((plane, c) => {
            const into = data.subarray(c * length, (c + 1) * length)
            for (let i = 0; i < length; i++) into[i] = plane[i] * gain
            return into
          })
          const firstFrame = Math.round(timestamp * sampleRate)
          if (nearCut(timestamp, length / sampleRate, at, clipEnd, clipEdges)) fadeAtCuts(out, timestamp, sampleRate, at, clipEnd, clipEdges)
          bed?.mixInto(out, firstFrame)
          mixInto(out, firstFrame, placed, !voice)
          if (voice) voice.limit(out)
          else for (const plane of out) for (let i = 0; i < plane.length; i++) plane[i] = Math.max(-1, Math.min(1, plane[i]))
          const sample = new AudioSample({ data, format: 'f32-planar', numberOfChannels: channels, sampleRate, timestamp })
          await audioSource.add(sample)
          sample.close()
        },
      })
    }

    if (beforeClip) {
      cursor = await writeClip(beforeClip, 0, beforeGain)
      doneSoFar = cursor
    }
    // Where he comes on: his headline, start sounds and hook push-in are
    // timed from here.
    const talkStart = cursor
    placeStartSounds(talkStart)
    // Which ends of each kept part are a cut, where his sound fades.
    const edges = cutEdges(keep, middle.map((m) => m.after))

    for (let index = 0; index < keep.length; index++) {
      const { start, end } = keep[index]
      let videoShift: number | null = null
      let audioShift: number | null = null
      let videoEnd = cursor
      let audioEnd = cursor
      const [videoFrom, audioFrom] = await Promise.all([keyAt(videoPackets, start), keyAt(audioPackets, start)])

      await Promise.all([
        (async () => {
          let from = start
          let decodeFrom = videoFrom
          for (;;) {
            try {
              for await (const sample of videoFrames!.range(from, end, decodeFrom)) {
                // Written before the decoder gave up.
                if (sample.timestamp <= lastWritten) {
                  sample.close()
                  continue
                }
                traceRead()
                report((doneSoFar + (sample.timestamp - start)) / total)
                if (videoShift === null) {
                  videoShift = cursor - sample.timestamp
                  logoPlacer.enterRange(index, videoShift)
                  captionPlacer.enterRange(index, videoShift)
                  brandPlacer.enterRange(index, videoShift)
                  for (const p of pictures) p.placer.enterRange(index, videoShift)
                  for (const b of bank) b.placer.enterRange(index, videoShift)
                  for (const p of popClips) p.placer.enterRange(index, videoShift)
                }
                const timestamp = videoClock(sample.timestamp + videoShift)
                const duration = sample.duration
                videoEnd = timestamp + duration
                const framing = framingAt(
                  motion,
                  index,
                  timestamp - talkStart,
                  talkStart === 0 ? brandPlacer.times : brandPlacer.times.map((at) => at - talkStart),
                )
                colour.noteFrame(sample)
                if (backdrop) {
                  // Fit: the whole picture over a blurred copy; no zoom here.
                  backdrop.draw(ctx, sample, width, height, displayWidth, displayHeight)
                  const m = framePlan.main
                  sample.draw(ctx, m.x, m.y, m.width, m.height)
                } else if (framing.scale === 1 && framing.dx === 0) {
                  const m = framePlan.main
                  sample.draw(ctx, m.x, m.y, m.width, m.height)
                } else {
                  // Drawn larger than the canvas, from the full-size frame - so a
                  // zoom into 4K footage loses no sharpness at all.
                  const m = framePlan.main
                  const inner = placeFrame(framing, m.width, m.height)
                  const x = Math.min(0, Math.max(width - inner.width, m.x + inner.x))
                  const y = Math.min(0, Math.max(height - inner.height, m.y + inner.y))
                  sample.draw(ctx, x, y, inner.width, inner.height)
                }
                sample.close()
                // Pictures under the headline and logo: those two always read.
                // Ones that came up together - one word bringing up two - sit
                // side by side instead of on top of each other.
                const up = pictures.flatMap((p) =>
                  inWindow(timestamp, p.placer.times, p.picture.seconds)
                    ? [{ item: p, start: Math.max(...p.placer.times.filter((at) => at <= timestamp)) }]
                    : [],
                )
                const startOf = new Map(up.map((u) => [u.item, u.start]))
                for (const group of cameUpTogether(up)) {
                  const placed = sideBySide(group.map((p) => p.layout), width, height)
                  group.forEach((p, k) => {
                    const since = timestamp - startOf.get(p)!
                    if (look.effects.logoPop) drawPoppedLogo(ctx, p.image, placed[k], logoPop(since, p.picture.seconds - since))
                    else drawLogo(ctx, p.image, placed[k])
                  })
                }
                // The bank's pictures share one spot: the newest one mentioned
                // replaces whatever was there - and ones mentioned with it, by
                // the same word, share the spot side by side.
                const live: { entry: (typeof bank)[number]; at: number }[] = []
                for (const entry of bank) {
                  const at = Math.max(-Infinity, ...entry.placer.times.filter((a) => a <= timestamp && timestamp < a + look.bankPlacement.seconds))
                  if (Number.isFinite(at)) live.push({ entry, at })
                }
                const newest = Math.max(-Infinity, ...live.map((l) => l.at))
                const shown = live.filter((l) => newest - l.at < TOGETHER_SEC).sort((a, b) => a.at - b.at)
                if (shown.length > 0) {
                  const placed = sideBySide(shown.map((l) => l.entry.layout), width, height)
                  shown.forEach((l, k) => {
                    const since = timestamp - l.at
                    if (look.effects.logoPop) drawPoppedLogo(ctx, l.entry.image, placed[k], logoPop(since, look.bankPlacement.seconds - since))
                    else drawLogo(ctx, l.entry.image, placed[k])
                  })
                }
                // A pop-up video over him and the pictures, under the
                // headline, logo and captions. Muted: its sound is never read.
                if (popsOn && popPlayer) {
                  const on = popAt(occurrencesOf(popClips.map((p) => ({ seconds: p.seconds, times: p.placer.times }))), timestamp)
                  try {
                    if (on) {
                      const frame = await popPlayer.at(on, timestamp - on.at)
                      if (frame) drawPop(ctx, frame.canvas, popClips[on.clip].layout, logoPop(timestamp - on.at, on.at + on.seconds - timestamp))
                    } else await popPlayer.stop()
                  } catch (error) {
                    // The phone couldn't keep two videos going: the rest of
                    // this one is made without pop-ups rather than not at all.
                    popsOn = false
                    popsLeftOut = Math.max(popsLeftOut, 1)
                    await popPlayer.stop().catch(() => {})
                    reportProblem({ kind: 'fallback', phase: 'pop-up video', message: error instanceof Error ? error.message : String(error) })
                  }
                }
                if (headline && timestamp - talkStart < look.headline.seconds) drawHeadline(ctx, headline)
                if (logo && logoImage && inWindow(timestamp, logoPlacer.times, look.logo.seconds)) {
                  if (look.effects.logoPop) {
                    const since = timestamp - Math.max(...logoPlacer.times.filter((at) => at <= timestamp))
                    drawPoppedLogo(ctx, logoImage, logo, logoPop(since, look.logo.seconds - since))
                  } else drawLogo(ctx, logoImage, logo)
                }
                // The caption on top of everything: it is what is being said.
                const word = captionAt(captionPlacer.times, captions, timestamp)
                if (word >= 0) {
                  const since = timestamp + CAPTION_LEAD - captionPlacer.times[word]
                  drawStyledCaption(ctx, width, height, captions, captionPhrases, word, since, false, captionPosition, captionSize, captionStyle)
                }
                // The new sample copies the canvas, so one canvas does every frame.
                const frame = new VideoSample(canvas, { timestamp, duration })
                await videoSource.add(frame)
                traceWritten()
                frame.close()
                lastWritten = sample.timestamp
              }
              return
            } catch (error) {
              if (!decoderGaveUp(error)) throw error
              await videoFrames?.dispose().catch(() => {})
              if (document.visibilityState !== 'visible') {
                // Taken away because he left the app: not the video's fault,
                // and not counted. It carries on from here when he is back.
                await visibleAgain()
              } else {
                if (recovered >= MAX_RECOVERIES) throw error
                recovered++
                // A breath for the phone, then a fresh decoder from where
                // this one stopped.
                await pause(500)
              }
              from = Math.max(start, lastWritten)
              videoFrames = new RangeReader(inTimestampOrder(new VideoSampleSink(videoTrack).samples(from, spanEnd)))
              decodeFrom = await keyAt(videoPackets, from)
            }
          }
        })(),
        (async () => {
          for await (const sample of audioReader.range(start, end, audioFrom)) {
            if (audioShift === null) {
              audioShift = cursor - sample.timestamp
              placeSounds(index, audioShift)
            }
            const timestamp = audioClock(sample.timestamp + audioShift, sample.duration)
            audioEnd = timestamp + sample.duration
            // A chunk at a cut fades, so the join doesn't click (cutFades.ts).
            const at = sample.timestamp
            const fading = nearCut(at, sample.duration, start, end, edges[index])
            if (voice || bed || fading) {
              // Voice first (faded at the cuts), then the music under it and
              // the sounds over it, then the ceiling over all of them.
              const { data, planes } = planesOf(sample)
              const { sampleRate: rate, numberOfChannels } = sample
              sample.close()
              const firstFrame = Math.round(timestamp * rate)
              if (fading) fadeAtCuts(planes, at, rate, start, end, edges[index])
              voice?.shape(planes)
              bed?.mixInto(planes, firstFrame)
              mixInto(planes, firstFrame, placed, !voice)
              if (voice) voice.limit(planes)
              else for (const plane of planes) for (let i = 0; i < plane.length; i++) plane[i] = Math.max(-1, Math.min(1, plane[i]))
              const shaped = new AudioSample({ data, format: 'f32-planar', numberOfChannels, sampleRate: rate, timestamp })
              await audioSource.add(shaped)
              shaped.close()
              continue
            }
            const mixed = withSounds(sample, timestamp, placed)
            if (mixed) {
              sample.close()
              await audioSource.add(mixed)
              mixed.close()
            } else {
              sample.setTimestamp(timestamp)
              await audioSource.add(sample)
              sample.close()
            }
          }
        })(),
      ])
      cursor = Math.max(videoEnd, audioEnd)
      doneSoFar += end - start
      onProgress?.(Math.min(0.99, doneSoFar / total))
      // A video in the middle, said for right here: it plays whole, and the
      // next part - and everything timed in it - starts after it.
      for (const [i, m] of middle.entries()) {
        if (m.after !== index) continue
        const startedAt = cursor
        cursor = await writeClip(m.clip, cursor, middleGains[i])
        doneSoFar += cursor - startedAt
      }
    }

    const afterStart = cursor
    if (afterClip) cursor = await writeClip(afterClip, afterStart, afterGain)

    traceStep('finishing the file')
    await output.finalize()
    const blob = await sink.finish()
    if (blob.size === 0) throw new SilenceCutError('Rendering finished but produced no file. Try again.')
    finished = true
    onProgress?.(1)
    return {
      blob,
      storedAs: sink.storedAs,
      logoAt: [...logoPlacer.times],
      picturesAt: pictures.map((p) => [...p.placer.times]),
      bankAt: bank.flatMap((b) => [...b.placer.times]).sort((a, b) => a - b),
      recovered,
      clips: { beforeSec: talkStart, afterSec: afterClip ? cursor - afterStart : 0, leftOut, middleSec, middleLeftOut },
      popsAt: popClips.flatMap((p) => [...p.placer.times]).sort((a, b) => a - b),
      popsLeftOut,
    }
  } finally {
    logoImage?.close()
    for (const image of [...pictureImages, ...bankImages]) image.close()
    await Promise.all([videoFrames?.dispose(), audioFrames?.dispose()]).catch(() => {})
    for (const clip of joined) clip.input.dispose()
    await popPlayer?.stop().catch(() => {})
    for (const popInput of popInputs) popInput.dispose()
    input.dispose()
    if (!finished) {
      await output.cancel().catch(() => {})
      await sink.discard()
    }
  }
}

/** A sample's audio as one array per channel, all in one buffer that a new
 *  sample can be made from. */
function planesOf(sample: AudioSample): { data: Float32Array; planes: Float32Array[] } {
  const { numberOfChannels, numberOfFrames } = sample
  const data = new Float32Array(numberOfFrames * numberOfChannels)
  const planes = Array.from({ length: numberOfChannels }, (_, c) => {
    const plane = data.subarray(c * numberOfFrames, (c + 1) * numberOfFrames)
    sample.copyTo(plane, { planeIndex: c, format: 'f32-planar' })
    return plane
  })
  return { data, planes }
}

/** The same audio with any sounds playing over it mixed in, as a new sample
 *  at `timestamp` - or null when no sound is playing here, so the sample can
 *  go through untouched. */
function withSounds(sample: AudioSample, timestamp: number, sounds: readonly PlacedSound[]): AudioSample | null {
  if (sounds.length === 0) return null
  const { sampleRate, numberOfChannels, numberOfFrames } = sample
  const firstFrame = Math.round(timestamp * sampleRate)
  const lastFrame = firstFrame + numberOfFrames
  if (!sounds.some((s) => s.startFrame < lastFrame && s.startFrame + (s.channels[0]?.length ?? 0) > firstFrame)) {
    return null
  }
  const { data, planes } = planesOf(sample)
  mixInto(planes, firstFrame, sounds)
  return new AudioSample({ data, format: 'f32-planar', numberOfChannels, sampleRate, timestamp })
}
