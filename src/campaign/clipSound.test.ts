import { describe, expect, it, vi } from 'vitest'

vi.mock('mediabunny', async (original) => ({
  ...(await original<typeof import('mediabunny')>()),
  AudioSampleSink: class {
    samples() {
      return (async function* () {
        throw new Error('InternalAudioDecoderCocoa decoding failed')
      })()
    }
  },
}))
vi.mock('../report', () => ({ report: vi.fn() }))

import { eachSound, type Clip } from './clipParts'
import { report } from '../report'

describe("a clip whose sound the phone can't decode", () => {
  it('plays silent for its whole length instead of stopping the video', async () => {
    const clip = { audio: { getSampleRate: async () => 48000 }, duration: 2, first: 0 } as unknown as Clip
    let frames = 0
    let loud = false
    await eachSound(clip, [{ start: 0, end: 1 }], 48000, 2, (planes) => {
      frames += planes[0].length
      loud ||= planes.some((p) => p.some((x) => x !== 0))
    })
    expect(frames).toBe(48000)
    expect(loud).toBe(false)
    expect(report).toHaveBeenCalledOnce()
    // The next range doesn't try the decoder again.
    await eachSound(clip, [{ start: 1, end: 2 }], 48000, 2, () => {})
    expect(report).toHaveBeenCalledOnce()
  })

  it("reads it with the browser's own audio decoder instead, when it can", async () => {
    const tone = new Float32Array(48000).fill(0.25)
    ;(globalThis as { OfflineAudioContext?: unknown }).OfflineAudioContext = class {
      async decodeAudioData() {
        return { numberOfChannels: 1, length: tone.length, getChannelData: () => tone }
      }
    }
    const clip = { audio: { getSampleRate: async () => 48000 }, hasSound: true, file: new Blob(['x']), duration: 1, first: 0 } as unknown as Clip
    let loud = 0
    let frames = 0
    await eachSound(clip, [{ start: 0, end: 0.5 }], 48000, 2, (planes) => {
      frames += planes[0].length
      loud += planes[0].filter((x) => x > 0.2).length
    })
    expect(frames).toBe(24000)
    expect(loud).toBe(24000)
    delete (globalThis as { OfflineAudioContext?: unknown }).OfflineAudioContext
  })
})
