import { afterEach, describe, expect, it, vi } from 'vitest'

import { musicProblem, prepareMusic } from './sounds'

describe('a song for under a video', () => {
  afterEach(() => vi.unstubAllGlobals())

  it("falls back to decoding the whole song, and keeps only what the video uses", async () => {
    const whole = 48000 * 180
    vi.stubGlobal(
      'OfflineAudioContext',
      class {
        decodeAudioData = async () => ({ numberOfChannels: 2, getChannelData: () => new Float32Array(whole) })
      },
    )
    const { channels } = await prepareMusic(new Blob(['not a song mediabunny can open']), 'song', 20, 48000)
    expect(channels).toHaveLength(2)
    expect(channels[0].length).toBe(48000 * 21)
  })

  it('says why a song failed with its type and size, never the song', () => {
    expect(musicProblem(new Error("couldn't be read"), new Blob([new Uint8Array(2_500_000)], { type: 'audio/mp4' }))).toBe(
      "couldn't be read (audio/mp4, 2.5 MB)",
    )
  })
})
