import { describe, expect, it } from 'vitest'

import { Compressor, Limiter, LoudnessMeter, VOICE, Voice, kWeighting, type WalkAudio } from './voice'

const RATE = 48000

function sine(seconds: number, amplitude: number, frequency = 997, rate = RATE): Float32Array {
  const out = new Float32Array(Math.round(seconds * rate))
  for (let i = 0; i < out.length; i++) out[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / rate)
  return out
}

function measured(planes: Float32Array[], rate = RATE): number {
  const meter = new LoudnessMeter(rate, planes.length)
  for (let at = 0; at < planes[0].length; at += 1024) meter.add(planes.map((p) => p.slice(at, at + 1024)))
  return meter.loudness()
}

/** Something shaped like speech: syllables of a voiced tone with a little
 *  breath in it, some loud and some quiet, with short gaps between. */
function speech(seconds: number, level: number, seed = 3): Float32Array {
  let state = seed
  const random = () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
  const out = new Float32Array(Math.round(seconds * RATE))
  let at = 0
  while (at < out.length) {
    const length = Math.round((0.12 + random() * 0.2) * RATE)
    const loudness = level * Math.pow(10, (random() * 16 - 8) / 20)
    const pitch = 100 + random() * 60
    for (let i = 0; i < length && at + i < out.length; i++) {
      const t = i / RATE
      const envelope = Math.sin((Math.PI * i) / length) ** 0.6
      let voiced = 0
      for (let h = 1; h <= 12; h++) voiced += Math.sin(2 * Math.PI * pitch * h * t) / h
      out[at + i] = loudness * envelope * (voiced + 0.1 * (random() - 0.5))
    }
    at += length + Math.round((0.04 + random() * 0.15) * RATE)
  }
  return out
}

/** Hands the planes over in chunks, as copies - the chain works in place. */
function walkOf(planes: Float32Array[], chunk = 1024): WalkAudio {
  return async (visit) => {
    for (let at = 0; at < planes[0].length; at += chunk) visit(planes.map((p) => p.slice(at, at + chunk)))
  }
}

async function throughVoice(planes: Float32Array[]): Promise<{ out: Float32Array[]; voice: Voice | null }> {
  const voice = await Voice.measure(RATE, planes.length, walkOf(planes))
  const out = planes.map((p) => new Float32Array(p.length))
  for (let at = 0; at < planes[0].length; at += 1024) {
    const chunk = planes.map((p) => p.slice(at, at + 1024))
    voice?.shape(chunk)
    voice?.limit(chunk)
    chunk.forEach((c, i) => out[i].set(c, at))
  }
  return { out, voice }
}

/** How far apart loud and quiet phrases are: the spread of the level of
 *  every 400 ms that has voice in it, in dB. */
function spreadDb(plane: Float32Array): number {
  const window = RATE * 0.4
  const levels: number[] = []
  for (let at = 0; at + window <= plane.length; at += RATE / 10) {
    let sum = 0
    for (let i = at; i < at + window; i++) sum += plane[i] * plane[i]
    levels.push(10 * Math.log10(sum / window + 1e-20))
  }
  const loudest = Math.max(...levels)
  const voiced = levels.filter((l) => l > loudest - 20)
  const mean = voiced.reduce((a, b) => a + b, 0) / voiced.length
  return Math.sqrt(voiced.reduce((a, b) => a + (b - mean) ** 2, 0) / voiced.length)
}

const peakDb = (planes: Float32Array[]) => 20 * Math.log10(Math.max(...planes.map((p) => p.reduce((m, v) => Math.max(m, Math.abs(v)), 0))))

describe('kWeighting', () => {
  it('matches the coefficients BS.1770 gives for 48 kHz', () => {
    const [shelf, low] = kWeighting(48000)
    expect(shelf.b0).toBeCloseTo(1.53512485958697, 9)
    expect(shelf.b1).toBeCloseTo(-2.69169618940638, 9)
    expect(shelf.b2).toBeCloseTo(1.19839281085285, 9)
    expect(shelf.a1).toBeCloseTo(-1.69065929318241, 9)
    expect(shelf.a2).toBeCloseTo(0.73248077421585, 9)
    expect(low.a1).toBeCloseTo(-1.99004745483398, 9)
    expect(low.a2).toBeCloseTo(0.99007225036621, 9)
  })
})

describe('LoudnessMeter', () => {
  it('reads a full-scale 1 kHz tone in one channel as -3.01 LUFS, as the standard says', () => {
    expect(measured([sine(5, 1), new Float32Array(5 * RATE)])).toBeCloseTo(-3.01, 1)
  })

  it('reads mono as if it played from both speakers', () => {
    expect(measured([sine(5, 0.1)])).toBeCloseTo(measured([sine(5, 0.1), sine(5, 0.1)]), 2)
  })

  it('works the same at 44.1 kHz', () => {
    expect(measured([sine(5, 1, 997, 44100), new Float32Array(5 * 44100)], 44100)).toBeCloseTo(-3.01, 1)
  })

  it('leaves pauses out of the measure', () => {
    // Half of it silent: an average would read 3 dB quieter.
    const tone = sine(10, 0.1)
    const paused = new Float32Array(20 * RATE)
    paused.set(tone.subarray(0, 5 * RATE), 0)
    paused.set(tone.subarray(0, 5 * RATE), 12 * RATE)
    expect(Math.abs(measured([paused]) - measured([tone]))).toBeLessThan(0.3)
  })

  it('reads silence as nothing heard', () => {
    expect(measured([new Float32Array(RATE)])).toBe(-Infinity)
  })
})

describe('Compressor.reductionAt', () => {
  const { thresholdDb, ratio, kneeDb } = VOICE.compressor

  it('leaves quiet sound alone and brings loud sound down by the ratio', () => {
    expect(Compressor.reductionAt(thresholdDb - kneeDb)).toBe(0)
    expect(Compressor.reductionAt(thresholdDb + 12)).toBeCloseTo(12 / ratio - 12)
  })

  it('bends smoothly through the knee', () => {
    const at = (db: number) => Compressor.reductionAt(db)
    expect(at(thresholdDb)).toBeLessThan(0)
    expect(at(thresholdDb)).toBeGreaterThan(at(thresholdDb + kneeDb / 2))
    expect(at(thresholdDb + kneeDb / 2)).toBeCloseTo((kneeDb / 2) * (1 / ratio - 1))
  })
})

describe('Limiter', () => {
  it('never lets anything past the ceiling', () => {
    let state = 11
    const noise = new Float32Array(RATE).map(() => {
      state = (state * 1664525 + 1013904223) >>> 0
      return (state / 0x100000000 - 0.5) * 0.8
    })
    // Sudden peaks at four times full scale.
    for (let i = 2000; i < noise.length; i += 7919) noise[i] = 4
    const limiter = new Limiter(RATE, 1)
    const planes = [noise.slice()]
    for (let at = 0; at < RATE; at += 480) limiter.process([planes[0].subarray(at, at + 480)])
    expect(peakDb(planes)).toBeLessThanOrEqual(VOICE.ceilingDb + 1e-6)
  })

  it('passes quiet sound through untouched, just a few milliseconds late', () => {
    const tone = sine(0.5, 0.3)
    const out = tone.slice()
    new Limiter(RATE, 1).process([out])
    const late = Math.round((VOICE.limiter.lookaheadMs / 1000) * RATE) - 1
    for (let i = late; i < tone.length; i += 97) expect(out[i]).toBeCloseTo(tone[i - late], 6)
  })
})

describe('Voice', () => {
  it('brings a quiet take up to TikTok loudness without passing the ceiling', async () => {
    const take = speech(20, 0.03)
    expect(measured([take, take])).toBeLessThan(-26)
    const { out, voice } = await throughVoice([take, take.slice()])
    expect(voice).not.toBeNull()
    expect(Math.abs(measured(out) - VOICE.targetLufs)).toBeLessThan(1)
    expect(peakDb(out)).toBeLessThanOrEqual(VOICE.ceilingDb + 1e-6)
  })

  it('brings a loud take down to the same place', async () => {
    const take = speech(20, 0.4, 9)
    const { out } = await throughVoice([take, take.slice()])
    expect(Math.abs(measured(out) - VOICE.targetLufs)).toBeLessThan(1)
  })

  it('evens loud and quiet words out', async () => {
    const take = speech(20, 0.05, 5)
    const { out } = await throughVoice([take])
    expect(spreadDb(out[0])).toBeLessThan(spreadDb(take) * 0.7)
  })

  it('lifts a very quiet take only so far', async () => {
    const take = speech(20, 0.001)
    const before = measured([take])
    const { out } = await throughVoice([take])
    expect(measured(out)).toBeCloseTo(before + VOICE.maxBoostDb, 0)
  })

  it('has nothing to do with silence', async () => {
    expect(await Voice.measure(RATE, 1, walkOf([new Float32Array(RATE)]))).toBeNull()
  })

  it('turns a broken sample into silence instead of breaking the rest', async () => {
    const take = speech(5, 0.05)
    take[1000] = Number.NaN
    take[2000] = Number.POSITIVE_INFINITY
    const { out } = await throughVoice([take])
    expect(out[0].every(Number.isFinite)).toBe(true)
    expect(Math.abs(measured(out) - VOICE.targetLufs)).toBeLessThan(1)
  })
})
