import { afterEach, describe, expect, it, vi } from 'vitest'

import { edgeScroll } from './CutsEditor'

describe('edgeScroll', () => {
  afterEach(() => vi.restoreAllMocks())

  const stripAt = (scrollWidth: number) => {
    const el = document.createElement('div')
    let left = 0
    Object.defineProperty(el, 'scrollLeft', { get: () => left, set: (v: number) => (left = Math.max(0, Math.min(scrollWidth - 400, v))) })
    el.getBoundingClientRect = () => ({ left: 0, right: 400, width: 400, top: 0, bottom: 50, height: 50, x: 0, y: 0, toJSON: () => ({}) })
    return el
  }

  it('scrolls on while the finger is held at the right edge, and says how far', () => {
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => frames.push(cb))
    const strip = stripAt(2000)
    const onScrolled = vi.fn()
    const auto = edgeScroll(strip, onScrolled)
    auto.at(395)
    for (let i = 0; i < 10 && frames.length; i++) frames.shift()!(0)
    expect(strip.scrollLeft).toBeGreaterThan(100)
    expect(auto.extra()).toBe(strip.scrollLeft)
    expect(onScrolled).toHaveBeenCalled()
    auto.stop()
  })

  it('does nothing with the finger in the middle, and stops at the end', () => {
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => frames.push(cb))
    const strip = stripAt(400)
    const auto = edgeScroll(strip, () => {})
    auto.at(200)
    while (frames.length) frames.shift()!(0)
    auto.at(399)
    while (frames.length) frames.shift()!(0)
    expect(strip.scrollLeft).toBe(0)
  })
})
