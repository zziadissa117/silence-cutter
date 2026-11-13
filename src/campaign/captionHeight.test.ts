// A talking format's captions at any height he drags them to (2026-11-13).

import { describe, expect, it } from 'vitest'

import { captionHeightAt } from './CaptionHeight'
import { CAPTION_SPOT, captionY } from './captions'

describe('captions at a height of his own', () => {
  it('draws them where he put them, kept clear of the very top and the buttons at the bottom', () => {
    expect(captionY(0.3)).toBe(0.3)
    expect(captionY(0.02)).toBe(CAPTION_SPOT.min)
    expect(captionY(0.99)).toBe(CAPTION_SPOT.max)
    // The named places as before.
    expect(captionY('top')).toBe(0.2)
    expect(captionY('usual')).toBe(0.66)
  })

  it('snaps to the middle when dragged close to it', () => {
    expect(captionHeightAt(0.51)).toBe(0.5)
    expect(captionHeightAt(0.4)).toBe(0.4)
    expect(captionHeightAt(0.95)).toBe(CAPTION_SPOT.max)
  })
})
