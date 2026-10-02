// Makes the voice louder, fuller and clearer - what a voice on TikTok sounds
// like - without ever getting loud enough to hurt.
//
// A phone recording comes out quiet and uneven: the voice sits well under the
// music TikTok lays on top, and a quiet word next to a loud one gets lost.
// This is the chain a voice gets in any studio, in four steps:
//
//   1. EQ: the rumble under the voice goes (a phone speaker never plays it,
//      but it uses up loudness), a little boxiness goes, and the range that
//      makes words clear comes up, so they cut through music.
//   2. Compressor: loud and quiet words brought closer together, which is
//      what makes a voice sound strong and in front.
//   3. Level: brought to -14 LUFS, the loudness TikTok and Instagram voices
//      sit at. It is measured on the video's own kept audio before anything
//      is written, so a quiet take and a loud one come out the same.
//   4. Limiter: a ceiling at -1.5 dB the sound never goes past, so a shout
//      or a hard "p" can't clip or blast.
//
// The look's sounds stay at the volume set for them. Takes used to come in
// anywhere from -31 to -14 LUFS, so a sound sat loud over one video and lost
// under the next; with every voice at one loudness, a sound sits against it
// the same way every time. They go through the limiter with the voice.
//
// Everything here is plain maths on the samples - no audio graph - so the
// render can run it chunk by chunk as the video is written, and the tests can
// run it without a browser.

export const VOICE = {
  /** Where the finished voice lands, in LUFS. */
  targetLufs: -14,
  /** Nothing goes past this, in dB below full scale. The 1.5 dB spare is for
   *  the AAC encoder, which can overshoot a little. */
  ceilingDb: -1.5,
  /** The most a very quiet take is lifted. Past this it is mostly the room. */
  maxBoostDb: 18,
  /** The voice's loudness going into the compressor, so it works the same
   *  on every take. */
  compressorInLufs: -20,
  compressor: { thresholdDb: -22, ratio: 3, kneeDb: 6, detectMs: 10, attackMs: 5, releaseMs: 150 },
  /** How far ahead the limiter looks, and so how late everything comes out:
   *  5 ms, far too little to see against the lips. */
  limiter: { lookaheadMs: 5, releaseMs: 80 },
} as const

const DB_TO_LN = Math.LN10 / 20

function dbToGain(db: number): number {
  return Math.exp(db * DB_TO_LN)
}

// --- Filters ---------------------------------------------------------------

export interface Biquad {
  b0: number
  b1: number
  b2: number
  a1: number
  a2: number
}

function normalized(b0: number, b1: number, b2: number, a0: number, a1: number, a2: number): Biquad {
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 }
}

// The three shapes below are the Audio EQ Cookbook's (R. Bristow-Johnson).

export function highPass(sampleRate: number, frequency: number, q: number): Biquad {
  const w = (2 * Math.PI * frequency) / sampleRate
  const cos = Math.cos(w)
  const alpha = Math.sin(w) / (2 * q)
  return normalized((1 + cos) / 2, -(1 + cos), (1 + cos) / 2, 1 + alpha, -2 * cos, 1 - alpha)
}

export function peaking(sampleRate: number, frequency: number, gainDb: number, q: number): Biquad {
  const a = Math.pow(10, gainDb / 40)
  const w = (2 * Math.PI * frequency) / sampleRate
  const cos = Math.cos(w)
  const alpha = Math.sin(w) / (2 * q)
  return normalized(1 + alpha * a, -2 * cos, 1 - alpha * a, 1 + alpha / a, -2 * cos, 1 - alpha / a)
}

export function highShelf(sampleRate: number, frequency: number, gainDb: number, q: number): Biquad {
  const a = Math.pow(10, gainDb / 40)
  const w = (2 * Math.PI * frequency) / sampleRate
  const cos = Math.cos(w)
  const root = 2 * Math.sqrt(a) * (Math.sin(w) / (2 * q))
  return normalized(
    a * (a + 1 + (a - 1) * cos + root),
    -2 * a * (a - 1 + (a + 1) * cos),
    a * (a + 1 + (a - 1) * cos - root),
    a + 1 - (a - 1) * cos + root,
    2 * (a - 1 - (a + 1) * cos),
    a + 1 - (a - 1) * cos - root,
  )
}

/** ITU-R BS.1770's K-weighting - roughly how loud the ear finds each
 *  frequency - at any sample rate. The constants are the standard's, worked
 *  back to analogue so they hold at 44.1 kHz as well as 48 kHz. */
export function kWeighting(sampleRate: number): Biquad[] {
  const shelf = (() => {
    const k = Math.tan((Math.PI * 1681.974450955533) / sampleRate)
    const q = 0.7071752369554196
    const vh = Math.pow(10, 3.999843853973347 / 20)
    const vb = Math.pow(vh, 0.4996667741545416)
    return normalized(vh + (vb * k) / q + k * k, 2 * (k * k - vh), vh - (vb * k) / q + k * k, 1 + k / q + k * k, 2 * (k * k - 1), 1 - k / q + k * k)
  })()
  const k = Math.tan((Math.PI * 38.13547087602444) / sampleRate)
  const q = 0.5003270373238773
  const a0 = 1 + k / q + k * k
  const low = { b0: 1, b1: -2, b2: 1, a1: (2 * (k * k - 1)) / a0, a2: (1 - k / q + k * k) / a0 }
  return [shelf, low]
}

/** The voice's EQ. A band that would sit too near the top of a low sample
 *  rate is left out rather than bent out of shape. */
export function voiceEq(sampleRate: number): Biquad[] {
  const fits = (frequency: number) => frequency < sampleRate * 0.45
  return [
    // Rumble out, steeply (a 4th-order Butterworth), from just under the
    // lowest a voice goes.
    highPass(sampleRate, 70, 0.5412),
    highPass(sampleRate, 70, 1.3066),
    // A little of the boxiness a room adds.
    peaking(sampleRate, 300, -2, 1),
    // Presence: where the consonants are, so words read over music.
    ...(fits(3000) ? [peaking(sampleRate, 3000, 3, 1)] : []),
    // A touch of air.
    ...(fits(10000) ? [highShelf(sampleRate, 10000, 1.5, 0.7)] : []),
  ]
}

/** A chain of biquads over every channel, each channel keeping its own state
 *  from one chunk to the next. Anything that isn't a real sample - NaN, or
 *  wildly out of range - goes in as silence rather than poisoning the state. */
class Cascade {
  private readonly stages: readonly Biquad[]
  private readonly state: Float64Array

  constructor(stages: readonly Biquad[], channels: number) {
    this.stages = stages
    this.state = new Float64Array(channels * stages.length * 2)
  }

  /** Filters channel `c` from `input` into `output`, which may be the same. */
  run(c: number, input: Float32Array, output: Float32Array): void {
    if (this.stages.length === 0) {
      for (let i = 0; i < input.length; i++) {
        const v = input[i]
        output[i] = v > -16 && v < 16 ? v : 0
      }
      return
    }
    for (let s = 0; s < this.stages.length; s++) {
      const { b0, b1, b2, a1, a2 } = this.stages[s]
      const at = (c * this.stages.length + s) * 2
      let z1 = this.state[at]
      let z2 = this.state[at + 1]
      const from = s === 0 ? input : output
      for (let i = 0; i < from.length; i++) {
        const v = from[i]
        const x = s > 0 || (v > -16 && v < 16) ? v : 0
        const y = b0 * x + z1
        z1 = b1 * x - a1 * y + z2
        z2 = b2 * x - a2 * y
        output[i] = y
      }
      this.state[at] = z1
      this.state[at + 1] = z2
    }
  }
}

// --- Loudness --------------------------------------------------------------

/** Loudness in LUFS from a mean square, per BS.1770. */
const lufs = (meanSquare: number) => -0.691 + 10 * Math.log10(meanSquare)

/** Integrated loudness from 100 ms energies: 400 ms blocks every 100 ms, the
 *  silence gate at -70 LUFS and the relative gate 10 LU under what is left,
 *  so the pauses left in don't pull the number down. */
export function integratedLoudness(energies: readonly number[]): number {
  const blocks: number[] = []
  for (let i = 0; i + 4 <= energies.length; i++) {
    blocks.push((energies[i] + energies[i + 1] + energies[i + 2] + energies[i + 3]) / 4)
  }
  if (blocks.length === 0 && energies.length > 0) blocks.push(energies.reduce((a, b) => a + b, 0) / energies.length)
  const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length
  const heard = blocks.filter((z) => lufs(z) > -70)
  if (heard.length === 0) return -Infinity
  const gate = lufs(mean(heard)) - 10
  return lufs(mean(heard.filter((z) => lufs(z) > gate)))
}

/** Measures loudness the way TikTok's and every streaming service's meters
 *  do (ITU-R BS.1770), fed chunk by chunk. */
export class LoudnessMeter {
  private readonly channels: number
  private readonly weighting: Cascade
  private readonly per100ms: number
  /** Mono is counted as if it played from both speakers, which is how a
   *  phone plays it. */
  private readonly weight: number
  private scratch = new Float32Array(0)
  private power = new Float64Array(0)
  private sum = 0
  private frames = 0
  private readonly energies: number[] = []

  constructor(sampleRate: number, channels: number) {
    this.channels = channels
    this.weighting = new Cascade(kWeighting(sampleRate), channels)
    this.per100ms = Math.max(1, Math.round(sampleRate / 10))
    this.weight = channels === 1 ? 2 : 1
  }

  add(planes: readonly Float32Array[]): void {
    if (planes.length !== this.channels) return
    const length = planes[0]?.length ?? 0
    if (this.scratch.length < length) {
      this.scratch = new Float32Array(length)
      this.power = new Float64Array(length)
    }
    const scratch = this.scratch.subarray(0, length)
    const power = this.power
    power.fill(0, 0, length)
    for (let c = 0; c < this.channels; c++) {
      this.weighting.run(c, planes[c], scratch)
      for (let i = 0; i < length; i++) power[i] += this.weight * scratch[i] * scratch[i]
    }
    for (let i = 0; i < length; i++) {
      this.sum += power[i]
      if (++this.frames === this.per100ms) {
        this.energies.push(this.sum / this.per100ms)
        this.sum = 0
        this.frames = 0
      }
    }
  }

  /** Integrated loudness in LUFS so far; -Infinity when nothing was heard. */
  loudness(): number {
    // The last part-filled 100 ms counts only when it is all there is.
    if (this.energies.length === 0 && this.frames > 0) return integratedLoudness([this.sum / this.frames])
    return integratedLoudness(this.energies)
  }
}

// --- Dynamics --------------------------------------------------------------

const coefficient = (sampleRate: number, ms: number) => 1 - Math.exp(-1000 / (ms * sampleRate))

/** Brings loud words down towards quiet ones, every channel together so the
 *  voice doesn't wander left and right. The gain before it and the gain
 *  after are folded in, so each sample is multiplied once. */
export class Compressor {
  private readonly channels: number
  /** Brings the voice to VOICE.compressorInLufs. */
  private readonly inputGainDb: number
  /** Brings it from there to where it lands. */
  private readonly outputGainDb: number
  private readonly detect: number
  private readonly attack: number
  private readonly release: number
  /** Mean square of the input, smoothed. */
  private envelope = 0
  /** Gain reduction in dB, 0 or below. */
  private reduction = 0

  constructor(sampleRate: number, channels: number, inputGainDb: number, outputGainDb: number) {
    this.channels = channels
    this.inputGainDb = inputGainDb
    this.outputGainDb = outputGainDb
    const { detectMs, attackMs, releaseMs } = VOICE.compressor
    this.detect = coefficient(sampleRate, detectMs)
    this.attack = coefficient(sampleRate, attackMs)
    this.release = coefficient(sampleRate, releaseMs)
  }

  /** How far a level, in dB, is brought down: nothing under the threshold,
   *  1/ratio of the rest over it, and a soft knee between. */
  static reductionAt(levelDb: number): number {
    const { thresholdDb, ratio, kneeDb } = VOICE.compressor
    const over = levelDb - thresholdDb
    const slope = 1 / ratio - 1
    if (2 * over <= -kneeDb) return 0
    if (2 * over < kneeDb) return (slope * (over + kneeDb / 2) ** 2) / (2 * kneeDb)
    return slope * over
  }

  process(planes: Float32Array[]): void {
    if (planes.length !== this.channels) return
    const length = planes[0]?.length ?? 0
    for (let i = 0; i < length; i++) {
      let loudest = 0
      for (let c = 0; c < this.channels; c++) {
        const square = planes[c][i] * planes[c][i]
        if (square > loudest) loudest = square
      }
      this.envelope += this.detect * (loudest - this.envelope)
      const level = 10 * Math.log10(this.envelope + 1e-20) + this.inputGainDb
      const wanted = Compressor.reductionAt(level)
      this.reduction += (wanted < this.reduction ? this.attack : this.release) * (wanted - this.reduction)
      const gain = dbToGain(this.inputGainDb + this.reduction + this.outputGainDb)
      for (let c = 0; c < this.channels; c++) planes[c][i] *= gain
    }
  }
}

/** A ceiling the sound never goes past. It looks a few milliseconds ahead
 *  and eases the gain down in time for a peak, rather than clipping it, then
 *  lets it back up gently. Everything comes out that few milliseconds late.
 *
 *  The gain needed at each sample is held at its lowest over the look-ahead,
 *  then averaged over the same length; every value in that average is at or
 *  under what the delayed peak needs, so the ceiling holds exactly. */
export class Limiter {
  private readonly channels: number
  private readonly ceiling: number
  private readonly span: number
  private readonly delayed: Float32Array[]
  private delayAt = 0
  private readonly releaseRate: number
  private needed = 1
  // The lowest needed gain over the last `span` samples: a queue that only
  // ever holds rising values, oldest first.
  private readonly lowest: Float64Array
  private readonly lowestAt: Float64Array
  private head = 0
  private size = 0
  // The average of the held values over the last `span` samples.
  private readonly held: Float64Array
  private heldAt = 0
  private heldSum: number
  private frame = 0

  constructor(sampleRate: number, channels: number, ceiling = dbToGain(VOICE.ceilingDb)) {
    this.channels = channels
    this.ceiling = ceiling
    this.span = Math.max(1, Math.round((VOICE.limiter.lookaheadMs / 1000) * sampleRate))
    this.delayed = Array.from({ length: channels }, () => new Float32Array(this.span - 1))
    this.releaseRate = coefficient(sampleRate, VOICE.limiter.releaseMs)
    this.lowest = new Float64Array(this.span)
    this.lowestAt = new Float64Array(this.span)
    this.held = new Float64Array(this.span).fill(1)
    this.heldSum = this.span
  }

  process(planes: Float32Array[]): void {
    if (planes.length !== this.channels) return
    const { span, ceiling } = this
    const delay = span - 1
    const length = planes[0]?.length ?? 0
    for (let i = 0; i < length; i++) {
      let peak = 0
      for (let c = 0; c < this.channels; c++) {
        const a = Math.abs(planes[c][i])
        if (a > peak) peak = a
      }
      const needed = peak > ceiling ? ceiling / peak : 1
      this.needed = Math.min(needed, this.needed + (1 - this.needed) * this.releaseRate)

      if (this.size > 0 && this.lowestAt[this.head] <= this.frame - span) {
        this.head = (this.head + 1) % span
        this.size--
      }
      while (this.size > 0 && this.lowest[(this.head + this.size - 1) % span] >= this.needed) this.size--
      const back = (this.head + this.size) % span
      this.lowest[back] = this.needed
      this.lowestAt[back] = this.frame
      this.size++
      const hold = this.lowest[this.head]

      this.heldSum += hold - this.held[this.heldAt]
      this.held[this.heldAt] = hold
      this.heldAt = (this.heldAt + 1) % span
      const gain = Math.min(1, this.heldSum / span)

      for (let c = 0; c < this.channels; c++) {
        let x = planes[c][i]
        if (delay > 0) {
          const line = this.delayed[c]
          const out = line[this.delayAt]
          line[this.delayAt] = x
          x = out
        }
        const y = x * gain
        planes[c][i] = y > ceiling ? ceiling : y < -ceiling ? -ceiling : y
      }
      if (delay > 0) this.delayAt = (this.delayAt + 1) % delay
      this.frame++
    }
  }
}

// --- The whole chain -------------------------------------------------------

/** The gain after the compressor that lands the voice, from the take's
 *  loudness as recorded and after the EQ and compressor. */
export function outputGainFor(rawLufs: number, compressedLufs: number): number {
  const lift = Math.min(VOICE.targetLufs - rawLufs, VOICE.maxBoostDb)
  return rawLufs + lift - compressedLufs
}

/** Runs `visit` over every chunk of the video's kept audio, in order. */
export type WalkAudio = (visit: (planes: Float32Array[]) => void) => Promise<void>

/** The kept audio's loudness as recorded, in LUFS - for setting music under
 *  a voice that isn't being boosted. -Infinity when there is none. */
export async function measureLoudness(sampleRate: number, channels: number, walk: WalkAudio): Promise<number> {
  const meter = new LoudnessMeter(sampleRate, channels)
  await walk((planes) => meter.add(planes))
  return meter.loudness()
}

/** The chain for one video, measured and ready to run as it is written. */
export class Voice {
  private readonly channels: number
  private readonly eq: Cascade
  private readonly compressor: Compressor
  private readonly limiter: Limiter
  /** Where the voice lands, in LUFS - what background music is set under. */
  readonly lufs: number

  constructor(sampleRate: number, channels: number, inputGainDb: number, outputGainDb: number, lufs: number = VOICE.targetLufs) {
    this.channels = channels
    this.lufs = lufs
    this.eq = new Cascade(voiceEq(sampleRate), channels)
    this.compressor = new Compressor(sampleRate, channels, inputGainDb, outputGainDb)
    this.limiter = new Limiter(sampleRate, channels)
  }

  /** Measures a video's kept audio - twice, as recorded and then through the
   *  EQ and compressor, which reads it a second time rather than holding the
   *  whole soundtrack in memory - and returns its chain. Null when there is
   *  no voice to measure. */
  static async measure(sampleRate: number, channels: number, walk: WalkAudio): Promise<Voice | null> {
    const eq = new Cascade(voiceEq(sampleRate), channels)
    const raw = new LoudnessMeter(sampleRate, channels)
    const shaped = new LoudnessMeter(sampleRate, channels)
    await walk((planes) => {
      if (planes.length !== channels) return
      raw.add(planes)
      for (let c = 0; c < channels; c++) eq.run(c, planes[c], planes[c])
      shaped.add(planes)
    })
    const rawLufs = raw.loudness()
    const eqLufs = shaped.loudness()
    if (!Number.isFinite(rawLufs) || !Number.isFinite(eqLufs)) return null

    const inputGainDb = VOICE.compressorInLufs - eqLufs
    const again = new Cascade(voiceEq(sampleRate), channels)
    const compressor = new Compressor(sampleRate, channels, inputGainDb, 0)
    const compressed = new LoudnessMeter(sampleRate, channels)
    await walk((planes) => {
      if (planes.length !== channels) return
      for (let c = 0; c < channels; c++) again.run(c, planes[c], planes[c])
      compressor.process(planes)
      compressed.add(planes)
    })
    const compressedLufs = compressed.loudness()
    if (!Number.isFinite(compressedLufs)) return null
    const lands = rawLufs + Math.min(VOICE.targetLufs - rawLufs, VOICE.maxBoostDb)
    return new Voice(sampleRate, channels, inputGainDb, outputGainFor(rawLufs, compressedLufs), lands)
  }

  /** EQ, compressor and level, in place. The look's sounds go in after this. */
  shape(planes: Float32Array[]): void {
    if (planes.length !== this.channels) return
    for (let c = 0; c < this.channels; c++) this.eq.run(c, planes[c], planes[c])
    this.compressor.process(planes)
  }

  /** The ceiling, in place - after the sounds are in, so they can't clip it
   *  either. */
  limit(planes: Float32Array[]): void {
    this.limiter.process(planes)
  }
}
