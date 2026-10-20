// Reading a clip that is joined onto another video - a reaction and its
// product, a hook before a talking head, a showcase after it: its picture
// track, and its sound brought to the finished video's rate and channels.

import {
  ALL_FORMATS,
  AudioSample,
  AudioSampleSink,
  BlobSource,
  EncodedPacketSink,
  Input,
  VideoSampleSink,
  type InputAudioTrack,
  type InputVideoTrack,
  type VideoSample,
} from 'mediabunny'

import { SilenceCutError } from '../media/errors'
import { RangeReader, inTimestampOrder } from '../media/rangeReader'
import type { Range } from '../media/silenceMath'
import { Resampler, fitChannels } from './reaction'

export { decoderGaveUp, pause, visibleAgain } from '../media/recovery'
import { decoderGaveUp, pause, visibleAgain } from '../media/recovery'

export interface Clip {
  input: Input
  video: InputVideoTrack
  /** Null when the clip has no sound, or sound this browser can't read. */
  audio: InputAudioTrack | null
  width: number
  height: number
  /** Where its picture starts and the clip ends, on its own timeline. */
  first: number
  duration: number
}

/** Where a track's picture starts being shown: its first frame, or 0 when
 *  frames come before that. A clip trimmed on the iPhone keeps the frames
 *  from the key frame before the cut - every other one - marked never to be
 *  shown. Every player skips them, but they read as coming first, at a time
 *  before 0, and drawn from there a reaction opened on up to a second of what
 *  he had cut, at half the frame rate: "half of the hooks are really laggy",
 *  every video from the reactions with the most of them, never from the rest. */
export async function firstShown(track: Pick<InputVideoTrack, 'getFirstTimestamp'>): Promise<number> {
  return Math.max(0, await track.getFirstTimestamp())
}

/** Frames this far past a clip's start are read to find where it goes steady. */
const STEADY_LOOK = 3
/** Gaps in a row, each no longer than one and a half frames, that count as steady. */
const STEADY_RUN = 6
/** The most of a clip's start ever skipped to get to its steady frames. */
const MAX_SKIP = 1

/**
 * Where a clip's picture plays steadily from, at or after `from`: `from`
 * itself for an ordinary file. A file whose first frame comes late - the
 * video froze on it until the next - or whose first frames come every other
 * one or worse - laggy, then normal - starts at its first frame from which
 * the frames follow each other evenly. "It's just supposed to play the
 * video": the reactions he trims on the iPhone came in both kinds.
 */
export function steadyFrom(times: readonly number[], from: number): number {
  const shown = [...new Set(times)].filter((t) => t >= from - 1e-6).sort((a, b) => a - b)
  if (shown.length < 3) return Math.max(from, shown[0] ?? from)
  const gaps = shown.slice(1).map((t, k) => t - shown[k])
  const usual = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)]
  const steady = (gap: number) => gap <= usual * 1.5
  for (let k = 0; k < gaps.length; k++) {
    if (shown[k] - from > MAX_SKIP) break
    if (!gaps.slice(k, k + STEADY_RUN).every(steady)) continue
    // On time and steady from the start: exactly where it was asked to.
    return k === 0 && steady(shown[0] - from) ? from : shown[k]
  }
  return steady(shown[0] - from) ? from : shown[0]
}

/** The start of a clip's steady frames (steadyFrom), read off its packets
 *  alone - nothing decoded. */
export async function steadyStart(video: InputVideoTrack, from: number, duration: number): Promise<number> {
  const times: number[] = []
  try {
    for await (const packet of new EncodedPacketSink(video).packets(undefined, undefined, { metadataOnly: true })) {
      times.push(packet.timestamp)
      // Past the part looked at - a little further, for frames stored out of order.
      if (packet.timestamp > from + STEADY_LOOK + 0.5 || times.length > 400) break
    }
  } catch {
    return from
  }
  const start = steadyFrom(times.filter((t) => t <= from + STEADY_LOOK), from)
  // Never so much that little of the clip is left.
  return duration - start >= 0.5 ? start : from
}

/** How long one of a clip's frames usually lasts from `from` on - the middle
 *  of the spacings of its frames there, read off its packets alone. Hidden
 *  lead-in frames before `from` don't count, so a trimmed 30 a second clip
 *  reads as 30. 1/30 when it can't be told. */
export async function usualFrame(video: InputVideoTrack, from: number): Promise<number> {
  const times: number[] = []
  try {
    for await (const packet of new EncodedPacketSink(video).packets(undefined, undefined, { metadataOnly: true })) {
      if (packet.timestamp >= from - 1e-6) times.push(packet.timestamp)
      if (packet.timestamp > from + STEADY_LOOK + 0.5 || times.length > 400) break
    }
  } catch {
    return 1 / 30
  }
  const shown = [...new Set(times)].sort((a, b) => a - b)
  const gaps = shown.slice(1).map((t, k) => t - shown[k])
  return gaps.length ? [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : 1 / 30
}

/** Opens a clip, or says in plain words why it can't be used. The caller
 *  disposes `input`. */
export async function openClip(file: Blob, which: string): Promise<Clip> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
  try {
    const [video, audio] = await Promise.all([input.getPrimaryVideoTrack(), input.getPrimaryAudioTrack()])
    if (!video) throw new SilenceCutError(`The ${which} clip has no picture in it.`)
    if (!(await video.canDecode())) {
      throw new SilenceCutError(`This browser can't read the ${which} clip's format. Try saving it again from Photos.`)
    }
    const soundReadable = audio ? await audio.canDecode() : false
    const [width, height, shownFrom, duration] = await Promise.all([
      video.getDisplayWidth(),
      video.getDisplayHeight(),
      firstShown(video),
      input.computeDuration(),
    ])
    if (!(duration > shownFrom)) throw new SilenceCutError(`The ${which} clip is empty.`)
    const first = await steadyStart(video, shownFrom, duration)
    return { input, video, audio: soundReadable ? audio : null, width, height, first, duration }
  } catch (error) {
    input.dispose()
    throw error
  }
}

/** The whole of a clip, on its own timeline. */
export function wholeOf(clip: Clip): Range {
  return { start: clip.first, end: clip.duration }
}

/** A sample's audio, one array per channel. */
function planesOf(sample: AudioSample): Float32Array[] {
  return Array.from({ length: sample.numberOfChannels }, (_, c) => {
    const plane = new Float32Array(sample.numberOfFrames)
    sample.copyTo(plane, { planeIndex: c, format: 'f32-planar' })
    return plane
  })
}

/** The sound of `ranges` of a clip at `rate` with `channels` channels, each
 *  range exactly as long as its picture - silence where the clip has no
 *  sound. */
export async function eachSound(
  clip: Clip,
  ranges: Range[],
  rate: number,
  channels: number,
  visit: (planes: Float32Array[]) => Promise<void> | void,
): Promise<void> {
  for (const range of ranges) {
    const needed = Math.round((range.end - range.start) * rate)
    let given = 0
    if (clip.audio) {
      const resampler = new Resampler(await clip.audio.getSampleRate(), rate)
      for await (const sample of new AudioSampleSink(clip.audio).samples(range.start, range.end)) {
        const sampleRate = sample.sampleRate
        const from = Math.max(0, Math.round((range.start - sample.timestamp) * sampleRate))
        const to = Math.min(sample.numberOfFrames, Math.round((range.end - sample.timestamp) * sampleRate))
        const planes = to > from ? planesOf(sample).map((p) => p.subarray(from, to)) : null
        sample.close()
        if (!planes) continue
        let out = resampler.push(fitChannels(planes, channels))
        if (given + out[0].length > needed) out = out.map((p) => p.subarray(0, needed - given))
        if (out[0].length > 0) {
          await visit(out)
          given += out[0].length
        }
        if (given >= needed) break
      }
    }
    while (given < needed) {
      const length = Math.min(Math.round(rate / 10), needed - given)
      await visit(Array.from({ length: channels }, () => new Float32Array(length)))
      given += length
    }
  }
}

/** Writes a whole clip into a video being made, from `at` on its timeline:
 *  every frame through `onFrame` (which draws and adds it; the sample is
 *  closed after), its sound at `rate` and `channels` through `onSound`,
 *  exactly as long as its picture. The phone's decoder giving up partway is
 *  picked up again from the last frame, as the render does for his own
 *  video. Returns where the clip ends. */
/** A first frame this much after a clip's start is late (a frame and a half at 30 fps). */
const LATE_FIRST = 0.05

export async function writeWhole(
  clip: Clip,
  at: number,
  {
    rate,
    channels,
    videoClock,
    audioClock,
    maxRecoveries,
    onFrame,
    onSound,
    window,
  }: {
    rate: number
    channels: number
    videoClock: (timestamp: number) => number
    audioClock: (timestamp: number, duration: number) => number
    maxRecoveries: number
    onFrame: (sample: VideoSample, timestamp: number) => Promise<void>
    /** The clip's own sound; absent when the video's sound is laid over
     *  it whole (a batch's music), so the clip's is never read. */
    onSound?: (planes: Float32Array[], timestamp: number) => Promise<void>
    /** Only this part of the clip (a batch step's few seconds); all of it
     *  when absent. */
    window?: Range
  },
): Promise<number> {
  const all = wholeOf(clip)
  const whole = window ? { start: Math.max(all.start, window.start), end: Math.min(all.end, window.end) } : all
  const packets = new EncodedPacketSink(clip.video)
  const keyAt = async (t: number) => (await packets.getKeyPacket(t, { verifyKeyPackets: true }))?.timestamp ?? -Infinity
  let videoEnd = at
  let audioEnd = at
  let written = 0
  await Promise.all([
    (async () => {
      let from = whole.start
      let done = -Infinity
      let recoveries = 0
      // Where the clip's time 0 is: its start - or, under music (a batch),
      // its first frame when that only comes later, so the video plays from
      // it instead of freezing on it until it is due.
      let origin: number | null = null
      let frames = new RangeReader(inTimestampOrder(new VideoSampleSink(clip.video).samples(from, whole.end)))
      try {
        for (;;) {
          try {
            for await (const sample of frames.range(from, whole.end, await keyAt(from))) {
              if (sample.timestamp <= done) {
                sample.close()
                continue
              }
              origin ??= !onSound && sample.timestamp - whole.start > LATE_FIRST ? sample.timestamp : whole.start
              const timestamp = videoClock(at + Math.max(0, sample.timestamp - origin))
              videoEnd = timestamp + sample.duration
              done = sample.timestamp
              try {
                await onFrame(sample, timestamp)
              } finally {
                sample.close()
              }
            }
            return
          } catch (error) {
            if (!decoderGaveUp(error)) throw error
            await frames.dispose().catch(() => {})
            if (document.visibilityState !== 'visible') await visibleAgain()
            else {
              if (recoveries >= maxRecoveries) throw error
              recoveries++
              await pause(500)
            }
            from = Math.max(whole.start, done)
            frames = new RangeReader(inTimestampOrder(new VideoSampleSink(clip.video).samples(from, whole.end)))
          }
        }
      } finally {
        await frames.dispose().catch(() => {})
      }
    })(),
    onSound
      ? eachSound(clip, [whole], rate, channels, async (planes) => {
          const length = planes[0].length
          const timestamp = audioClock(at + written / rate, length / rate)
          written += length
          audioEnd = timestamp + length / rate
          await onSound(planes, timestamp)
        })
      : null,
  ])
  if (!onSound) return videoEnd
  // The last frame usually runs a little past the cut (up to a frame), past
  // where the sound stops: the sound is filled up to it, so the next clip's
  // sound follows on with no hole. In a batch the music is the sound, and it
  // dropped out for that moment at every change of clip - a pop each time.
  const short = Math.round((videoEnd - audioEnd) * rate)
  if (short > 0) {
    const timestamp = audioClock(audioEnd, short / rate)
    audioEnd = timestamp + short / rate
    await onSound(Array.from({ length: channels }, () => new Float32Array(short)), timestamp)
  }
  return Math.max(videoEnd, audioEnd)
}
