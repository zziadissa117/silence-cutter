import { describe, expect, it } from 'vitest'

import { formulaLine, formulaText, logoName } from './batch'
import { PUSH_TO, formulaPush, layoutFormula } from './formulaOverlay'
import { TIKTOK_ZONES } from './overlay'

/** Enough of a canvas for layout: text measures 0.5 px per character per px of font. */
function fakeCtx() {
  let size = 10
  return {
    set font(value: string) {
      size = Number(/(\d+)px/.exec(value)?.[1] ?? 10)
    },
    get font() {
      return `${size}px x`
    },
    measureText: (s: string) => ({ width: s.length * size * 0.5, fontBoundingBoxAscent: size * 0.9, fontBoundingBoxDescent: size * 0.25 }),
  } as unknown as OffscreenCanvasRenderingContext2D
}

describe('the money line', () => {
  it('is a round amount in the range, in $50 steps, with the ending varied, the same for the same video', () => {
    const lines = Array.from({ length: 200 }, (_, i) => formulaLine({ min: 500, max: 1000 }, `v${i}`))
    for (const line of lines) {
      const amount = Number(/^\$([\d,]+)/.exec(line)![1].replace(',', ''))
      expect(amount).toBeGreaterThanOrEqual(500)
      expect(amount).toBeLessThanOrEqual(1000)
      expect(amount % 50).toBe(0)
    }
    expect(new Set(lines.map((l) => l.replace(/^\$[\d,]+/, ''))).size).toBe(4)
    expect(new Set(lines).size).toBeGreaterThan(20)
    expect(formulaLine({ min: 500, max: 1000 }, 'same')).toBe(formulaLine({ min: 500, max: 1000 }, 'same'))
  })

  it('copes with the range typed backwards or a single amount', () => {
    expect(formulaLine({ min: 1000, max: 500 }, 'x')).toMatch(/^\$(\d{3}|1,000)/)
    expect(formulaLine({ min: 700, max: 700 }, 'x')).toMatch(/^\$700/)
  })

  it('says the hook in words, naming the logos from their files', () => {
    expect(logoName({ name: 'claude-logo.png' })).toBe('Claude')
    expect(formulaText({ left: { id: 'l', name: 'claude.png', type: 'image/png', size: 1 }, right: { id: 'r', name: 'OpenArt.png', type: 'image/png', size: 1 }, min: 500, max: 1000 }, '$650 a day')).toBe(
      'Claude + OpenArt = $650 a day',
    )
  })
})

describe('the layout', () => {
  const W = 1080
  const H = 1920
  const layout = layoutFormula(fakeCtx(), W, H, { left: { width: 400, height: 400 }, right: { width: 800, height: 200 } }, '$650 a day', { style: 'outline' })

  it('puts the logos left and right below TikTok\'s top bar, inside the frame, the plus between them', () => {
    for (const logo of [layout.left!, layout.right!]) {
      expect(logo.y).toBeGreaterThanOrEqual(H * TIKTOK_ZONES.top)
      expect(logo.x).toBeGreaterThanOrEqual(0)
      expect(logo.x + logo.width).toBeLessThanOrEqual(W)
    }
    expect(layout.left!.x + layout.left!.width).toBeLessThan(layout.plus.x)
    expect(layout.right!.x).toBeGreaterThan(layout.plus.x)
    // A wide logo keeps its shape.
    expect(layout.right!.width / layout.right!.height).toBeCloseTo(4)
  })

  it('leaves a blank line between the logos and the money line', () => {
    const logosBottom = Math.max(layout.left!.y + layout.left!.height, layout.right!.y + layout.right!.height)
    expect(layout.line!.top - logosBottom).toBeGreaterThanOrEqual(layout.line!.lineHeight * 0.9)
    expect(layout.line!.lines.map((l) => l.text)).toEqual(['$650 a day'])
  })
})

describe('the slow push', () => {
  it('starts on the whole frame and is a fifth closer by the cut', () => {
    expect(formulaPush(0, 4).scale).toBe(1)
    expect(formulaPush(2, 4).scale).toBeCloseTo(1 + (PUSH_TO - 1) / 2)
    expect(formulaPush(4, 4).scale).toBeCloseTo(PUSH_TO)
    expect(formulaPush(9, 4).scale).toBeCloseTo(PUSH_TO)
  })
})
