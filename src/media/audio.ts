// Reading a video's sound once, for both things the cutter needs from it:
// the loudness curve the silence maths reads, and a 16 kHz mono copy for the
// speech model. Shared by the plain cutter and the campaign page, so a fix to
// how the sound is measured is made once.
//
// The decoder hands the sound over one packet at a time - 1024 frames of
// AAC, which is not a whole number of 20 ms windows. Measuring each packet
// on its own left a 1-3 ms stub at the end of every one, so the "20 ms grid"
// every consumer assumes (alignToAudio, checkedCut, softenEnds) was really
// ~94 uneven levels a second: words were lined up against the wrong part of
// the curve, and the sound inside an "um" was counted nearly twice over. The
// meter below carries the open window across packets, so the grid is exactly
// what the tests say it is. The resampler carries its position across
// packets for the same reason: rounding each packet's length on its own
// drifted the speech model's copy by more than half a second over ten
// minutes, and every word's time with it.

import { AudioBufferSink, type Input } from 'mediabunny'

import { WHISPER_SAMPLE_RATE } from './fillerWords'
import type { Level } from './silenceMath'

/** 20 ms, the grain ffmpeg's silencedetect uses by default. */
export const ANALYSIS_WINDOW_SEC = 0.02

type AudioTrack = NonNullable<Awaited<ReturnType<Input['getPrimaryAudioTrack']>>>

/** Loudness of one audio window, in dB, from its root-mean-square amplitude.
 *  Silence is -Infinity dB, which is always below any real threshold. */
export function levelDb(rms: number): number {
  return rms <= 0 ? -Infinity : 20 * Math.log10(rms)
}

/** Wraps a progress callback so it only fires on real movement. The points
 *  it is called from arrive dozens of times a second, and each one is a
 *  React render; a bar that moves in percent does not need more than this. */
export function throttled(onProgress?: (fraction: number) => void): (fraction: number) => void {
  let last = -1
  return (fraction) => {
    const capped = Math.max(0, Math.min(0.99, fraction))
    if (!onProgress || capped - last < 0.01) return
    last = capped
    onProgress(capped)
  }
}

/** The loudness curve, in exact 20 ms windows that run on across packets.
 *  The loudest channel counts, not the first one: a phone's two channels are
 *  not the same recording, and judging by one of them can call a moment
 *  quiet that the other heard perfectly well - which is how a word ends up
 *  inside a "pause". */
export class LevelMeter {
  readonly levels: Level[] = []
  readonly windowFrames: number
  private sums = new Float64Array(0)
  private filled = 0
  private windowStart = 0
  private expectedNext: number | null = null
  readonly sampleRate: number

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate
    this.windowFrames = Math.max(1, Math.round(ANALYSIS_WINDOW_SEC * sampleRate))
  }

  /** One packet's channels, starting at `timestamp` seconds. */
  push(channels: Float32Array[], timestamp: number): void {
    const length = channels[0]?.length ?? 0
    if (length === 0) return
    if (this.sums.length !== channels.length) {
      this.flush()
      this.sums = new Float64Array(channels.length)
    }
    // A jump in time between packets - a gap in the track - closes the open
    // window where the sound stopped and starts the next on the new time.
    if (this.expectedNext !== null && Math.abs(timestamp - this.expectedNext) > ANALYSIS_WINDOW_SEC) this.flush()
    if (this.filled === 0 && this.expectedNext === null) this.windowStart = timestamp
    else if (this.filled === 0 && Math.abs(timestamp - this.expectedNext!) > ANALYSIS_WINDOW_SEC) this.windowStart = timestamp
    let i = 0
    while (i < length) {
      const take = Math.min(this.windowFrames - this.filled, length - i)
      for (let c = 0; c < channels.length; c++) {
        const data = channels[c]
        let sum = this.sums[c]
        for (let j = i; j < i + take; j++) sum += data[j] * data[j]
        this.sums[c] = sum
      }
      this.filled += take
      i += take
      if (this.filled === this.windowFrames) this.emit()
    }
    this.expectedNext = timestamp + length / this.sampleRate
  }

  private emit(): void {
    let loudest = 0
    for (let c = 0; c < this.sums.length; c++) loudest = Math.max(loudest, Math.sqrt(this.sums[c] / this.filled))
    this.levels.push({ time: this.windowStart, db: levelDb(loudest) })
    this.windowStart += this.filled / this.sampleRate
    this.filled = 0
    this.sums.fill(0)
  }

  /** Closes a part-filled window: the end of the sound, or a gap in it. */
  flush(): void {
    if (this.filled > 0) this.emit()
  }
}

/** Mixes the sound down to mono and resamples it to 16 kHz by linear
 *  interpolation, carrying the read position across packets so the copy
 *  keeps time with the video however long it is. Good enough for speech
 *  recognition - this isn't preserving fidelity, just putting words in the
 *  right place. */
export class MonoResampler {
  private readonly pieces: Float32Array[] = []
  private consumed = 0
  private nextOut = 0
  private last = 0
  readonly outRate: number

  constructor(outRate = WHISPER_SAMPLE_RATE) {
    this.outRate = outRate
  }

  push(channels: Float32Array[], sampleRate: number): void {
    const n = channels[0]?.length ?? 0
    if (n === 0) return
    const mono = new Float32Array(n)
    for (const data of channels) for (let i = 0; i < n; i++) mono[i] += data[i] / channels.length
    const ratio = sampleRate / this.outRate
    const base = this.consumed
    // Every output sample whose two neighbours are in hand: the last sample
    // of this packet waits for the next one, the first leans on the last of
    // the one before.
    const out = new Float32Array(Math.ceil(n / ratio) + 2)
    let made = 0
    let k = this.nextOut
    for (;;) {
      const p = k * ratio
      if (p >= base + n - 1) break
      const i0 = Math.floor(p)
      const frac = p - i0
      const a = i0 < base ? this.last : mono[i0 - base]
      const b = mono[i0 + 1 - base]
      out[made++] = a * (1 - frac) + b * frac
      k++
    }
    this.nextOut = k
    this.consumed += n
    this.last = mono[n - 1]
    if (made > 0) this.pieces.push(out.subarray(0, made))
  }

  /** Everything, including the output samples that were waiting on a next
   *  packet that never came. */
  finish(sampleRate = 48000): Float32Array {
    const ratio = sampleRate / this.outRate
    const tail: number[] = []
    for (let k = this.nextOut; k * ratio <= this.consumed - 1 + 1e-9; k++) tail.push(this.last)
    if (tail.length > 0) this.pieces.push(Float32Array.from(tail))
    const total = this.pieces.reduce((sum, p) => sum + p.length, 0)
    const all = new Float32Array(total)
    let at = 0
    for (const piece of this.pieces) {
      all.set(piece, at)
      at += piece.length
    }
    return all
  }
}

export interface DecodedAudio {
  levels: Level[]
  /** The 16 kHz mono copy, when asked for; index 0 is `audioStart`. */
  mono16k: Float32Array | null
  /** When the sound starts, in the video's own time. An iPhone's AAC starts
   *  a little before zero once its edit list is applied (about -0.044 s). */
  audioStart: number
}

/** Decodes the audio track once and returns whatever it was asked for: the
 *  loudness curve silenceMath reads, and/or the 16 kHz copy for the speech
 *  model. One pass either way, so asking for both doesn't mean decoding
 *  twice. */
export async function decodeAudio(
  audioTrack: AudioTrack,
  wantMono16k: boolean,
  duration: number,
  onProgress?: (fraction: number) => void,
): Promise<DecodedAudio> {
  const sink = new AudioBufferSink(audioTrack)
  const report = throttled(onProgress)
  let meter: LevelMeter | null = null
  const resampler = wantMono16k ? new MonoResampler() : null
  let audioStart: number | null = null
  let sampleRate = 48000

  for await (const { buffer, timestamp } of sink.buffers()) {
    // Listening to a long take is minutes of work on a phone, and all of it
    // happens before a single frame is encoded. Without this the bar sits at
    // zero throughout and the app looks hung.
    if (duration > 0) report(timestamp / duration)
    sampleRate = buffer.sampleRate
    meter ??= new LevelMeter(sampleRate)
    audioStart ??= timestamp
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c))
    meter.push(channels, timestamp)
    resampler?.push(channels, sampleRate)
  }
  meter?.flush()
  return {
    levels: meter?.levels ?? [],
    mono16k: resampler ? resampler.finish(sampleRate) : null,
    audioStart: audioStart ?? 0,
  }
}

/** Where the sound actually runs, from its first measured window to the end
 *  of its last - for the silence maths, which otherwise takes the video's
 *  container for the sound's extent. */
export function audioExtent(levels: Level[]): { start: number; end: number } | undefined {
  if (levels.length === 0) return undefined
  const step = levels.length > 1 ? levels[1].time - levels[0].time : ANALYSIS_WINDOW_SEC
  return { start: levels[0].time, end: levels[levels.length - 1].time + step }
}
