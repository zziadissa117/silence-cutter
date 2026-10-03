import { describe, expect, it } from 'vitest'

import { FACE, NO_EFFECTS, framingAt, hitAmount, logoPop, placeFrame, planMotion, randomFrom } from './effects'

const segments = [2, 1.5, 0.4, 2.2, 1.8, 1.1, 3, 0.9, 1.6, 2.4]

describe('planMotion', () => {
  it('does nothing at all with every effect off', () => {
    const plan = planMotion(NO_EFFECTS, segments, 'a')
    expect(plan.segments.every((s) => s.scale === 1 && s.dx === 0)).toBe(true)
    expect(plan.hook).toBe(0)
    expect(plan.hit).toBe(0)
  })

  it('opens wide, stays within its limits, and never jumps on a stretch too short to read', () => {
    for (const level of ['subtle', 'strong'] as const) {
      for (let seed = 0; seed < 50; seed++) {
        const plan = planMotion({ ...NO_EFFECTS, cutPunch: level }, segments, `s${seed}`)
        expect(plan.segments[0].scale).toBe(1)
        const [low, high] = level === 'subtle' ? [1.08, 1.13] : [1.15, 1.22]
        for (const s of plan.segments) {
          expect(s.scale === 1 || (s.scale >= low && s.scale <= high)).toBe(true)
          expect(Math.abs(s.dx)).toBeLessThanOrEqual(0.015)
        }
        // The 0.4s stretch keeps whatever framing came before it.
        expect(plan.segments[2]).toEqual(plan.segments[1])
      }
    }
  })

  it('is the same every time for one video, and different between videos', () => {
    const effects = { ...NO_EFFECTS, cutPunch: 'subtle' as const, hookPush: 'subtle' as const }
    expect(planMotion(effects, segments, 'video-1')).toEqual(planMotion(effects, segments, 'video-1'))
    const plans = Array.from({ length: 10 }, (_, i) => JSON.stringify(planMotion(effects, segments, `video-${i}`)))
    expect(new Set(plans).size).toBe(10)
  })

  it('does not punch in at every single cut', () => {
    let changes = 0
    let cuts = 0
    for (let seed = 0; seed < 200; seed++) {
      const plan = planMotion({ ...NO_EFFECTS, cutPunch: 'subtle' }, [2, 2, 2, 2, 2], `c${seed}`)
      for (let i = 1; i < plan.segments.length; i++) {
        cuts++
        if (plan.segments[i].scale !== plan.segments[i - 1].scale) changes++
      }
    }
    expect(changes / cuts).toBeGreaterThan(0.65)
    expect(changes / cuts).toBeLessThan(0.85)
  })
})

describe('framingAt', () => {
  it('pushes in over the opening stretch only', () => {
    const plan = planMotion({ ...NO_EFFECTS, hookPush: 'strong' }, [5, 2], 'h')
    const early = framingAt(plan, 0, 0.5, []).scale
    const later = framingAt(plan, 0, 2.5, []).scale
    expect(framingAt(plan, 0, 0, []).scale).toBe(1)
    expect(later).toBeGreaterThan(early)
    expect(later).toBeLessThanOrEqual(1.14 + 1e-9)
    expect(framingAt(plan, 1, 5.5, []).scale).toBe(1)
  })

  it('punches in on the brand and comes back out within a second', () => {
    const plan = planMotion({ ...NO_EFFECTS, brandHit: 'subtle' }, [6], 'b', 1)
    expect(framingAt(plan, 0, 1.99, [2]).scale).toBe(1)
    expect(framingAt(plan, 0, 2.3, [2]).scale).toBeGreaterThan(1.05)
    expect(framingAt(plan, 0, 3.1, [2]).scale).toBe(1)
  })
})

describe('hitAmount', () => {
  it('rises fast, holds, and eases out', () => {
    expect(hitAmount(-0.1, 0.1)).toBe(0)
    expect(hitAmount(0.06, 0.1)).toBeGreaterThan(0.05)
    expect(hitAmount(0.4, 0.1)).toBe(0.1)
    expect(hitAmount(0.8, 0.1)).toBeGreaterThan(0)
    expect(hitAmount(1, 0.1)).toBe(0)
  })
})

describe('placeFrame', () => {
  it('always covers the whole canvas, and zooms toward the face', () => {
    for (const scale of [1, 1.08, 1.2, 1.45]) {
      for (const dx of [-0.015, 0, 0.015]) {
        const p = placeFrame({ scale, dx }, 1080, 1920)
        expect(p.x).toBeLessThanOrEqual(0)
        expect(p.y).toBeLessThanOrEqual(0)
        expect(p.x + p.width).toBeGreaterThanOrEqual(1080 - 1e-6)
        expect(p.y + p.height).toBeGreaterThanOrEqual(1920 - 1e-6)
      }
    }
    // The face's spot stays where it was: zooming grows the frame around it.
    const p = placeFrame({ scale: 1.2, dx: 0 }, 1080, 1920)
    expect(p.x + FACE.x * p.width).toBeCloseTo(FACE.x * 1080)
    expect(p.y + FACE.y * p.height).toBeCloseTo(FACE.y * 1920)
  })
})

describe('logoPop', () => {
  it('springs in from small, goes a little past full size, and settles', () => {
    expect(logoPop(0, 2.5)).toEqual({ scale: expect.closeTo(0.6, 5), alpha: 0 })
    const peak = Math.max(...Array.from({ length: 38 }, (_, i) => logoPop(i / 100, 2.5).scale))
    expect(peak).toBeGreaterThan(1.03)
    expect(peak).toBeLessThan(1.1)
    expect(logoPop(0.5, 2)).toEqual({ scale: 1, alpha: 1 })
  })

  it('fades as it leaves', () => {
    expect(logoPop(2, 0.09).alpha).toBeCloseTo(0.5)
    expect(logoPop(2, 0).alpha).toBe(0)
  })
})

describe('randomFrom', () => {
  it('repeats for a seed and spreads over 0-1', () => {
    const a = randomFrom('x')
    const b = randomFrom('x')
    const values = Array.from({ length: 1000 }, () => a())
    expect(values.slice(0, 5)).toEqual(Array.from({ length: 5 }, () => b()))
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...values)).toBeLessThan(1)
    expect(values.reduce((s, v) => s + v, 0) / values.length).toBeCloseTo(0.5, 1)
  })
})

import { zoomPlace } from './effects'

describe('zoomPlace', () => {
  const canvas = { w: 1080, h: 1920 }
  it('leaves an unzoomed frame where it is', () => {
    const place = { x: -100, y: 0, width: 1280, height: 1920 }
    expect(zoomPlace(place, { scale: 1, dx: 0 }, canvas.w, canvas.h)).toBe(place)
  })
  it('a zoomed frame is bigger and still covers the canvas', () => {
    const place = { x: -100, y: 0, width: 1280, height: 1920 }
    const z = zoomPlace(place, { scale: 1.2, dx: 0 }, canvas.w, canvas.h)
    expect(z.width).toBeCloseTo(1280 * 1.2)
    expect(z.x).toBeLessThanOrEqual(0)
    expect(z.x + z.width).toBeGreaterThanOrEqual(canvas.w)
    expect(z.y).toBeLessThanOrEqual(0)
    expect(z.y + z.height).toBeGreaterThanOrEqual(canvas.h)
  })
})
