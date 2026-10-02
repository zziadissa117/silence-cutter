import { describe, expect, it } from 'vitest'

import { stillTimes } from './stills'
import { isMp4Header } from './toMp4'

const head = (brand: string) => new Uint8Array([0, 0, 0, 20, ...'ftyp'.split('').map((c) => c.charCodeAt(0)), ...brand.split('').map((c) => c.charCodeAt(0))])

describe('a finished video posted by hand', () => {
  it('knows an MP4 from a QuickTime .mov, which Postiz turns away', () => {
    expect(isMp4Header(head('isom'))).toBe(true)
    expect(isMp4Header(head('mp42'))).toBe(true)
    expect(isMp4Header(head('qt  '))).toBe(false)
    // Old QuickTime files start with some other box, not ftyp.
    expect(isMp4Header(new Uint8Array([0, 0, 0, 8, 119, 105, 100, 101, 0, 0, 0, 0]))).toBe(false)
    expect(isMp4Header(new Uint8Array(4))).toBe(false)
  })

  it('takes stills early, where the hook is written, then across the video', () => {
    expect(stillTimes(30)).toEqual([0.6, 2.5, 16.5, 25.5])
    expect(stillTimes(3).length).toBeLessThanOrEqual(4)
    expect(stillTimes(3)[0]).toBeCloseTo(0.3)
    expect(stillTimes(0)).toEqual([0])
  })
})
