// Hearing a sound before it goes into an angle, at the volume it will have in
// the video, and how loud that is.
//
// The number is the sound's peak - its loudest instant - after the volume is
// applied, in dB below the loudest a video can go (0 dB). It is measured from
// the same samples the render mixes in, so it is the real level, not a
// guess from the slider.

import type { SoundSource } from './look'
import { dbToGain, prepareSound, type PreparedSound } from './sounds'

let context: AudioContext | null = null

/** One context for every preview, made on the first tap - a phone only lets
 *  sound start from a tap. */
function audio(): AudioContext {
  // Play through the silent switch, like a video would. Without this an
  // iPhone on silent plays previews at no volume at all.
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession
  if (session) {
    try {
      session.type = 'playback'
    } catch {
      // Older Safari: the switch decides.
    }
  }
  context ??= new AudioContext()
  if (context.state === 'suspended') void context.resume()
  return context
}

const prepared = new Map<string, Promise<PreparedSound>>()
const fileKeys = new WeakMap<Blob, string>()

function keyFor(source: SoundSource, sampleRate: number): string {
  if (source.kind === 'built-in') return `${source.name}@${sampleRate}`
  let key = fileKeys.get(source.audio)
  if (!key) {
    key = crypto.randomUUID()
    fileKeys.set(source.audio, key)
  }
  return `${key}@${sampleRate}`
}

function prepare(source: SoundSource, sampleRate: number): Promise<PreparedSound> {
  const key = keyFor(source, sampleRate)
  let found = prepared.get(key)
  if (!found) {
    found = prepareSound(source, sampleRate)
    // A file that failed to read is not remembered, so picking it again
    // tries again.
    found.catch(() => prepared.delete(key))
    prepared.set(key, found)
  }
  return found
}

function toDb(amplitude: number): number {
  return amplitude <= 0 ? -Infinity : 20 * Math.log10(amplitude)
}

/** The sound's loudest instant at this volume, in dB (0 is the most a video
 *  can take). */
export async function peakDb(source: SoundSource, volumeDb: number): Promise<number> {
  const sound = await prepare(source, 48000)
  let peak = 0
  for (const channel of sound.channels) for (const v of channel) peak = Math.max(peak, Math.abs(v))
  return toDb(peak) + volumeDb
}

export interface Playing {
  /** The level right now, in dB, for a meter. */
  level(): number
  stop(): void
  ended: Promise<void>
}

let current: Playing | null = null

/** Plays the sound at the volume it will have in the video. One at a time: a
 *  new preview stops the last. */
export async function play(source: SoundSource, volumeDb: number): Promise<Playing> {
  const ctx = audio()
  current?.stop()
  const sound = await prepare(source, ctx.sampleRate)
  const buffer = ctx.createBuffer(sound.channels.length, sound.channels[0].length, ctx.sampleRate)
  sound.channels.forEach((data, c) => buffer.copyToChannel(data as Float32Array<ArrayBuffer>, c))
  const node = ctx.createBufferSource()
  node.buffer = buffer
  const gain = ctx.createGain()
  gain.gain.value = dbToGain(volumeDb)
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 1024
  node.connect(gain).connect(analyser).connect(ctx.destination)
  const samples = new Float32Array(analyser.fftSize)
  const ended = new Promise<void>((resolve) => {
    node.onended = () => resolve()
  })
  node.start()
  const playing: Playing = {
    level() {
      analyser.getFloatTimeDomainData(samples)
      let peak = 0
      for (const v of samples) peak = Math.max(peak, Math.abs(v))
      return toDb(peak)
    },
    stop() {
      try {
        node.stop()
      } catch {
        // Already finished.
      }
    },
    ended,
  }
  current = playing
  return playing
}
