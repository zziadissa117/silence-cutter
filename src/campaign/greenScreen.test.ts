import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { mixFrom, pickBatch, type BatchBank } from './batch'
import { MEDIAPIPE_VERSION, greyToAlpha, maskPixels } from './cutout'
import { cornerBox } from './greenScreenRender'

describe('his corner', () => {
  it('sits on the bottom edge, at his own 9:16 shape', () => {
    expect(cornerBox(1080, 1920, { side: 'right', sizePct: 40 })).toEqual({ x: 648, y: 1152, width: 432, height: 768 })
    expect(cornerBox(1080, 1920, { side: 'left', sizePct: 40 }).x).toBe(0)
  })
  it('stays between a quarter and half the width', () => {
    expect(cornerBox(1080, 1920, { side: 'left', sizePct: 90 }).width).toBe(540)
    expect(cornerBox(1080, 1920, { side: 'left', sizePct: 5 }).width).toBe(270)
  })
})

describe('the cut-out mask', () => {
  it('is solid where the model is sure, gone where it is not, soft at his edge', () => {
    const out = new Uint8ClampedArray(12)
    maskPixels(new Float32Array([0.9, 0.1, 0.5]), null, out)
    expect(out[0]).toBe(255)
    expect(out[4]).toBe(0)
    expect(out[8]).toBeGreaterThan(60)
    expect(out[8]).toBeLessThan(200)
    expect(out[3]).toBe(255)
  })
  it('is steadied with the last frame, so his edge does not flicker', () => {
    const last = new Float32Array([1])
    const out = new Uint8ClampedArray(4)
    maskPixels(new Float32Array([0]), last, out)
    expect(last[0]).toBeCloseTo(0.35)
  })
  it('turns back into see-through from its grey', () => {
    const pixels = new Uint8ClampedArray([200, 200, 200, 255, 0, 0, 0, 255])
    greyToAlpha(pixels)
    expect(pixels[3]).toBe(200)
    expect(pixels[7]).toBe(0)
  })
})

describe('a green screen batch', () => {
  const bank = (fields: Partial<BatchBank> = {}): BatchBank => ({
    campaignId: 'c',
    angleId: 'a',
    reactions: [{ id: 'r1', name: 'r1', type: 'video/mp4', size: 1 }],
    products: [{ id: 'b1', name: 'b1', type: 'video/mp4', size: 1 }, { id: 'b2', name: 'b2', type: 'video/mp4', size: 1 }],
    headlines: [],
    music: [{ id: 'm1', name: 'm1', type: 'audio/mpeg', size: 1 }],
    perDay: 3,
    days: 7,
    used: {},
    layout: 'greenscreen',
    ...fields,
  })
  it('needs no headline and uses no music', () => {
    const { picks } = pickBatch(mixFrom(bank(), []), 2)
    expect(picks).toHaveLength(2)
    expect(picks.every((p) => p.headline === '' && p.music === null)).toBe(true)
    expect(new Set(picks.map((p) => p.product))).toEqual(new Set(['b1', 'b2']))
  })
  it('leaves the usual layout as it was', () => {
    expect(mixFrom(bank({ layout: undefined }), []).music).toHaveLength(1)
  })
})

describe('the cut-out engine', () => {
  it('is fetched for the version that is installed', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { dependencies: Record<string, string> }
    expect(pkg.dependencies['@mediapipe/tasks-vision']).toBe(MEDIAPIPE_VERSION)
  })
})
