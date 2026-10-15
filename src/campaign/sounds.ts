// The short sounds a look lays over the video - a whoosh as it opens, a ding
// on the brand's name - and the mixing that puts them under his voice.
//
// Three are made right here from a few lines of maths, so a look works the
// day it is set up, before he has gone looking for sound files. His own
// files are decoded by the browser at the video's own sample rate, so nothing
// has to be resampled while the video is being written.

import { ALL_FORMATS, AudioSampleSink, BlobSource, Input } from 'mediabunny'

import type { BuiltInSound, SoundSource } from './look'

/** A sound ready to mix: one array per channel, at the video's sample rate. */
export interface PreparedSound {
  channels: Float32Array[]
}

/** A sound placed on the output timeline, in sample frames. */
export interface PlacedSound extends PreparedSound {
  startFrame: number
  /** Linear, from the look's dB. */
  gain: number
}

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20)
}

/** A small repeatable noise source, so the whoosh is the same every time. */
function noise(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000 - 0.5
  }
}

export function synthesize(name: BuiltInSound, sampleRate: number): Float32Array {
  if (name === 'ding') {
    // A bell: a fundamental and two quieter overtones, struck and left to ring.
    const length = Math.round(sampleRate * 0.9)
    const out = new Float32Array(length)
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate
      const attack = Math.min(1, t / 0.004)
      const ring = Math.exp(-t * 5.5)
      const tone =
        Math.sin(2 * Math.PI * 1318.5 * t) + 0.35 * Math.sin(2 * Math.PI * 2637 * t) + 0.12 * Math.sin(2 * Math.PI * 3955.5 * t)
      out[i] = 0.42 * attack * ring * tone
    }
    return out
  }
  if (name === 'pop') {
    // A quick drop in pitch, gone in a tenth of a second.
    const length = Math.round(sampleRate * 0.12)
    const out = new Float32Array(length)
    let phase = 0
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate
      const freq = 180 + 520 * Math.exp(-t * 45)
      phase += (2 * Math.PI * freq) / sampleRate
      out[i] = 0.6 * Math.min(1, t / 0.002) * Math.exp(-t * 38) * Math.sin(phase)
    }
    return out
  }
  // Whoosh: noise through a filter that opens and closes as it swells and
  // fades, which is what air rushing past sounds like.
  const length = Math.round(sampleRate * 0.65)
  const out = new Float32Array(length)
  const next = noise(7)
  let low = 0
  for (let i = 0; i < length; i++) {
    const x = i / length
    const swell = Math.sin(Math.PI * Math.pow(x, 0.8))
    const cutoff = 300 + 5200 * swell
    const alpha = 1 - Math.exp((-2 * Math.PI * cutoff) / sampleRate)
    low += alpha * (next() - low)
    out[i] = 1.9 * swell * swell * low
  }
  return out
}

/** Turns a look's sound into samples at `sampleRate`. A file the browser
 *  cannot read fails here, before any of the video is written. */
export async function prepareSound(source: SoundSource, sampleRate: number): Promise<PreparedSound> {
  if (source.kind === 'built-in') return { channels: [synthesize(source.name, sampleRate)] }
  const context = new OfflineAudioContext(1, 1, sampleRate)
  let buffer: AudioBuffer
  try {
    buffer = await context.decodeAudioData(await source.audio.arrayBuffer())
  } catch {
    throw new Error(`the sound "${source.name}" couldn't be read - try it as an MP3, M4A or WAV`)
  }
  return {
    channels: Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c).slice()),
  }
}

/** Adds every sound that overlaps these samples into them. `planes` is one
 *  array per channel, all the same length, starting at output frame
 *  `firstFrame`. Returns false, and changes nothing, when no sound is
 *  playing here - the common case, which then costs nothing.
 *
 *  The result is clipped to full scale unless `clip` is off - for when a
 *  limiter comes next and brings peaks down more gently than clipping. */
export function mixInto(planes: Float32Array[], firstFrame: number, sounds: readonly PlacedSound[], clip = true): boolean {
  const length = planes[0]?.length ?? 0
  let touched = false
  for (const sound of sounds) {
    const soundLength = sound.channels[0]?.length ?? 0
    const from = Math.max(firstFrame, sound.startFrame)
    const to = Math.min(firstFrame + length, sound.startFrame + soundLength)
    if (from >= to) continue
    touched = true
    for (let c = 0; c < planes.length; c++) {
      const plane = planes[c]
      // A mono sound goes into every channel; a stereo sound into a mono
      // video is folded down, so nothing is lost.
      const fold = planes.length === 1 && sound.channels.length > 1
      const source = sound.channels[Math.min(c, sound.channels.length - 1)]
      for (let f = from; f < to; f++) {
        const s = f - sound.startFrame
        let value = source[s]
        if (fold) {
          value = 0
          for (const channel of sound.channels) value += channel[s]
          value /= sound.channels.length
        }
        plane[f - firstFrame] += value * sound.gain
      }
    }
  }
  if (touched && clip) {
    for (const plane of planes) {
      for (let i = 0; i < plane.length; i++) plane[i] = Math.max(-1, Math.min(1, plane[i]))
    }
  }
  return touched
}

/** The first `seconds` of a song, as decoded planes at its own rate, or
 *  null when this phone can't read it this way. */
async function decodeStart(audio: Blob, seconds: number): Promise<{ planes: Float32Array[]; rate: number } | null> {
  const input = new Input({ source: new BlobSource(audio), formats: ALL_FORMATS })
  try {
    const track = await input.getPrimaryAudioTrack()
    if (!track || !(await track.canDecode())) return null
    const [rate, count] = await Promise.all([track.getSampleRate(), track.getNumberOfChannels()])
    const wanted = Math.ceil(seconds * rate)
    const planes = Array.from({ length: count }, () => new Float32Array(wanted))
    let at = 0
    for await (const sample of new AudioSampleSink(track).samples(0, seconds)) {
      try {
        const frames = Math.min(sample.numberOfFrames, wanted - at)
        for (let c = 0; c < count && frames > 0; c++) {
          sample.copyTo(planes[c].subarray(at, at + frames), { planeIndex: Math.min(c, sample.numberOfChannels - 1), format: 'f32-planar', frameCount: frames })
        }
        at += Math.max(0, frames)
      } finally {
        sample.close()
      }
      if (at >= wanted) break
    }
    if (at === 0) return null
    return { planes: planes.map((p) => p.subarray(0, at)), rate }
  } finally {
    input.dispose()
  }
}

/** Planes at `from` Hz brought to `to` Hz by the browser's own resampler. */
async function resample(planes: Float32Array[], from: number, to: number): Promise<Float32Array[]> {
  if (from === to) return planes
  const length = Math.max(1, Math.round((planes[0].length * to) / from))
  const context = new OfflineAudioContext(planes.length, length, to)
  const buffer = context.createBuffer(planes.length, planes[0].length, from)
  planes.forEach((plane, c) => buffer.copyToChannel(plane as Float32Array<ArrayBuffer>, c))
  const source = context.createBufferSource()
  source.buffer = buffer
  source.connect(context.destination)
  source.start()
  const rendered = await context.startRendering()
  return Array.from({ length: rendered.numberOfChannels }, (_, c) => rendered.getChannelData(c))
}

/** A song to go under a video `seconds` long: only as much of it as the
 *  video uses (and a second more), at `sampleRate`.
 *
 *  Each video used to decode its whole song into memory - a three-minute
 *  track is about 70 MB as samples, copied again on the way - and in a long
 *  batch, with 4K frames in memory too, some songs then failed to decode and
 *  their videos went out silent. Now only the part that is heard is decoded.
 *  A song this phone can't read that way is decoded whole, as before. */
export async function prepareMusic(audio: Blob, name: string, seconds: number, sampleRate: number): Promise<PreparedSound> {
  const needed = Math.ceil(seconds * sampleRate) + sampleRate
  try {
    const start = await decodeStart(audio, seconds + 1)
    if (start) return { channels: await resample(start.planes, start.rate, sampleRate) }
  } catch {
    // Decoded whole below.
  }
  const whole = await prepareSound({ kind: 'file', name, audio }, sampleRate)
  return { channels: whole.channels.map((c) => (c.length > needed ? c.slice(0, needed) : c)) }
}

/** What went wrong with a song, for a report: the reason, and the file's
 *  type and size - never the song. */
export function musicProblem(error: unknown, audio: Blob): string {
  const reason = error instanceof Error ? error.message : String(error)
  return `${reason} (${audio.type || 'no type'}, ${(audio.size / 1e6).toFixed(1)} MB)`
}
