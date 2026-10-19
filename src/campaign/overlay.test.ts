import { describe, expect, it } from 'vitest'

import { TIKTOK_ZONES, cameUpTogether, drawHeadline, layoutHeadline, layoutLogo, outlineColorOf, outputSize, sideBySide, wrapText } from './overlay'

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
  it('keeps 4K as 4K and 1080p as 1080p', () => {
    expect(outputSize(2160, 3840)).toEqual({ width: 2160, height: 3840 })
    expect(outputSize(1080, 1920)).toEqual({ width: 1080, height: 1920 })
    expect(outputSize(3840, 2160)).toEqual({ width: 3840, height: 2160 })
  })

  it('brings anything past 4K down to it, and 4K down to 1080p when asked', () => {
    expect(outputSize(4320, 7680)).toEqual({ width: 2160, height: 3840 })
    expect(outputSize(2160, 3840, 1080)).toEqual({ width: 1080, height: 1920 })
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

  it("draws Snapchat's caption: one dark band across the whole frame, white words, no outline", () => {
    const { ctx, calls } = recorder()
    const rects: number[][] = []
    Object.assign(ctx, {
      canvas: { width: 1080, height: 1920 },
      fillRect: (...r: number[]) => rects.push(r),
    })
    const layout = layoutHeadline(ctx, 1080, 1920, { ...base, style: 'snap', text: 'when the app pays you back' })!
    expect(layout.font).toContain('-apple-system')
    drawHeadline(ctx, layout)
    expect(rects).toHaveLength(1)
    const [x, y, w, h] = rects[0]
    expect([x, w]).toEqual([0, 1080])
    // The band holds every line, with room above and below the words.
    expect(y).toBeLessThan(layout.top)
    expect(y + h).toBeGreaterThan(layout.top + layout.lines.length * layout.lineHeight)
    expect(y).toBeGreaterThanOrEqual(1920 * TIKTOK_ZONES.top)
    expect(calls.some((c) => c.startsWith('stroke'))).toBe(false)
    expect(calls).toContain('fill #ffffff')
  })

  it('never lets a bad colour reach the canvas', () => {
    expect(outlineColorOf('#12ab9f')).toBe('#12ab9f')
    expect(outlineColorOf('red')).toBe('#000000')
    expect(outlineColorOf('#12ab9')).toBe('#000000')
    expect(outlineColorOf(undefined)).toBe('#000000')
  })
})

describe('where a headline line is actually drawn', () => {
  it('finds the first and last column with ink in it', async () => {
    const { inkColumns } = await import('./overlay')
    const width = 6
    const height = 2
    const data = new Uint8ClampedArray(width * height * 4)
    data[(1 * width + 2) * 4 + 3] = 255
    data[4 * 4 + 3] = 255
    expect(inkColumns(data, width, height)).toEqual({ first: 2, last: 4 })
    expect(inkColumns(new Uint8ClampedArray(width * height * 4), width, height)).toBeNull()
  })
})

describe('a headline too wide for the frame', () => {
  it('gets a little smaller instead of running off the sides', () => {
    // Letters about 0.6 of the font size wide, as a bold font draws them.
    const ctx = {
      font: '',
      measureText(this: { font: string }, s: string) {
        const px = Number(/(\d+)px/.exec(this.font)?.[1] ?? 10)
        return { width: s.length * px * 0.6, fontBoundingBoxAscent: px * 0.9, fontBoundingBoxDescent: px * 0.25 }
      },
    } as unknown as Parameters<typeof layoutHeadline>[0]
    const fits = layoutHeadline(ctx, 1080, 1920, { text: 'short words here', position: 'top', size: 'large', style: 'outline' })!
    const long = layoutHeadline(ctx, 1080, 1920, { text: 'unbelievablyextraordinarilylongword', position: 'top', size: 'large', style: 'outline' })!
    const room = 1080 * (1 - 2 * TIKTOK_ZONES.side)
    expect(long.fontPx).toBeLessThan(fits.fontPx)
    for (const line of long.lines) expect(line.width).toBeLessThanOrEqual(room)
  })
})

describe('a headline with many words (a long step name)', () => {
  it('gets smaller to stay on screen, every word kept', () => {
    const ctx = {
      font: '',
      measureText(this: { font: string }, s: string) {
        const px = Number(/(\d+)px/.exec(this.font)?.[1] ?? 10)
        return { width: s.length * px * 0.6, fontBoundingBoxAscent: px * 0.9, fontBoundingBoxDescent: px * 0.25 }
      },
    } as unknown as Parameters<typeof layoutHeadline>[0]
    const text = 'NOW DRAW SOMETHING ON THE CANVAS AND WATCH THE APP TURN IT INTO A REAL WORKING WEBSITE IN UNDER A MINUTE WITHOUT WRITING ONE LINE OF CODE YOURSELF'
    const short = layoutHeadline(ctx, 1080, 1920, { text: 'DRAW SOMETHING', position: 'top', size: 'large', style: 'outline' })!
    const long = layoutHeadline(ctx, 1080, 1920, { text, position: 'top', size: 'large', style: 'outline' })!
    expect(long.fontPx).toBeLessThan(short.fontPx)
    expect(long.lines.length * long.lineHeight).toBeLessThanOrEqual(1920 * 0.45)
    expect(long.lines.map((l) => l.text).join(' ')).toBe(text)
    // A usual one is untouched.
    expect(short.fontPx).toBe(layoutHeadline(ctx, 1080, 1920, { text: 'DRAW', position: 'top', size: 'large', style: 'outline' })!.fontPx)
  })
})

describe('pictures that come up together', () => {
  const W = 1080
  const H = 1920

  it('groups pictures said in the same breath, not ones said apart', () => {
    const groups = cameUpTogether([
      { item: 'a', start: 3.0 },
      { item: 'b', start: 3.1 },
      { item: 'c', start: 6 },
    ])
    expect(groups).toEqual([['a', 'b'], ['c']])
  })

  it('puts them side by side, the same height, in the frame, not on top of each other', () => {
    const square = layoutLogo(W, H, { width: 1000, height: 1000 }, { position: 'middle', widthPct: 40 })
    const wide = layoutLogo(W, H, { width: 1600, height: 900 }, { position: 'middle', widthPct: 40 })
    const [a, b] = sideBySide([square, wide], W, H)
    expect(a.height).toBeCloseTo(b.height)
    expect(a.x + a.width).toBeLessThan(b.x)
    expect(a.x).toBeGreaterThanOrEqual(W * TIKTOK_ZONES.side - 0.5)
    expect(b.x + b.width).toBeLessThanOrEqual(W * (1 - TIKTOK_ZONES.side) + 0.5)
    // Each keeps its shape.
    expect(a.width / a.height).toBeCloseTo(1)
    expect(b.width / b.height).toBeCloseTo(1600 / 900)
    // Where they would have been: around the middle.
    expect((a.y + a.height / 2) / H).toBeCloseTo(0.42, 1)
  })

  it('shrinks a row too wide for the frame to fit', () => {
    const big = layoutLogo(W, H, { width: 1000, height: 1000 }, { position: 'middle', widthPct: 60 })
    const row = sideBySide([big, big, big], W, H)
    expect(row[2].x + row[2].width - row[0].x).toBeLessThanOrEqual(W * (1 - 2 * TIKTOK_ZONES.side) + 0.5)
  })

  it('leaves one picture where it was', () => {
    const one = layoutLogo(W, H, { width: 1000, height: 500 }, { position: 'top-left', widthPct: 30 })
    expect(sideBySide([one], W, H)).toEqual([one])
  })

  it('puts a picture he dragged where he dropped it, inside the frame', () => {
    const at = layoutLogo(W, H, { width: 1000, height: 1000 }, { position: 'top', widthPct: 20, center: { x: 0.25, y: 0.75 } })
    expect(at.x + at.width / 2).toBeCloseTo(270)
    expect(at.y + at.height / 2).toBeCloseTo(1440)
    const edge = layoutLogo(W, H, { width: 1000, height: 1000 }, { position: 'top', widthPct: 40, center: { x: 1, y: 0 } })
    expect(edge.x + edge.width).toBeLessThanOrEqual(W)
    expect(edge.y).toBe(0)
  })
})
