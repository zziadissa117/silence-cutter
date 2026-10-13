import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CaptionReview, type PopReview } from './CaptionReview'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const words = [
  { text: 'Use', start: 1, end: 1.2 },
  { text: 'Claude', start: 1.3, end: 1.6 },
  { text: 'Code.', start: 1.7, end: 2 },
]

function show(pops?: PopReview) {
  act(() =>
    root.render(
      <CaptionReview
        name="take.mov"
        file={null}
        initial={words}
        approveLabel="Approve"
        onChange={() => {}}
        onApprove={() => {}}
        onSkip={() => {}}
        onClose={() => {}}
        pops={pops}
      />,
    ),
  )
}

const pops = (fields: Partial<PopReview> = {}): PopReview => ({
  items: [{ id: 'v1', name: 'Claude demo', at: [1.2], seconds: 4, width: 1920, height: 1080, loadStill: async () => null }],
  size: 65,
  position: 'middle',
  skipped: [],
  onSize: vi.fn(),
  onPosition: vi.fn(),
  onSkip: vi.fn(),
  ...fields,
})

describe('pop-up videos on the caption check', () => {
  it('says nothing about them when the take says none', () => {
    show()
    expect(host.textContent).not.toContain('Pop-up videos')
  })

  it('lists each one said, with when, and how big and where they sit', () => {
    show(pops())
    expect(host.textContent).toContain('Pop-up videos')
    expect(host.textContent).toContain('Claude demo')
    expect(host.textContent).toContain('65%')
    const middle = host.querySelector('[aria-label="Where the pop-up videos sit"] [aria-checked="true"]')
    expect(middle?.textContent).toBe('Middle')
  })

  it('changes the size and the place, and leaves one out', () => {
    const p = pops()
    show(p)
    const slider = host.querySelector('[aria-label="How big the pop-up videos are"]') as HTMLInputElement
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(slider, '72')
      slider.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(p.onSize).toHaveBeenCalledWith(72)
    const top = [...host.querySelectorAll('[aria-label="Where the pop-up videos sit"] button')].find((b) => b.textContent === 'Top') as HTMLButtonElement
    act(() => top.click())
    expect(p.onPosition).toHaveBeenCalledWith('top')
    const tick = host.querySelector('.pop-row input[type="checkbox"]') as HTMLInputElement
    expect(tick.checked).toBe(true)
    act(() => tick.click())
    expect(p.onSkip).toHaveBeenCalledWith('v1', true)
  })
})
