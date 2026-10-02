// Background music under his voice: his own track, at a level that stays in
// the background.
//
// The track's loudness is measured and it is set well under the voice - 14
// LU for "normal", 20 for "low" - so a loud master and a quiet one sit the
// same. Measured on a finished video: at 17 LU, dipping while he talked, it
// averaged 21.5 LU under the voice, too faint on a phone speaker. While he talks it dips 5 dB more and comes back up in the pauses,
// gently enough not to pump: the voice is always in front. It fades in and
// out, loops (with a short fade at the seam) if the track is shorter than
// the video, and goes through the voice's limiter with everything else, so
// nothing clips.

import { LoudnessMeter } from './voice'

export type MusicLevel = 'low' | 'normal'

export const MUSIC = {
  /** How far under the voice the music sits, in LU. */
  underVoiceLu: { normal: 14, low: 20 } satisfies Record<MusicLevel, number>,
  /** How much more it dips while he talks. */
  duckDb: 5,
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
  ) {
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
    const loops = trackLength < this.totalFrames
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
      const at = frame % trackLength
      let shape = ease(frame / fadeIn) * ease((this.totalFrames - frame) / fadeOut)
      if (loops) shape *= ease(at / seam) * ease((trackLength - at) / seam)
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
