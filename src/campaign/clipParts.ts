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

/** The phone's video decoder giving up - "Decoder failure" on an iPhone. */
export function decoderGaveUp(error: unknown): boolean {
  return !(error instanceof SilenceCutError) && (error instanceof DOMException || /decod/i.test(String(error)))
}

export const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Resolves once the page is in front again. iOS takes the decoder away
 *  from a page in the background - sending a finished video to TikTok does
 *  it - so a fresh one is only worth starting on his return. */
export function visibleAgain(): Promise<void> {
  if (document.visibilityState === 'visible') return Promise.resolve()
  return new Promise((resolve) => {
    const onChange = () => {
      if (document.visibilityState !== 'visible') return
      document.removeEventListener('visibilitychange', onChange)
      resolve()
    }
    document.addEventListener('visibilitychange', onChange)
  })
}

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
    const [width, height, first, duration] = await Promise.all([
      video.getDisplayWidth(),
      video.getDisplayHeight(),
      video.getFirstTimestamp(),
      input.computeDuration(),
    ])
    if (!(duration > first)) throw new SilenceCutError(`The ${which} clip is empty.`)
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
  }: {
    rate: number
    channels: number
    videoClock: (timestamp: number) => number
    audioClock: (timestamp: number, duration: number) => number
    maxRecoveries: number
    onFrame: (sample: VideoSample, timestamp: number) => Promise<void>
    onSound: (planes: Float32Array[], timestamp: number) => Promise<void>
  },
): Promise<number> {
  const whole = wholeOf(clip)
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
      let frames = new RangeReader(inTimestampOrder(new VideoSampleSink(clip.video).samples(from, whole.end)))
      try {
        for (;;) {
          try {
            for await (const sample of frames.range(from, whole.end, await keyAt(from))) {
              if (sample.timestamp <= done) {
                sample.close()
                continue
              }
              const timestamp = videoClock(at + Math.max(0, sample.timestamp - whole.start))
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
    eachSound(clip, [whole], rate, channels, async (planes) => {
      const length = planes[0].length
      const timestamp = audioClock(at + written / rate, length / rate)
      written += length
      audioEnd = timestamp + length / rate
      await onSound(planes, timestamp)
    }),
  ])
  return Math.max(videoEnd, audioEnd)
}
