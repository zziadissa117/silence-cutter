// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'

import { SilenceCutError, UNREADABLE_FORMAT } from '../media/errors'
import { StoppedEarly } from '../media/recovery'
import { withDecoderRecovery } from './clipParts'

/** The phone's decoder giving up: a DOMException, as Safari throws it. */
const decoderFailure = () => new DOMException('Decoder failure', 'EncodingError')

beforeEach(() => {
  // In front, as a render on the phone is.
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
})

describe('a clip read again after the decoder gives up', () => {
  it('runs the pass again from the last frame written, and says how often', async () => {
    const starts: number[] = []
    let written = -Infinity
    let letGo = 0
    const recovered = await withDecoderRecovery(
      async (from) => {
        starts.push(from)
        // Frames at 0, 0.5, 1, ... up to 3: the decoder gives up twice, at 1.5 and 2.5.
        for (let t = from; t <= 3; t += 0.5) {
          if (starts.length === 1 && t > 1.5) throw decoderFailure()
          if (starts.length === 2 && t > 2.5) throw decoderFailure()
          written = t
        }
      },
      { start: 0, lastWritten: () => written, letGo: async () => void letGo++, maxRecoveries: 4 },
    )
    expect(recovered).toBe(2)
    expect(starts).toEqual([0, 1.5, 2.5])
    expect(letGo).toBe(2)
    expect(written).toBe(3)
  })

  it('counts a second clip on from the first, and gives up past the limit', async () => {
    await expect(
      withDecoderRecovery(
        async () => {
          throw decoderFailure()
        },
        { start: 0, lastWritten: () => -Infinity, letGo: async () => {}, maxRecoveries: 4, recovered: 3 },
      ),
    ).rejects.toThrow('Decoder failure')
  })

  it('tells him plainly when frames keep stopping at the same moment', async () => {
    await expect(
      withDecoderRecovery(
        async () => {
          throw new StoppedEarly(2.5)
        },
        { start: 0, lastWritten: () => 2.5, letGo: async () => {}, maxRecoveries: 1 },
      ),
    ).rejects.toThrow(/kept stopping reading this video at 0:02/)
  })

  it('passes anything that is not the decoder straight through, unchanged', async () => {
    let attempts = 0
    await expect(
      withDecoderRecovery(
        async () => {
          attempts++
          throw new SilenceCutError(UNREADABLE_FORMAT)
        },
        { start: 0, lastWritten: () => -Infinity, letGo: async () => {}, maxRecoveries: 4 },
      ),
    ).rejects.toThrow(UNREADABLE_FORMAT)
    expect(attempts).toBe(1)
  })

  it('says plainly when the phone ran out of storage instead of trying again', async () => {
    await expect(
      withDecoderRecovery(
        async () => {
          throw new DOMException('quota', 'QuotaExceededError')
        },
        { start: 0, lastWritten: () => -Infinity, letGo: async () => {}, maxRecoveries: 4 },
      ),
    ).rejects.toThrow(/ran out of storage/)
  })
})
