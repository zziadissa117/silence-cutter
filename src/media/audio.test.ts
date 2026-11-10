import { describe, expect, it } from 'vitest'

import { ANALYSIS_WINDOW_SEC, LevelMeter, MonoResampler, audioExtent } from './audio'
import { resampleToMono16k } from './fillerWords'

/** The decoder's shape of things: one packet of `frames` at a time. */
function* packets(totalFrames: number, frames: number, sampleRate: number, fill: (i: number) => number, from = 0) {
  for (let at = 0; at < totalFrames; at += frames) {
    const n = Math.min(frames, totalFrames - at)
    const data = new Float32Array(n)
    for (let i = 0; i < n; i++) data[i] = fill(at + i)
    yield { channels: [data], timestamp: from + at / sampleRate }
  }
}

describe('LevelMeter', () => {
  it('measures exact 20 ms windows across 1024-frame packets', () => {
    const meter = new LevelMeter(48000)
    for (const p of packets(48000 * 10, 1024, 48000, () => 0.5)) meter.push(p.channels, p.timestamp)
    meter.flush()
    // 10 s of 20 ms windows: 500 of them, all 0.02 apart, none a stub.
    expect(meter.levels.length).toBe(500)
    for (let i = 1; i < meter.levels.length; i++) {
      expect(meter.levels[i].time - meter.levels[i - 1].time).toBeCloseTo(ANALYSIS_WINDOW_SEC, 9)
    }
    expect(meter.levels[0].time).toBe(0)
    expect(meter.levels[499].time).toBeCloseTo(9.98, 9)
    // A steady 0.5 is -6.02 dB in every window - no quieter stubs.
    for (const level of meter.levels) expect(level.db).toBeCloseTo(20 * Math.log10(0.5), 6)
  })

  it('does the same at 44.1 kHz, where a window is 882 frames', () => {
    const meter = new LevelMeter(44100)
    for (const p of packets(44100 * 3, 1024, 44100, () => 0.25)) meter.push(p.channels, p.timestamp)
    meter.flush()
    expect(meter.levels.length).toBe(150)
    for (let i = 1; i < meter.levels.length; i++) {
      expect(meter.levels[i].time - meter.levels[i - 1].time).toBeCloseTo(882 / 44100, 9)
    }
  })

  it('keeps the track time of the first packet, negative or not', () => {
    const meter = new LevelMeter(48000)
    for (const p of packets(4800, 1024, 48000, () => 0.1, -0.044)) meter.push(p.channels, p.timestamp)
    meter.flush()
    expect(meter.levels[0].time).toBeCloseTo(-0.044, 9)
    expect(meter.levels[1].time).toBeCloseTo(-0.024, 9)
  })

  it('hears a loud moment in whichever channel has it', () => {
    const meter = new LevelMeter(48000)
    const quiet = new Float32Array(960)
    const loud = new Float32Array(960).fill(0.8)
    meter.push([quiet, loud], 0)
    expect(meter.levels[0].db).toBeCloseTo(20 * Math.log10(0.8), 6)
  })

  it('closes the open window at a gap in the track and restarts on the new time', () => {
    const meter = new LevelMeter(48000)
    meter.push([new Float32Array(1024).fill(0.5)], 0)
    // Half a second of nothing, then more sound.
    meter.push([new Float32Array(1024).fill(0.5)], 0.5)
    meter.flush()
    const times = meter.levels.map((l) => l.time)
    expect(times[0]).toBe(0)
    expect(times[1]).toBeCloseTo(0.02, 9)
    expect(times[2]).toBeCloseTo(0.5, 9)
  })

  it('gives the sound its own extent', () => {
    expect(audioExtent([])).toBeUndefined()
    expect(audioExtent([{ time: 0.2, db: -20 }, { time: 0.22, db: -20 }])).toEqual({ start: 0.2, end: expect.closeTo(0.24, 9) })
  })
})

describe('MonoResampler', () => {
  it('keeps time over ten minutes of packets, at both phone rates', () => {
    for (const rate of [44100, 48000]) {
      const r = new MonoResampler()
      const total = rate * 600
      for (const p of packets(total, 1024, rate, () => 0)) r.push(p.channels, rate)
      const out = r.finish(rate)
      const ideal = (total * 16000) / rate
      expect(Math.abs(out.length - ideal)).toBeLessThanOrEqual(2)
    }
  })

  it('matches the one-shot resampler on a single packet', () => {
    const data = new Float32Array(48000)
    for (let i = 0; i < data.length; i++) data[i] = Math.sin((2 * Math.PI * 440 * i) / 48000)
    const once = resampleToMono16k({
      numberOfChannels: 1,
      length: data.length,
      sampleRate: 48000,
      getChannelData: () => data,
    } as unknown as AudioBuffer)
    const r = new MonoResampler()
    r.push([data], 48000)
    const out = r.finish(48000)
    expect(Math.abs(out.length - once.length)).toBeLessThanOrEqual(1)
    for (let i = 0; i < Math.min(out.length, once.length) - 1; i++) expect(out[i]).toBeCloseTo(once[i], 5)
  })

  it('has no seam between packets: a smooth wave stays smooth', () => {
    const rate = 48000
    const r = new MonoResampler()
    const wave = (i: number) => Math.sin((2 * Math.PI * 200 * i) / rate)
    for (const p of packets(rate * 2, 1024, rate, wave)) r.push(p.channels, rate)
    const out = r.finish(rate)
    // The biggest step between neighbours of a 200 Hz wave at 16 kHz.
    const biggest = 2 * Math.PI * 200 / 16000
    for (let i = 1; i < out.length; i++) expect(Math.abs(out[i] - out[i - 1])).toBeLessThan(biggest * 1.05)
  })

  it('mixes channels down to mono', () => {
    const r = new MonoResampler()
    r.push([new Float32Array(16000).fill(1), new Float32Array(16000).fill(0)], 16000)
    const out = r.finish(16000)
    expect(out.length).toBe(16000)
    for (const v of out) expect(v).toBeCloseTo(0.5, 6)
  })
})
