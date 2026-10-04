import { describe, expect, it } from 'vitest'

import { manualCues, previewStyle, type ManualPicture } from './manualPictures'

const pic = (id: string): ManualPicture => ({
  id,
  source: { kind: 'bank', pictureId: 'b1' },
  at: 12.5,
  seconds: 3,
  position: 'top-right',
  widthPct: 40,
})

describe('manualCues', () => {
  it('turns pictures with images into cues at their moments', () => {
    const blob = new Blob(['x'])
    const out = manualCues([pic('a')], new Map([['a', blob]]))
    expect(out.cues).toEqual([{ id: 'a', image: blob, words: [], seconds: 3, position: 'top-right', widthPct: 40 }])
    expect(out.at.get('a')).toBe(12.5)
    expect(out.missing).toEqual([])
  })
  it('names the ones whose image is gone instead of dropping them silently', () => {
    const out = manualCues([pic('a'), pic('b')], new Map([['a', new Blob(['x'])]]))
    expect(out.cues).toHaveLength(1)
    expect(out.missing.map((m) => m.id)).toEqual(['b'])
  })
})

describe('previewStyle', () => {
  it('keeps right-hand pictures clear of the button column', () => {
    expect(previewStyle('bottom-right', 40).right).toBe('15%')
    expect(previewStyle('top-right', 40).right).toBe('6%')
  })
})
