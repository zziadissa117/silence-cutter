// Background music under his voice: his own track, at a level that stays in
// the background.
//
// The track's loudness is measured and it is set under the voice - 9 LU for
// "normal", 14 for "low" - so a loud master and a quiet one sit the same.
// While he talks it dips 3 dB more and comes back up in the pauses, gently
// enough not to pump: the voice is always in front.
//
// It used to sit 14 LU under and dip 5 dB, and he couldn't hear it at all:
// the pauses are cut out of his videos, so the dip was on nearly the whole
// time - about 19 dB under a voice at -14 LUFS - and a phone speaker loses
// most of a quiet track's bass. Now it is about 12 dB under while he talks:
// heard clearly, still behind him. It fades in and
// out and goes through the voice's limiter with everything else, so nothing
// clips. A track shorter than the video loops (with a short fade at the seam)
// in a batch video only; in the rest it ends where the song ends - his call
// (2026-10-29): "Don't loop it at all. Just stop it right there".

import { LoudnessMeter } from './voice'

export type MusicLevel = 'low' | 'normal'

export const MUSIC = {
  /** How far under the voice the music sits, in LU. */
  underVoiceLu: { normal: 9, low: 14 } satisfies Record<MusicLevel, number>,
  /** How much more it dips while he talks. */
  duckDb: 3,
  fadeInSec: 0.5,
  fadeOutSec: 1.5,
  /** The fade either side of the seam where a short track starts again. */
  seamSec: 0.04,
  /** How quickly the voice is noticed starting and stopping. */
  voiceAttackMs: 15,
  voiceReleaseMs: 250,
  /** How quickly the music dips and comes back. */
  duckAttackMs: 80,
  duckReleaseMs: 450,
  /** Voice this far under its own loudness counts as a pause. */
  talkingWithinDb: 18,
}

const DB_TO_LN = Math.LN10 / 20
const dbToGain = (db: number) => Math.exp(db * DB_TO_LN)
const coefficient = (sampleRate: number, ms: number) => 1 - Math.exp(-1000 / (ms * sampleRate))

/** The loudness of a track, in LUFS; -Infinity for silence. */
export function trackLoudness(channels: Float32Array[], sampleRate: number): number {
  const meter = new LoudnessMeter(sampleRate, channels.length)
  const chunk = 4096
  const length = channels[0]?.length ?? 0
  for (let at = 0; at < length; at += chunk) meter.add(channels.map((c) => c.subarray(at, at + chunk)))
  return meter.loudness()
}

/** The linear gain that sets a track `level` under a voice. */
export function musicGain(trackLufs: number, voiceLufs: number, level: MusicLevel): number {
  if (!Number.isFinite(trackLufs) || !Number.isFinite(voiceLufs)) return 0
  return dbToGain(voiceLufs - MUSIC.underVoiceLu[level] - trackLufs)
}

/** 0 → 1 over `span` frames, eased. */
const ease = (x: number) => {
  const t = Math.min(1, Math.max(0, x))
  return Math.sin((Math.PI / 2) * t) ** 2
}

/** The music for one video, mixed in chunk by chunk as it is written. */
export class MusicBed {
  private readonly channels: Float32Array[]
  private readonly sampleRate: number
  private readonly totalFrames: number
  private readonly gain: number
  private readonly talkingAboveDb: number
  private readonly voiceAttack: number
  private readonly voiceRelease: number
  private readonly duckAttack: number
  private readonly duckRelease: number
  private readonly loop: boolean
  private voice = 0
  private duck = 0

  constructor(
    /** The track at the video's sample rate, one array per channel. */
    channels: Float32Array[],
    sampleRate: number,
    /** How long the finished video is, in frames: where the fade out ends. */
    totalFrames: number,
    gain: number,
    voiceLufs: number,
    /** Starts the track again when it ends (batch videos); otherwise the
     *  music stops with the song. */
    loop = true,
  ) {
    this.loop = loop
    this.channels = channels
    this.sampleRate = sampleRate
    this.totalFrames = totalFrames
    this.gain = gain
    // Speech peaks run well above its loudness; within this of it is talking.
    this.talkingAboveDb = voiceLufs - MUSIC.talkingWithinDb
    this.voiceAttack = coefficient(sampleRate, MUSIC.voiceAttackMs)
    this.voiceRelease = coefficient(sampleRate, MUSIC.voiceReleaseMs)
    this.duckAttack = coefficient(sampleRate, MUSIC.duckAttackMs)
    this.duckRelease = coefficient(sampleRate, MUSIC.duckReleaseMs)
  }

  /** Adds the music under the voice already in `planes`, which start at
   *  output frame `firstFrame`. */
  mixInto(planes: Float32Array[], firstFrame: number): void {
    const trackLength = this.channels[0]?.length ?? 0
    if (trackLength === 0 || this.gain === 0) return
    const length = planes[0]?.length ?? 0
    const fadeIn = MUSIC.fadeInSec * this.sampleRate
    const fadeOut = MUSIC.fadeOutSec * this.sampleRate
    const seam = MUSIC.seamSec * this.sampleRate
    const loops = this.loop && trackLength < this.totalFrames
    for (let i = 0; i < length; i++) {
      // How loud he is right now, from the voice itself.
      let loudest = 0
      for (const plane of planes) {
        const a = Math.abs(plane[i])
        if (a > loudest) loudest = a
      }
      this.voice += (loudest > this.voice ? this.voiceAttack : this.voiceRelease) * (loudest - this.voice)
      const talking = 20 * Math.log10(this.voice + 1e-9) > this.talkingAboveDb
      const wanted = talking ? -MUSIC.duckDb : 0
      this.duck += (wanted < this.duck ? this.duckAttack : this.duckRelease) * (wanted - this.duck)

      const frame = firstFrame + i
      // The song is over and doesn't start again: silence from here.
      if (!this.loop && frame >= trackLength) continue
      const at = frame % trackLength
      let shape = ease(frame / fadeIn) * ease((this.totalFrames - frame) / fadeOut)
      if (loops) shape *= ease(at / seam) * ease((trackLength - at) / seam)
      // Its last moment eased out, so it ends without a click.
      else if (!this.loop) shape *= ease((trackLength - frame) / seam)
      if (shape <= 0) continue
      const gain = this.gain * shape * dbToGain(this.duck)
      for (let c = 0; c < planes.length; c++) {
        const source = this.channels[Math.min(c, this.channels.length - 1)]
        let value = source[at]
        // A stereo track into a mono video is folded down.
        if (planes.length === 1 && this.channels.length > 1) {
          value = 0
          for (const channel of this.channels) value += channel[at]
          value /= this.channels.length
        }
        planes[c][i] += value * gain
      }
    }
  }
}
