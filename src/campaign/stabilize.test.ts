import { describe, expect, it } from 'vitest'

import { MAX_ZOOM, motionBetween, shiftBetween, steadyPath, type Grey } from './stabilize'

/** A random texture (the same every run), smooth enough to be like a real
 * picture, looked up between its points. */
const NOISE_W = 64
const noise = (() => {
  let seed = 7
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  return Float32Array.from({ length: NOISE_W * NOISE_W }, () => rand() * 255)
})()
function texture(x: number, y: number): number {
  const u = ((x / 6) % NOISE_W + NOISE_W) % NOISE_W
  const v = ((y / 6) % NOISE_W + NOISE_W) % NOISE_W
  const x0 = Math.floor(u)
  const y0 = Math.floor(v)
  const fx = u - x0
  const fy = v - y0
  const at = (i: number, j: number) => noise[((j % NOISE_W) * NOISE_W) + (i % NOISE_W)]
  return at(x0, y0) * (1 - fx) * (1 - fy) + at(x0 + 1, y0) * fx * (1 - fy) + at(x0, y0 + 1) * (1 - fx) * fy + at(x0 + 1, y0 + 1) * fx * fy
}

/** The texture, moved by (dx, dy) small pixels and turned by `angle`. */
function picture(dx = 0, dy = 0, angle = 0, width = 144, height = 256): Grey {
  const data = new Float32Array(width * height)
  const cx = width / 2
  const cy = height / 2
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const rx = x - dx - cx
      const ry = y - dy - cy
      const ox = Math.cos(-angle) * rx - Math.sin(-angle) * ry + cx
      const oy = Math.sin(-angle) * rx + Math.cos(-angle) * ry + cy
      data[y * width + x] = texture(ox + 50, oy + 50)
    }
  return { data, width, height }
}

describe('steadying a shaky take', () => {
  it('finds how far the picture moved, to a part of a pixel', () => {
    const moved = shiftBetween(picture(), picture(5, -3))
    expect(moved.dx).toBeCloseTo(5, 0)
    expect(moved.dy).toBeCloseTo(-3, 0)
    expect(Math.abs(shiftBetween(picture(), picture(2.5, 0)).dx - 2.5)).toBeLessThan(0.35)
  })

  it('tells the phone tilting from it moving, on the edges', () => {
    const tilt = motionBetween(picture(), picture(0, 0, 0.02))
    expect(tilt.angle).toBeGreaterThan(0.01)
    expect(Math.abs(tilt.x)).toBeLessThan(0.01)
    const slide = motionBetween(picture(), picture(6, 0))
    expect(slide.x).toBeCloseTo(6 / 144, 2)
    expect(Math.abs(slide.angle)).toBeLessThan(0.005)
  })

  it('takes out the jitter, keeps a slow pan, and zooms only as much as it needs', () => {
    // A slow pan to the right with a hard shake on top.
    const moves = Array.from({ length: 90 }, (_, i) => ({ x: (i === 0 ? 0 : 0.002) + (i % 2 ? 0.02 : -0.02), y: i % 3 ? 0.01 : -0.02, angle: 0 }))
    const plan = steadyPath(moves, 30)!
    expect(plan).not.toBeNull()
    expect(plan.zoom).toBeGreaterThan(1)
    expect(plan.zoom).toBeLessThanOrEqual(MAX_ZOOM)
    // Path after correction: smooth - each step close to the pan.
    let x = 0
    const steps: number[] = []
    for (let i = 1; i < moves.length; i++) {
      const before = x + moves[i].x + plan.corrections[i].x - plan.corrections[i - 1].x
      steps.push(before - x)
      x = before - (plan.corrections[i].x - plan.corrections[i - 1].x) - moves[i].x + moves[i].x
    }
    const jitterBefore = moves.slice(1).reduce((s, m) => s + Math.abs(m.x - 0.002), 0) / 89
    const jitterAfter = moves.slice(1).reduce((s, m, k) => s + Math.abs(m.x + plan.corrections[k + 1].x - plan.corrections[k].x - 0.002), 0) / 89
    expect(jitterAfter).toBeLessThan(jitterBefore / 3)
  })

  it('leaves a steady take alone', () => {
    expect(steadyPath(Array.from({ length: 60 }, () => ({ x: 0.0002, y: 0, angle: 0 })), 30)).toBeNull()
  })
})
