import { describe, expect, it, vi } from 'vitest'

vi.mock('../report', () => ({ report: vi.fn() }))

import { report } from '../report'
import { describeFocus, watchZoom } from './zoomWatch'

describe('the screen zooming in', () => {
  it('is reported once, with the box he was typing in', () => {
    const viewport = Object.assign(new EventTarget(), { scale: 1 })
    vi.stubGlobal('visualViewport', viewport)
    const box = document.createElement('input')
    box.setAttribute('aria-label', 'Lowest amount')
    box.style.fontSize = '13px'
    document.body.appendChild(box)
    box.focus()
    watchZoom()
    viewport.dispatchEvent(new Event('resize'))
    expect(report).not.toHaveBeenCalled()
    viewport.scale = 1.4
    viewport.dispatchEvent(new Event('resize'))
    viewport.dispatchEvent(new Event('resize'))
    expect(report).toHaveBeenCalledTimes(1)
    expect(vi.mocked(report).mock.calls[0][0].message).toBe('Screen zoomed to 1.40x on input "Lowest amount" at 13px')
    box.remove()
    vi.unstubAllGlobals()
  })

  it('says when nothing was being typed in', () => {
    expect(describeFocus(document.body)).toBe('nothing focused (a pinch?)')
  })
})
