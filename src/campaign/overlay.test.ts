import { describe, expect, it } from 'vitest'

import { TIKTOK_ZONES, layoutLogo, outputSize, wrapText } from './overlay'

describe('wrapText', () => {
  const measure = (s: string) => s.length * 10

  it('breaks between words to fit the width', () => {
    expect(wrapText('get paid for every video', 100, measure)).toEqual(['get paid', 'for every', 'video'])
  })

  it('keeps a word too long for a line whole, on its own line', () => {
    expect(wrapText('a supercalifragilistic b', 100, measure)).toEqual(['a', 'supercalifragilistic', 'b'])
  })

  it('keeps his own line breaks', () => {
    expect(wrapText('one\ntwo', 1000, measure)).toEqual(['one', 'two'])
  })
})

describe('outputSize', () => {
  it('brings 4K down to 1080×1920 and leaves 1080p alone', () => {
    expect(outputSize(2160, 3840)).toEqual({ width: 1080, height: 1920 })
    expect(outputSize(1080, 1920)).toEqual({ width: 1080, height: 1920 })
    expect(outputSize(3840, 2160)).toEqual({ width: 1920, height: 1080 })
  })

  it('never makes a small video bigger, and keeps both sides even', () => {
    expect(outputSize(720, 1280)).toEqual({ width: 720, height: 1280 })
    const odd = outputSize(1081, 1921)
    expect(odd.width % 2).toBe(0)
    expect(odd.height % 2).toBe(0)
  })
})

describe('layoutLogo', () => {
  const image = { width: 400, height: 200 }

  it('sizes the logo by width and keeps its shape', () => {
    const box = layoutLogo(1080, 1920, image, { position: 'middle', widthPct: 30 })
    expect(box.width).toBe(324)
    expect(box.height).toBe(162)
  })

  it('keeps every position clear of TikTok’s buttons, tabs and caption', () => {
    for (const position of ['top-left', 'top-right', 'middle', 'bottom-left', 'bottom-right'] as const) {
      const box = layoutLogo(1080, 1920, image, { position, widthPct: 30 })
      expect(box.y).toBeGreaterThanOrEqual(1920 * TIKTOK_ZONES.top)
      expect(box.y + box.height).toBeLessThanOrEqual(1920 * (1 - TIKTOK_ZONES.bottom))
      expect(box.x).toBeGreaterThanOrEqual(1080 * TIKTOK_ZONES.side - 0.5)
      if (position.startsWith('bottom') || position === 'middle') {
        // The button column runs down the lower right.
        expect(box.x + box.width).toBeLessThanOrEqual(1080 * (1 - TIKTOK_ZONES.right) + 0.5)
      }
    }
  })
})
