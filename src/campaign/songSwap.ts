// One video, several songs (his ask, 2026-11-09): "it creates the same exact
// video ... with only 5 different audios". The picture is copied as it is,
// packet for packet - never drawn or encoded again, so every copy looks
// exactly like the video he put in - and only the sound is written new:
//   - he talks in it: his voice stays, the song low under it, dipping while
//     he talks (as in a talking head batch video);
//   - no talking: the song alone, in place of the video's own sound.
// The index goes to the front for Instagram (outputSink, fastStart.ts).

import {
  ALL_FORMATS,
  AudioSampleSource,
  BlobSource,
  canEncodeAudio,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_MEDIUM,
  VideoSampleSink,
  VideoSampleSource,
  type VideoCodec,
} from 'mediabunny'

import { SilenceCutError } from '../media/errors'
import { createOutputSink } from '../media/outputSink'
import { onEncodedPacketMatchingColour } from './colourCheck'
import { frameRateOf, videoQuality } from './quality'
import { liftMusic, musicTrack, soloMusicGain } from './montageRender'
import { MusicBed, musicGain, trackLoudness } from './music'
import { musicProblem, prepareMusic } from './sounds'

const RATE = 48000

export interface SongSwapResult {
  blob: Blob
  storedAs: string | null
  totalSec: number
  /** Why the song couldn't go in, when it couldn't (the video then keeps
   *  its own sound, or none). */
  musicFailed?: string
}

/** The sound of the copy, `total` seconds of it: his voice (or nothing) and
 *  the song over or under it. Exported for the tests. */
export function soundBed(song: Float32Array[] | null, voice: Float32Array[] | null, total: number): { bed: MusicBed | null; failed?: string } {
  if (!song) return { bed: null }
  const frames = Math.round(total * RATE)
  const songLufs = trackLoudness(song, RATE)
  if (voice) {
    const voiceLufs = trackLoudness(voice, RATE)
    // No voice heard after all: the song alone, as below.
    if (Number.isFinite(voiceLufs)) {
      const gain = musicGain(songLufs, voiceLufs, 'low')
      return gain > 0 ? { bed: new MusicBed(song, RATE, frames, gain, voiceLufs) } : { bed: null, failed: 'the song is silent' }
    }
  }
  const gain = soloMusicGain(songLufs)
  if (!(gain > 0)) return { bed: null, failed: 'the song is silent' }
  liftMusic(song, gain, RATE)
  return { bed: new MusicBed(song, RATE, frames, 1, Infinity) }
}

export async function renderSongSwap(
  { video, song, songName, keepVoice }: { video: Blob; song: Blob; songName: string; keepVoice: boolean },
  onProgress?: (fraction: number) => void,
): Promise<SongSwapResult> {
  if (!(await canEncodeAudio('aac', { sampleRate: RATE, numberOfChannels: 2 }))) {
    throw new SilenceCutError("This browser can't write the video's sound. Try Safari or Chrome.")
  }
  const input = new Input({ source: new BlobSource(video), formats: ALL_FORMATS })
  const sink = await createOutputSink()
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: false }), target: sink.target })
  let finished = false
  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track) throw new SilenceCutError('This video has no picture in it.')
    const codec = (await track.getCodec()) as VideoCodec | null
    const config = await track.getDecoderConfig()
    if (!codec || !config) throw new SilenceCutError("This phone can't read this video's picture.")
    // A clip trimmed on the iPhone keeps hidden frames before its start
    // (CLAUDE.md): copied as they are, they would play. Its picture is drawn
    // again from the first frame shown instead - the only case it is.
    const redraw = (await track.getFirstTimestamp()) < -0.001
    const total = Math.max(0.1, (await track.computeDuration()) - (redraw ? 0 : Math.min(0, await track.getFirstTimestamp())))

    // The voice, when he talks in it, and the song - only as much as is heard.
    let voice: Float32Array[] | null = null
    if (keepVoice && (await input.getPrimaryAudioTrack())) {
      voice = await prepareMusic(video, 'the video', total, RATE)
        .then(({ channels }) => (channels.length === 1 ? [channels[0], channels[0]] : channels.slice(0, 2)))
        .catch(() => null)
    }
    let songPlanes: Float32Array[] | null = null
    let musicFailed: string | undefined
    try {
      const { channels } = await prepareMusic(song, songName, total, RATE)
      songPlanes = channels
    } catch (error) {
      musicFailed = musicProblem(error, song)
    }
    const made = soundBed(songPlanes, voice, total)
    musicFailed ??= made.failed

    const picture = redraw ? null : new EncodedVideoPacketSource(codec)
    const drawn = redraw
      ? new VideoSampleSource({
          codec: 'avc',
          quality: videoQuality(await track.getDisplayWidth(), await track.getDisplayHeight(), await frameRateOf(track)),
          onEncodedPacket: onEncodedPacketMatchingColour,
        })
      : null
    output.addVideoTrack((picture ?? drawn)!, { rotation: track.rotation })
    const sound = new AudioSampleSource({ codec: 'aac', quality: QUALITY_MEDIUM })
    output.addAudioTrack(sound)
    await output.start()

    // The voice planes as long as the video: musicTrack reads them whole.
    const voicePlanes = voice ? voice.map((c) => (c.length >= Math.ceil(total * RATE) ? c : padded(c, Math.ceil(total * RATE)))) : null
    const soundTo = musicTrack(made.bed, (sample) => sound.add(sample), voicePlanes)
    // Sound written alongside the picture, a little ahead, so neither waits
    // in memory for the other.
    if (picture) {
      const shift = Math.min(0, await track.getFirstTimestamp())
      let firstPacket = true
      for await (const packet of new EncodedPacketSink(track).packets()) {
        const at = packet.timestamp - shift
        await soundTo(Math.min(total, at + 0.5))
        const moved = shift === 0 ? packet : packet.clone({ timestamp: at })
        await picture.add(moved, firstPacket ? { decoderConfig: config } : undefined)
        firstPacket = false
        onProgress?.(Math.min(0.95, at / total))
      }
    } else if (drawn) {
      for await (const sample of new VideoSampleSink(track).samples(0)) {
        try {
          await soundTo(Math.min(total, sample.timestamp + 0.5))
          await drawn.add(sample)
        } finally {
          sample.close()
        }
        onProgress?.(Math.min(0.95, sample.timestamp / total))
      }
    }
    await soundTo(total)
    await output.finalize()
    const blob = await sink.finish()
    if (blob.size === 0) throw new SilenceCutError('The copy came out empty. Try again.')
    finished = true
    onProgress?.(1)
    return { blob, storedAs: sink.storedAs, totalSec: total, ...(musicFailed ? { musicFailed } : {}) }
  } finally {
    if (!finished) {
      await output.cancel().catch(() => {})
      await sink.discard()
    }
    input.dispose()
  }
}

function padded(plane: Float32Array, length: number): Float32Array {
  const out = new Float32Array(length)
  out.set(plane.subarray(0, length))
  return out
}
