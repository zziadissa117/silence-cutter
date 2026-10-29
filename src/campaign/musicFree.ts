// A talking video's sound without its music, written beside the video as it
// is made - only when it has music. With it, the music can be changed or taken
// off from the Posts screen after he approved it (addMusic.ts: the picture is
// copied, the sound redone from this), without making the video again. His
// words (2026-10-29): "I already approved it, and then I realize, I don't want
// that music, or maybe I want to change the music."
//
// It is the voice exactly as it goes into the video - shaped, the look's
// sounds in, through its own limiter - stopped just before the music goes
// under it. A small AAC file (about 1 MB a minute). If writing it fails, the
// video is made all the same, only without it.

import { AudioSample, AudioSampleSource, BufferTarget, Mp4OutputFormat, Output, QUALITY_MEDIUM } from 'mediabunny'

import { Limiter } from './voice'

export class MusicFreeCopy {
  private readonly output: Output
  private readonly source: AudioSampleSource
  private readonly target: BufferTarget
  private readonly limiter: Limiter | null
  private started: Promise<void> | null = null
  private failed = false

  /** `limit`: the video's voice goes through a limiter, so this copy does
   *  too; without one its sound is only kept from clipping. */
  constructor(sampleRate: number, channels: number, limit: boolean) {
    this.target = new BufferTarget()
    this.output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: this.target })
    this.source = new AudioSampleSource({ codec: 'aac', quality: QUALITY_MEDIUM })
    this.output.addAudioTrack(this.source)
    this.limiter = limit ? new Limiter(sampleRate, channels) : null
  }

  /** Adds a chunk of the voice, with the look's sounds in and no music,
   *  at `timestamp` seconds. Its own copy: `planes` is left as it is. */
  async add(planes: readonly Float32Array[], timestamp: number, sampleRate: number): Promise<void> {
    if (this.failed || planes.length === 0) return
    try {
      this.started ??= this.output.start()
      await this.started
      const length = planes[0].length
      const data = new Float32Array(length * planes.length)
      const own = planes.map((plane, c) => {
        const into = data.subarray(c * length, (c + 1) * length)
        into.set(plane)
        return into
      })
      if (this.limiter) this.limiter.process(own)
      else for (const plane of own) for (let i = 0; i < plane.length; i++) plane[i] = Math.max(-1, Math.min(1, plane[i]))
      const sample = new AudioSample({ data, format: 'f32-planar', numberOfChannels: planes.length, sampleRate, timestamp })
      await this.source.add(sample)
      sample.close()
    } catch (error) {
      console.warn("The video's sound without its music could not be kept:", error)
      this.failed = true
    }
  }

  /** The finished file, or null when nothing could be kept. */
  async finish(): Promise<Blob | null> {
    if (this.failed || !this.started) {
      await this.cancel()
      return null
    }
    try {
      await this.output.finalize()
      const buffer = this.target.buffer
      return buffer && buffer.byteLength > 0 ? new Blob([buffer], { type: 'audio/mp4' }) : null
    } catch (error) {
      console.warn("The video's sound without its music could not be finished:", error)
      return null
    }
  }

  async cancel(): Promise<void> {
    await this.output.cancel().catch(() => {})
  }
}
