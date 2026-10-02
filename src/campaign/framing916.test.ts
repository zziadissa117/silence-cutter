import { describe, expect, it } from 'vitest'
import { framedSize, is916, planFrame } from './framing916'

describe('is916', () => {
  it('accepts 9:16 and near it, nothing else', () => {
    expect(is916(1080, 1920)).toBe(true)
    expect(is916(720, 1280)).toBe(true)
    expect(is916(1920, 1080)).toBe(false)
    expect(is916(1080, 1440)).toBe(false)
  })
})

describe('framedSize', () => {
  it('leaves a 9:16 clip as outputSize would', () => {
    expect(framedSize(1080, 1920, 'fill')).toEqual({ width: 1080, height: 1920 })
    expect(framedSize(2160, 3840, 'fit')).toEqual({ width: 1080, height: 1920 })
  })
  it('crops a landscape clip to the biggest 9:16 inside it', () => {
    expect(framedSize(1920, 1080, 'fill')).toEqual({ width: 608, height: 1080 })
  })
  it('fits into 1080x1920', () => {
    expect(framedSize(1920, 1080, 'fit')).toEqual({ width: 1080, height: 1920 })
  })
  it('off keeps the clip shape', () => {
    expect(framedSize(1920, 1080, 'off')).toEqual({ width: 1920, height: 1080 })
  })
})

describe('planFrame', () => {
  it('fills: covers the canvas, centred, no blur', () => {
    const p = planFrame(1920, 1080, 608, 1080, 'fill')
    expect(p.blurred).toBe(false)
    expect(p.main.height).toBeCloseTo(1080)
    expect(p.main.x).toBeLessThan(0)
  })
  it('fits: whole picture inside, blurred behind', () => {
    const p = planFrame(1920, 1080, 1080, 1920, 'fit')
    expect(p.blurred).toBe(true)
    expect(p.main.width).toBeCloseTo(1080)
    expect(p.main.y).toBeGreaterThan(0)
  })
  it('does not touch a 9:16 clip in any mode', () => {
    for (const mode of ['fill', 'fit', 'off'] as const) {
      expect(planFrame(1080, 1920, 1080, 1920, mode)).toEqual({ main: { x: 0, y: 0, width: 1080, height: 1920 }, blurred: false })
    }
  })
})
