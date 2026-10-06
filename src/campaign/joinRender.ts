// Two or more recordings of one video - the selfie camera, then the back
// camera - written back to back into one file. Everything after it treats
// the result as one video he filmed: its caption check, its cuts, the look.
// What was heard in each part is not heard again; it is moved to where that
// part starts in the joined file (plan.ts, joinPlans).
//
// Each part fills the frame (its edges trimmed if its shape differs from the
// first's), and its sound is brought to the first part's rate and channels.
// It is written at very high quality: it is encoded once more when made.

import {
  AudioSample,
  AudioSampleSource,
  canEncodeAudio,
  canEncodeVideo,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  QUALITY_VERY_HIGH,
  VideoSample,
  VideoSampleSource,
} from 'mediabunny'

import { SilenceCutError } from '../media/errors'
import { contiguousAudio, forwardOnly } from '../media/forwardOnly'
import { createOutputSink } from '../media/outputSink'
import { isSilenceCutSupported } from '../media/silenceCut'
import { openClip, writeWhole, type Clip } from './clipParts'
import { outputSize } from './overlay'
import { cover } from './reaction'

const MAX_RECOVERIES = 4
const SAFE_RATE = 48000

export interface JoinedRecording {
  blob: Blob
  /** Its name in the phone's private storage, to delete it by later. */
  storedAs: string | null
  /** Per part, what to add to a moment on its own timeline to find it in
   *  the joined file. */
  offsets: number[]
  duration: number
}

export async function joinRecordings(files: Blob[], onProgress?: (fraction: number) => void): Promise<JoinedRecording> {
  if (!(await isSilenceCutSupported())) {
    throw new SilenceCutError("This browser can't make video yet. Update to the newest iOS/Safari, or use a computer.")
  }
  const clips: Clip[] = []
  const sink = await createOutputSink()
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: false }), target: sink.target })
  let finished = false
  try {
    for (const [i, file] of files.entries()) clips.push(await openClip(file, `part ${i + 1}`))

    // The first part's sound decides the rate and channels, when an AAC
    // encoder takes them; otherwise what every one does.
    const voiced = clips.find((c) => c.audio)?.audio ?? null
    let rate = voiced ? await voiced.getSampleRate() : SAFE_RATE
    const channels = voiced ? Math.min(2, await voiced.getNumberOfChannels()) : 2
    if (!(await canEncodeAudio('aac', { sampleRate: rate, numberOfChannels: channels }))) rate = SAFE_RATE
    if (!(await canEncodeAudio('aac', { sampleRate: rate, numberOfChannels: channels }))) {
      throw new SilenceCutError("This browser can't write the video's sound. Try Safari or Chrome.")
    }

    const { width, height } = outputSize(clips[0].width, clips[0].height)
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new SilenceCutError("This browser couldn't prepare a canvas to put the parts together.")

    // Very high, since the joined file is made again with the look - but not
    // every phone's encoder takes it at this size ("This specific encoder
    // configuration ... is not supported", and the join failed), and then the
    // quality every other video is made at does.
    const quality = (await canEncodeVideo('avc', { width, height, quality: QUALITY_VERY_HIGH })) ? QUALITY_VERY_HIGH : QUALITY_HIGH
    const videoSource = new VideoSampleSource({ codec: 'avc', quality })
    const audioSource = new AudioSampleSource({ codec: 'aac', quality: QUALITY_HIGH })
    output.addVideoTrack(videoSource)
    output.addAudioTrack(audioSource)
    await output.start()

    const total = clips.reduce((sum, c) => sum + (c.duration - c.first), 0)
    const videoClock = forwardOnly()
    const audioClock = contiguousAudio()
    const offsets: number[] = []
    let at = 0
    for (const clip of clips) {
      offsets.push(at - clip.first)
      const place = cover(clip.width, clip.height, width, height)
      at = await writeWhole(clip, at, {
        rate,
        channels,
        videoClock,
        audioClock,
        maxRecoveries: MAX_RECOVERIES,
        onFrame: async (sample, timestamp) => {
          onProgress?.(Math.min(0.99, timestamp / total))
          ctx.fillStyle = '#000'
          ctx.fillRect(0, 0, width, height)
          sample.draw(ctx, place.x, place.y, place.width, place.height)
          const frame = new VideoSample(canvas, { timestamp, duration: sample.duration })
          await videoSource.add(frame)
          frame.close()
        },
        onSound: async (planes, timestamp) => {
          const length = planes[0].length
          const data = new Float32Array(length * channels)
          planes.forEach((plane, c) => data.set(plane, c * length))
          const sample = new AudioSample({ data, format: 'f32-planar', numberOfChannels: channels, sampleRate: rate, timestamp })
          await audioSource.add(sample)
          sample.close()
        },
      })
    }

    await output.finalize()
    const blob = await sink.finish()
    if (blob.size === 0) throw new SilenceCutError('Putting the parts together finished but produced no file. Try again.')
    finished = true
    onProgress?.(1)
    return { blob, storedAs: sink.storedAs, offsets, duration: at }
  } finally {
    for (const clip of clips) clip.input.dispose()
    if (!finished) {
      await output.cancel().catch(() => {})
      await sink.discard()
    }
  }
}
