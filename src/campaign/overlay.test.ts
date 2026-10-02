import { describe, expect, it } from 'vitest'

import { TIKTOK_ZONES, drawHeadline, layoutHeadline, layoutLogo, outlineColorOf, outputSize, wrapText } from './overlay'

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

describe('outlined headlines', () => {
  /** A canvas that only remembers what was drawn. */
  function recorder() {
    const calls: string[] = []
    const ctx = {
      font: '',
      textAlign: '',
      textBaseline: '',
      lineJoin: '',
      miterLimit: 0,
      lineWidth: 0,
      strokeStyle: '',
      fillStyle: '',
      save: () => calls.push('save'),
      restore: () => calls.push('restore'),
      measureText: (s: string) => ({ width: s.length * 10, fontBoundingBoxAscent: 20, fontBoundingBoxDescent: 5 }),
      strokeText(this: { strokeStyle: string; lineWidth: number }) {
        calls.push(`stroke ${this.strokeStyle} ${this.lineWidth.toFixed(2)}`)
      },
      fillText(this: { fillStyle: string }) {
        calls.push(`fill ${this.fillStyle}`)
      },
      beginPath: () => calls.push('box'),
      fillRect: () => calls.push('box'),
      roundRect: () => calls.push('box'),
      closePath: () => calls.push('box'),
      moveTo: () => calls.push('box'),
      lineTo: () => calls.push('box'),
      arcTo: () => calls.push('box'),
      quadraticCurveTo: () => calls.push('box'),
      fill: () => calls.push('box'),
    }
    return { ctx: ctx as unknown as Parameters<typeof layoutHeadline>[0], calls }
  }
  const base = { text: 'HELLO', position: 'top', size: 'medium', style: 'outline' } as const

  it('draws white letters with an outline and no background box', () => {
    const { ctx, calls } = recorder()
    const layout = layoutHeadline(ctx, 1080, 1920, base)!
    drawHeadline(ctx, layout)
    expect(calls).not.toContain('box')
    expect(calls.some((c) => c.startsWith('stroke #000000'))).toBe(true)
    expect(calls).toContain('fill #ffffff')
  })

  it('takes the outline colour and width he set', () => {
    const normal = recorder()
    drawHeadline(normal.ctx, layoutHeadline(normal.ctx, 1080, 1920, base)!)
    const thick = recorder()
    drawHeadline(thick.ctx, layoutHeadline(thick.ctx, 1080, 1920, { ...base, outlineColor: '#ff0000', outlineWidth: 'thick' })!)
    const width = (calls: string[]) => Number(calls.find((c) => c.startsWith('stroke'))!.split(' ')[2])
    expect(thick.calls.find((c) => c.startsWith('stroke'))).toContain('#ff0000')
    expect(width(thick.calls)).toBeGreaterThan(width(normal.calls))
  })

  it('never lets a bad colour reach the canvas', () => {
    expect(outlineColorOf('#12ab9f')).toBe('#12ab9f')
    expect(outlineColorOf('red')).toBe('#000000')
    expect(outlineColorOf('#12ab9')).toBe('#000000')
    expect(outlineColorOf(undefined)).toBe('#000000')
  })
})
