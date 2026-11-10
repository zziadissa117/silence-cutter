// Cuts the silent parts out of a video, entirely on-device - nothing is
// uploaded anywhere. Built on mediabunny, which wraps the browser's own
// WebCodecs hardware decoder/encoder, so this is as fast as the phone can go
// and never touches the network.
//
// Two passes over the file: analyzeSilence() decodes just the audio to find
// where the pauses are (silenceMath.ts does that math), then cutSilence()
// decodes both tracks and re-encodes only the ranges worth keeping.

import {
  ALL_FORMATS,
  AudioSample,
  AudioSampleSink,
  AudioSampleSource,
  BlobSource,
  canEncodeAudio,
  canEncodeVideo,
  EncodedPacketSink,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  QUALITY_MEDIUM,
  UnsupportedInputFormatError,
  VideoSample,
  VideoSampleSink,
  VideoSampleSource,
} from 'mediabunny'

import { audioExtent, decodeAudio, throttled } from './audio'
import { buildCaptionCues, type CaptionCue } from './captions'
import { SilenceCutError } from './errors'
import {
  WHISPER_SAMPLE_RATE,
  alignToAudio,
  fillerWordRanges,
  stutterRanges,
  isFillerWordDetectionSupported,
  type WordChunk,
} from './fillerWords'
import { contiguousAudio, forwardOnly } from './forwardOnly'
import { createOutputSink } from './outputSink'
import { RangeReader, inTimestampOrder } from './rangeReader'
import { asRenderError, decoderGaveUp, encoderGaveUp, pause, visibleAgain } from './recovery'
import {
  BALANCED_SETTINGS,
  findSilentRanges,
  keepRanges,
  mergeRanges,
  speechWindows,
  totalDuration,
  type Level,
  type Range,
  type SilenceSettings,
} from './silenceMath'
import { transcribeOnDevice } from './transcribe'
import { onEncodedPacketMatchingColour } from '../campaign/colourCheck'

export { SilenceCutError }

/** How many times a video's decoder giving up is picked up again before the
 *  cut fails - the campaign renders' number. */
const MAX_RECOVERIES = 4

/** The 10-bit HDR encoder said it could and then could not. Only this is
 *  worth a second go without HDR - any other failure would just fail again,
 *  after the whole cut had been made a second time. */
class HdrEncodeFailed extends Error {
  constructor(original: unknown) {
    super(original instanceof Error ? original.message : String(original))
  }
}

const UNREADABLE_FORMAT =
  "This browser can't read this video's format. On a computer, open this page in Safari or Chrome; on a phone, update to the newest iOS."

/** True once this browser can actually decode and re-encode video and audio.
 *  Safari only gained AudioEncoder/AudioDecoder in Safari 26 (2026); older
 *  iOS builds can decode video but never finish this, so check honestly
 *  rather than let it fail midway through someone's clip. */
export async function isSilenceCutSupported(): Promise<boolean> {
  if (typeof VideoEncoder === 'undefined' || typeof AudioEncoder === 'undefined') return false
  const [video, audio] = await Promise.all([canEncodeVideo('avc'), canEncodeAudio('aac')])
  return video && audio
}

/** Loudness of one audio window, in dB, from its root-mean-square amplitude.
 *  Silence is -Infinity dB, which is always below any real threshold. */
const HDR_CODEC_CANDIDATES = [
  'hvc1.2.4.L153.B0', // Main 10, level 5.1 - 4K
  'hvc1.2.4.L150.B0', // Main 10, level 5.0
  'hvc1.2.4.L123.B0', // Main 10, level 4.1 - 1080p
  'hvc1.2.4.L120.B0', // Main 10, level 4.0
]

/** Finds a 10-bit codec this device can actually encode at these dimensions,
 *  so HDR footage can be re-encoded as HDR and come out looking exactly like
 *  it went in. Returns null when the device has no 10-bit encoder, which is
 *  the case in Chrome today - there the colour has to be converted instead. */
async function findHdrCodec(width: number, height: number): Promise<string | null> {
  if (typeof VideoEncoder === 'undefined') return null
  for (const codec of HDR_CODEC_CANDIDATES) {
    try {
      const support = await VideoEncoder.isConfigSupported({ codec, width, height, bitrate: 12_000_000 })
      if (support.supported) return codec
    } catch {
      // Not supported; try the next one.
    }
  }
  return null
}

/** What every AAC encoder takes: 48kHz, at most stereo. */
const SAFE_SAMPLE_RATE = 48000
const MAX_CHANNELS = 2

/** How the audio has to be converted before this device will encode it, if at
 *  all. AAC encoders only take a handful of sample rates - Chrome's refuses
 *  32kHz, which some apps and screen recordings use - and some take no more
 *  than two channels. Nothing is converted when the device can take the
 *  audio as it is, so a normal video comes out exactly as it always did. */
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

export interface SilenceCutResult {
  blob: Blob
  /** Name of the file in private storage, for deleting it once it is off the
   *  screen. Null when the browser kept it in memory instead. */
  storedAs: string | null
  originalDurationSec: number
  newDurationSec: number
  /** Number of pauses removed. */
  cuts: number
  /** Number of spoken filler words removed ("um", "uh"...), only present
   *  when filler-word detection was turned on for this video. */
  fillerWords?: number
  /** Number of stumbles removed - a small word repeated, like "I-I-I". Only
   *  present when filler-word detection was on. */
  stutters?: number
  /** Caption lines, timed to this result's own (cut) video - not the
   *  original. Only present when `detectCaptions` was on. Editable by the
   *  caller before being written out as an .srt: this is plain data, not a
   *  file, precisely so a transcription mistake can be fixed without
   *  re-cutting the video. */
  captionCues?: CaptionCue[]
  /** How many times the phone's video decoder gave up partway and was
   *  started again from the last frame; absent when it never did. */
  recovered?: number
}

export interface CutOptions {
  /** Also transcribe the video (on-device, English only) and cut spoken
   *  filler words like "um"/"uh". Doesn't catch coughs, laughs or other
   *  non-speech noise - Whisper transcribes words, and a cough isn't one. */
  detectFillerWords?: boolean
  /** Also transcribe the video and return caption cues timed to the cut
   *  output, ready to edit and save as an .srt. Shares the same
   *  transcription pass as `detectFillerWords` when both are on. */
  detectCaptions?: boolean
  /** 0-1 while the audio is decoded and its quiet parts found, before any
   *  video is touched. On a long take that is a big share of the wait. */
  onAnalyseProgress?: (fraction: number) => void
  /** 0-1 while the model downloads the first time it's used in this tab -
   *  fast on every call after, since transformers.js caches it. */
  onModelDownload?: (fraction: number) => void
  /** 0-1 while the video is being transcribed, before the cut render starts.
   *  Only called when `detectFillerWords` or `detectCaptions` is on. */
  onTranscribeProgress?: (fraction: number) => void
}

/** Finds the ranges of this video worth keeping - i.e. the file with its
 *  pauses (and, optionally, filler words) cut out, before anything is
 *  actually re-encoded. Call this first so the UI can show "12s of dead air
 *  found" before committing to the slower cut pass. */
export async function planCut(
  file: Blob,
  settings: SilenceSettings = BALANCED_SETTINGS,
  options: CutOptions = {},
): Promise<{
  keep: Range[]
  duration: number
  silences: number
  fillerWords: number
  stutters: number
  words: WordChunk[]
}> {
  let duration: number
  let levels: Level[]
  let mono16k: Float32Array | null
  // When the sound starts, in the video's own time - a phone's AAC starts a
  // little before zero once its edit list is applied; see media/audio.ts.
  let audioStart = 0
  const wantFillerWords = !!options.detectFillerWords && isFillerWordDetectionSupported()
  // Captions need the same transcript as filler-word detection, so asking
  // for either turns on the one transcription pass below - never two.
  const wantCaptions = !!options.detectCaptions && isFillerWordDetectionSupported()
  const wantWords = wantFillerWords || wantCaptions

  {
    // Scoped so the audio decoder is let go before transcription starts.
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
    try {
      const [d, audioTrack] = await Promise.all([input.computeDuration(), input.getPrimaryAudioTrack()]).catch(
        (error: unknown) => {
          throw error instanceof UnsupportedInputFormatError
            ? new SilenceCutError("This file isn't a video this app can open. Try exporting it again as an MP4 or MOV.")
            : error
        },
      )
      if (!audioTrack) {
        throw new SilenceCutError('This video has no sound, so there is nothing to detect silence from.')
      }
      if (!(await audioTrack.canDecode())) throw new SilenceCutError(UNREADABLE_FORMAT)
      duration = d
      ;({ levels, mono16k, audioStart } = await decodeAudio(audioTrack, wantWords, d, options.onAnalyseProgress))
    } finally {
      input.dispose()
    }
  }

  const silences = findSilentRanges(levels, settings)

  let fillerWords: Range[] = []
  let stutters: Range[] = []
  let words: WordChunk[] = []
  if (wantWords && mono16k) {
    // Finished - and its worker ended, so its memory is back - before the
    // video re-encode starts, so the two never add up.
    // Only as far as there is sound to hear. A file can claim to run longer
    // than its audio does - a browser recording claimed minutes for a 13s
    // clip - and every window past the real end is the model listening to
    // nothing, a second at a time.
    const audible = Math.min(duration, audioStart + mono16k.length / WHISPER_SAMPLE_RATE)
    const heard = await transcribeOnDevice(mono16k, WHISPER_SAMPLE_RATE, speechWindows(silences, audible), {
      audioStart,
      onModelDownload: options.onModelDownload,
      onProgress: options.onTranscribeProgress,
    })
    // The model's timings run late; line them up with the sound before
    // anything is cut or captioned from them. See alignToAudio.
    words = alignToAudio(heard, levels, settings.thresholdDb)
    if (wantFillerWords) {
      // keepRanges pulls `paddingSec` off both ends of everything it is
      // given, which is right for a silence but would leave half an "um"
      // behind here. These ends are already exactly where they should be,
      // so they are widened by the same amount first and come out unchanged.
      // Never widened right to 0: a cut starting exactly at 0 reads as the
      // head silence to keepRanges, which keeps a breath there instead.
      const uncramp = (range: Range) => ({
        start: Math.max(0.011, range.start - settings.paddingSec),
        end: Math.min(duration, range.end + settings.paddingSec),
      })
      // Fenced in by the real words either side and checked against the
      // audio itself. See fillerWordRanges and stutterRanges.
      const cutOptions = { guardSec: 0.04, quietBelowDb: settings.thresholdDb }
      fillerWords = fillerWordRanges(words, levels, cutOptions).map(uncramp)
      stutters = stutterRanges(words, levels, cutOptions).map(uncramp)
    }
  }

  const toCut = mergeRanges([...silences, ...fillerWords, ...stutters])
  // Against the sound's own extent: a track that starts late or ends early
  // is head or tail silence, not a pause in the middle.
  const keep = keepRanges(toCut, duration, settings.paddingSec, audioExtent(levels))
  if (keep.length === 0) {
    throw new SilenceCutError('The whole video looks silent. Try recording somewhere quieter.')
  }
  return {
    keep,
    duration,
    words,
    silences: silences.length,
    fillerWords: fillerWords.length,
    stutters: stutters.length,
  }
}

/** Re-encodes `file`, keeping only the given ranges, and returns the cut
 *  video as an MP4 blob. `onProgress` is called with a 0-1 fraction. */
export async function cutSilence(
  file: Blob,
  keep: Range[],
  onProgress?: (fraction: number) => void,
): Promise<CutOutput> {
  try {
    return await renderCut(file, keep, onProgress, true)
  } catch (error) {
    if (!(error instanceof HdrEncodeFailed)) throw error
    // Keeping HDR means asking for a 10-bit encoder that only some devices
    // have, and it cannot be tested anywhere it does not exist. If the device
    // said it could and then could not, convert the colour and go again -
    // a video that looks slightly different beats an error and no video.
    return await renderCut(file, keep, onProgress, false)
  }
}

/** What a cut came out as: the file, and where each kept range really landed
 *  in it - a frame later than the plan at every cut - so captions and the
 *  length shown come from the video, not the plan. */
export interface CutOutput {
  blob: Blob
  storedAs: string | null
  recovered: number
  /** Per kept range, what to add to a source time in it to get its output time. */
  shifts: number[]
  /** How long the file really is. */
  outputDuration: number
}

async function renderCut(
  file: Blob,
  keep: Range[],
  onProgress: ((fraction: number) => void) | undefined,
  allowHdr: boolean,
): Promise<CutOutput> {
  if (!(await isSilenceCutSupported())) {
    throw new SilenceCutError(
      "This browser can't cut video yet. Update to the newest iOS/Safari, or use the Mac version.",
    )
  }

  const report = throttled(onProgress)
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
  // Streamed to disk as it is encoded, never held whole in memory - see
  // outputSink.ts for why that is the difference between working on an
  // iPhone and crashing it. `fastStart: false` writes the index at the end,
  // so nothing has to be kept back until the file is finished.
  const sink = await createOutputSink()
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: false }), target: sink.target })
  let finished = false
  let videoFrames: RangeReader<VideoSample> | null = null
  let audioFrames: RangeReader<AudioSample> | null = null
  let keepingHdr = false

  try {
    const [videoTrack, audioTrack] = await Promise.all([
      input.getPrimaryVideoTrack(),
      input.getPrimaryAudioTrack(),
    ])
    if (!videoTrack) throw new SilenceCutError('No video track found in this file.')
    if (!audioTrack) throw new SilenceCutError('This video has no sound, so there is nothing to detect silence from.')
    const [videoReadable, audioReadable] = await Promise.all([videoTrack.canDecode(), audioTrack.canDecode()])
    if (!videoReadable || !audioReadable) throw new SilenceCutError(UNREADABLE_FORMAT)

    const [isHdr, rotation, displayWidth, displayHeight] = await Promise.all([
      videoTrack.hasHighDynamicRange(),
      videoTrack.getRotation(),
      videoTrack.getDisplayWidth(),
      videoTrack.getDisplayHeight(),
    ])

    // An iPhone records HDR by default, and HDR frames cannot go into an
    // 8-bit H.264 encoder as they are: Chrome refuses outright ("Encoding
    // error"), and Safari accepts them and silently writes something that
    // looks like a filter has been dropped over the whole video.
    //
    // The right answer is not to convert the colour at all. Re-encoding HDR
    // as HDR - 10-bit HEVC, which is what the phone shot in the first place -
    // leaves it looking exactly as it went in, which is what the desktop
    // Silence Cutter has always done. Converting to sRGB is only the fallback
    // for devices with no 10-bit encoder, because a converted picture is
    // still better than a broken one.
    const hdrCodec = isHdr && allowHdr ? await findHdrCodec(displayWidth, displayHeight) : null
    keepingHdr = isHdr && hdrCodec !== null
    const converting = isHdr && !keepingHdr

    let canvas: OffscreenCanvas | null = null
    let ctx: OffscreenCanvasRenderingContext2D | null = null
    if (converting) {
      // H.264 wants even dimensions, and `draw` writes the frame already
      // rotated, so the canvas is the *display* size, not the coded size.
      const width = displayWidth - (displayWidth % 2)
      const height = displayHeight - (displayHeight % 2)
      canvas = new OffscreenCanvas(width, height)
      ctx = canvas.getContext('2d')
      if (!ctx) throw new SilenceCutError("This browser couldn't prepare the video for colour conversion.")
    }

    const videoSource = keepingHdr
      ? new VideoSampleSource({
          codec: 'hevc',
          quality: QUALITY_HIGH,
          // mediabunny builds an 8-bit Main-profile codec string from the
          // codec name alone; this rewrites it to the 10-bit one before the
          // encoder is asked whether it can do it. Same object, checked and
          // then used - see media-source.js.
          onEncoderConfig: (config) => {
            if (hdrCodec) config.codec = hdrCodec
          },
        })
      : new VideoSampleSource({ codec: 'avc', quality: QUALITY_HIGH, onEncodedPacket: onEncodedPacketMatchingColour })
    const audioSource = new AudioSampleSource({
      codec: 'aac',
      quality: QUALITY_MEDIUM,
      ...(await audioConversionFor(audioTrack)),
    })
    // `draw` bakes the rotation into the pixels, so a converted track must
    // not *also* carry rotation metadata - that would turn it sideways.
    output.addVideoTrack(videoSource, converting ? {} : { rotation })
    output.addAudioTrack(audioSource)
    await output.start()

    // One decoder per track for the whole cut, walked through the kept ranges
    // in order - not a fresh one per range. Cutting "um"s multiplies the
    // ranges, and a new 4K decoder for each of them brought Safari's GPU
    // process down on an iPhone 15 ("decoding task did not complete"). Each
    // range still gets exactly the frames it always did; see rangeReader.ts.
    const spanStart = keep[0].start
    const spanEnd = keep[keep.length - 1].end
    videoFrames = new RangeReader(inTimestampOrder(new VideoSampleSink(videoTrack).samples(spanStart, spanEnd)))
    audioFrames = new RangeReader(inTimestampOrder(new AudioSampleSink(audioTrack).samples(spanStart, spanEnd)))
    const audioReader = audioFrames
    // Where a decoder seeking to each range's start would have begun - an
    // index lookup, no decoding - so a range starting a hair before a key
    // frame still begins cleanly on it. See rangeReader.ts.
    const videoPackets = new EncodedPacketSink(videoTrack)
    const audioPackets = new EncodedPacketSink(audioTrack)
    const keyAt = async (packets: EncodedPacketSink, timestamp: number) =>
      (await packets.getKeyPacket(timestamp, { verifyKeyPackets: true }))?.timestamp ?? -Infinity

    const total = totalDuration(keep)
    let doneSoFar = 0
    // Output timeline position, in seconds. Anchored independently per track
    // per range (see below) rather than to the range's nominal boundaries,
    // so a few milliseconds of audio/video misalignment at one cut can never
    // carry over and stack up by the next one.
    let cursor = 0
    const videoClock = forwardOnly()
    const audioClock = contiguousAudio()
    // The phone's decoder can give up partway through a long video ("Decoder
    // failure" on 90-335 MB iPhone takes). It is picked up again from the
    // last frame written, a few times at most - as the campaign renders do.
    let lastWritten = -Infinity
    let recovered = 0
    const shifts: number[] = []

    for (const { start, end } of keep) {
      // Video and audio frames rarely land exactly on `start` - a decoder
      // only hands back whole frames, and an AAC frame's ~21ms grid has
      // nothing to do with where a silence happened to get cut. Each track
      // is shifted so *its own* first frame in this range starts exactly at
      // `cursor`, instead of both sharing one shift computed from `start`.
      // Sharing one shift was the bug: any gap between the tracks' true
      // first-sample timestamps became a permanent, compounding offset.
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
                // Driven by the video, not the audio: audio decodes far faster
                // than frames encode, so reporting on audio ran the bar up to
                // near the end of a range and then left it there.
                report((doneSoFar + (sample.timestamp - start)) / total)
                videoShift ??= cursor - sample.timestamp
                const timestamp = videoClock(sample.timestamp + videoShift)
                videoEnd = timestamp + sample.duration
                const decodedAt = sample.timestamp
                if (ctx && canvas) {
                  // Drawing to the canvas is what performs the colour
                  // conversion. The new sample copies the canvas's pixels, so
                  // one canvas can be reused for every frame.
                  sample.draw(ctx, 0, 0)
                  const converted = new VideoSample(canvas, { timestamp, duration: sample.duration })
                  sample.close()
                  await videoSource.add(converted)
                  converted.close()
                } else {
                  sample.setTimestamp(timestamp)
                  await videoSource.add(sample)
                  sample.close()
                }
                lastWritten = decodedAt
              }
              return
            } catch (error) {
              if (!decoderGaveUp(error)) throw asRenderError(error)
              await videoFrames?.dispose().catch(() => {})
              if (document.visibilityState !== 'visible') {
                // Taken away because the page went to the background: not the
                // video's fault, and not counted. It carries on on return.
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
            audioShift ??= cursor - sample.timestamp
            sample.setTimestamp(audioClock(sample.timestamp + audioShift, sample.duration))
            audioEnd = sample.timestamp + sample.duration
            await audioSource.add(sample)
            sample.close()
          }
        })(),
      ])
      // Where this range landed: the video's own shift, or - a range with no
      // frame in it - where the cursor stood.
      shifts.push(videoShift ?? cursor - start)
      // The next range starts after whichever track actually ran longer -
      // never behind either one, so the two tracks can't overlap.
      cursor = Math.max(videoEnd, audioEnd)
      doneSoFar += end - start
      onProgress?.(Math.min(0.99, doneSoFar / total))
    }

    await output.finalize()
    const blob = await sink.finish()
    if (blob.size === 0) throw new SilenceCutError('Rendering finished but produced no file. Try again.')
    finished = true
    onProgress?.(1)
    return { blob, storedAs: sink.storedAs, recovered, shifts, outputDuration: cursor }
  } catch (error) {
    // Only the encoder refusing earns a second cut without HDR - anything
    // else would fail again after the whole cut had been made twice.
    if (keepingHdr && encoderGaveUp(error)) throw new HdrEncodeFailed(error)
    throw error
  } finally {
    await Promise.all([videoFrames?.dispose(), audioFrames?.dispose()]).catch(() => {})
    input.dispose()
    if (!finished) {
      await output.cancel().catch(() => {})
      await sink.discard()
    }
  }
}

/** The whole job in one call: plan (silence, and optionally filler words),
 *  then cut. Kept separate above so a UI that wants to show the plan before
 *  committing to the slow pass still can. */
export async function cutSilenceFromFile(
  file: Blob,
  onProgress?: (fraction: number) => void,
  settings: SilenceSettings = BALANCED_SETTINGS,
  options: CutOptions = {},
): Promise<SilenceCutResult> {
  const { keep, duration, silences, fillerWords, stutters, words } = await planCut(file, settings, options)
  const { blob, storedAs, recovered, shifts, outputDuration } = await cutSilence(file, keep, onProgress)
  return {
    blob,
    storedAs,
    ...(recovered > 0 ? { recovered } : {}),
    originalDurationSec: duration,
    newDurationSec: outputDuration,
    cuts: silences,
    ...(options.detectFillerWords ? { fillerWords, stutters } : {}),
    ...(options.detectCaptions ? { captionCues: buildCaptionCues(words, keep, shifts) } : {}),
  }
}

export { isFillerWordDetectionSupported } from './fillerWords'
