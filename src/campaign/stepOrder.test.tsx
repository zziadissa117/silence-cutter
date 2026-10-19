// Set order: each step's name is written over its clip - as many words as
// he wants.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { StepOrder } from './StepOrder'

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

describe("a step's name", () => {
  it('takes as many words as he types, on one line of words', async () => {
    const onSave = vi.fn()
    await act(async () => root.render(<StepOrder campaignName="Lovable" steps={[{ id: 's1', name: 'Step 1', files: [] }]} onSave={onSave} onClose={() => {}} />))
    const box = host.querySelector('[aria-label="Step 1 name"]') as HTMLTextAreaElement
    expect(box.maxLength).toBe(-1)
    const long = 'NOW DRAW SOMETHING ON THE CANVAS AND WATCH IT TURN INTO A REAL WEBSITE IN UNDER A MINUTE'
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    await act(async () => {
      // A new line typed in the middle is a space on the video.
      set.call(box, long.replace(' WATCH', '\nWATCH'))
      box.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => ([...host.querySelectorAll('button')].find((b) => b.textContent === 'Save order') as HTMLButtonElement).click())
    expect(onSave.mock.calls[0][0][0].name).toBe(long)
  })
})
