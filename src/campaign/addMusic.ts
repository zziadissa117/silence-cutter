// Putting music under a video that is already made - from the Posts screen,
// where the finished video sits waiting to be approved.
//
// The picture is not touched: its encoded frames are copied across exactly as
// they are, so it keeps its quality and this takes seconds, not the time the
// video took to make. Only the sound is redone - the video's own sound with
// the track mixed under it, the same way music goes under a voice when a
// video is made (music.ts: set well under the voice, dipping while he talks,
// fading in and out, looping if short).
//
// Music is added on top of whatever sound the video has. A video that already
// has music gets a second track over it; to swap one for another, make the
// video again (Edit again) with the other track.

import {
  AudioSample,
  AudioSampleSource,
  canEncodeAudio,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  Mp4OutputFormat,
  Output,
  QUALITY_MEDIUM,
} from 'mediabunny'

import { SilenceCutError } from '../media/errors'
import { createOutputSink } from '../media/outputSink'
import { eachSound, openClip, wholeOf } from './clipParts'
import { MusicBed, musicGain, trackLoudness, type MusicLevel } from './music'
import { mixInto, prepareSound } from './sounds'
import { Voice, measureLoudness, type WalkAudio } from './voice'

const RATE = 48000
const CHANNELS = 2

export interface MusicAdded {
  blob: Blob
  storedAs: string | null
  /** Said when the track could not go on and the video is as it was. */
  failed?: string
}

export async function addMusicTo(
  video: Blob,
  music: { audio: Blob; level: MusicLevel },
  onProgress?: (fraction: number) => void,
): Promise<MusicAdded> {
  if (!(await canEncodeAudio('aac', { sampleRate: RATE, numberOfChannels: CHANNELS }))) {
    throw new SilenceCutError("This browser can't write the video's sound. Try Safari or Chrome.")
  }
  const clip = await openClip(video, 'finished video')
  const sink = await createOutputSink()
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: false }), target: sink.target })
  let finished = false
  try {
    const range = wholeOf(clip)
    const total = clip.duration - clip.first
    const walk: WalkAudio = async (visit) => eachSound(clip, [range], RATE, CHANNELS, visit)

    const track = await prepareSound({ kind: 'file', name: 'music', audio: music.audio }, RATE)
    const needed = Math.ceil(total * RATE) + RATE
    const channels = track.channels.map((c) => (c.length > needed ? c.slice(0, needed) : c))
    const measured = await measureLoudness(RATE, CHANNELS, walk)
    const voiceLufs = Number.isFinite(measured) ? measured : -20
    const gain = musicGain(trackLoudness(channels, RATE), voiceLufs, music.level)
    if (!(gain > 0)) throw new SilenceCutError('That track is silent, so there is nothing to add.')
    const bed = new MusicBed(channels, RATE, Math.round(total * RATE), gain, voiceLufs)
    // The voice's own limiter, so the mix never clips.
    const voice = await Voice.measure(RATE, CHANNELS, walk).catch(() => null)

    const codec = await clip.video.getCodec()
    if (!codec) throw new SilenceCutError("This video's picture format isn't one this app can copy.")
    const decoderConfig = (await clip.video.getDecoderConfig()) as VideoDecoderConfig | null
    const videoSource = new EncodedVideoPacketSource(codec as ConstructorParameters<typeof EncodedVideoPacketSource>[0])
    const audioSource = new AudioSampleSource({ codec: 'aac', quality: QUALITY_MEDIUM })
    output.addVideoTrack(videoSource)
    output.addAudioTrack(audioSource)
    await output.start()

    let writtenFrames = 0
    await Promise.all([
      (async () => {
        const packets = new EncodedPacketSink(clip.video)
        let packet = await packets.getFirstPacket()
        let first = true
        while (packet) {
          if (first && decoderConfig) await videoSource.add(packet, { decoderConfig })
          else await videoSource.add(packet)
          first = false
          onProgress?.(Math.min(0.5, (packet.timestamp / total) * 0.5))
          packet = await packets.getNextPacket(packet)
        }
      })(),
      eachSound(clip, [range], RATE, CHANNELS, async (planes) => {
        const firstFrame = writtenFrames
        writtenFrames += planes[0].length
        const data = new Float32Array(planes[0].length * CHANNELS)
        const out = [data.subarray(0, planes[0].length), data.subarray(planes[0].length)]
        out[0].set(planes[0])
        out[1].set(planes[1])
        bed.mixInto(out, firstFrame)
        mixInto(out, firstFrame, [], !voice)
        if (voice) voice.limit(out)
        else for (const plane of out) for (let i = 0; i < plane.length; i++) plane[i] = Math.max(-1, Math.min(1, plane[i]))
        const sample = new AudioSample({ data, format: 'f32-planar', numberOfChannels: CHANNELS, sampleRate: RATE, timestamp: firstFrame / RATE })
        await audioSource.add(sample)
        sample.close()
        onProgress?.(Math.min(0.99, 0.5 + (firstFrame / RATE / total) * 0.5))
      }),
    ])

    await output.finalize()
    const blob = await sink.finish()
    if (blob.size === 0) throw new SilenceCutError('Adding the music finished but produced no file. Try again.')
    finished = true
    onProgress?.(1)
    return { blob, storedAs: sink.storedAs }
  } finally {
    clip.input.dispose()
    if (!finished) {
      await output.cancel().catch(() => {})
      await sink.discard()
    }
  }
}
