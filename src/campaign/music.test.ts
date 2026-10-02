import { describe, expect, it } from 'vitest'

import { MUSIC, MusicBed, musicGain, trackLoudness } from './music'
import { LoudnessMeter } from './voice'

const RATE = 48000

function sine(seconds: number, amplitude: number, frequency = 440): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE))
  for (let i = 0; i < out.length; i++) out[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / RATE)
  return out
}

function loudness(planes: Float32Array[]): number {
  const meter = new LoudnessMeter(RATE, planes.length)
  for (let at = 0; at < planes[0].length; at += 4096) meter.add(planes.map((p) => p.subarray(at, at + 4096)))
  return meter.loudness()
}

/** The music alone, mixed over `voice` (which is left out afterwards). */
function musicOver(voice: Float32Array, track: Float32Array, gain: number, voiceLufs: number): Float32Array {
  const bed = new MusicBed([track], RATE, voice.length, gain, voiceLufs)
  const mixed = voice.slice()
  for (let at = 0; at < mixed.length; at += 1024) bed.mixInto([mixed.subarray(at, at + 1024)], at)
  return mixed.map((v, i) => v - voice[i])
}

describe('musicGain', () => {
  it('sets any track the same distance under the voice', () => {
    for (const amplitude of [0.9, 0.1]) {
      const track = sine(10, amplitude)
      const gain = musicGain(trackLoudness([track], RATE), -14, 'normal')
      const lufs = loudness([track.map((v) => v * gain)])
      expect(lufs).toBeCloseTo(-14 - MUSIC.underVoiceLu.normal, 1)
    }
  })

  it('puts "low" further under than "normal"', () => {
    const track = sine(5, 0.5)
    const lufs = trackLoudness([track], RATE)
    expect(musicGain(lufs, -14, 'low')).toBeLessThan(musicGain(lufs, -14, 'normal'))
  })

  it('plays nothing for a silent track', () => {
    expect(musicGain(-Infinity, -14, 'normal')).toBe(0)
  })
})

describe('MusicBed', () => {
  const quiet = new Float32Array(RATE * 6)

  it('dips while he talks and comes back in the pauses', () => {
    // Talking for the middle two seconds.
    const voice = quiet.slice()
    voice.set(sine(2, 0.5, 200), RATE * 2)
    const track = sine(6, 0.2)
    const music = musicOver(voice, track, 1, -14)
    const rms = (from: number, to: number) => {
      let sum = 0
      for (let i = from * RATE; i < to * RATE; i++) sum += music[i] * music[i]
      return Math.sqrt(sum / ((to - from) * RATE))
    }
    const talking = 20 * Math.log10(rms(3, 3.8))
    const pause = 20 * Math.log10(rms(1, 1.8))
    expect(pause - talking).toBeGreaterThan(MUSIC.duckDb - 1)
    expect(pause - talking).toBeLessThan(MUSIC.duckDb + 1)
  })

  it('fades in from silence and out to silence', () => {
    const music = musicOver(quiet, sine(6, 0.2), 1, -14)
    expect(Math.abs(music[0])).toBeLessThan(1e-6)
    expect(Math.abs(music[music.length - 1])).toBeLessThan(1e-3)
  })

  it('loops a short track to the end of the video', () => {
    const music = musicOver(quiet, sine(1, 0.2), 1, -14)
    let sum = 0
    for (let i = 4 * RATE; i < 4.5 * RATE; i++) sum += music[i] * music[i]
    expect(Math.sqrt(sum / (0.5 * RATE))).toBeGreaterThan(0.05)
  })
})
