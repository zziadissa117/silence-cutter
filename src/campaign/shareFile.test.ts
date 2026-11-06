import { describe, expect, it } from 'vitest'

import { shareName } from './shareFile'

describe('the name a video is saved under', () => {
  it('a joined video: the first recording, how many more, the campaign - short', () => {
    const long = 'REC 2026-11-05 22-43-08.mp4 + REC 2026-11-05 22-44-33 (2).mp4 + REC 2026-11-05 22-44-59 (3).mp4 + REC 2026-11-05 22-47-15 (8)_thetawave.mp4'
    const name = shareName(long)
    expect(name).toBe('REC-2026-11-05-22-43-08+3_thetawave.mp4')
    expect(name.length).toBeLessThanOrEqual(64)
  })
  it('one recording keeps its name and campaign', () => {
    expect(shareName('IMG_1065_astrocade.mp4')).toBe('IMG_1065_astrocade.mp4')
  })
  it('never too long', () => {
    expect(shareName(`${'x'.repeat(300)}.mp4`).length).toBe(64)
  })
})
