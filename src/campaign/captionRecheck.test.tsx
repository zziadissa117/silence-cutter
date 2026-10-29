// Claude checks a video's captions by itself the first time they open, and
// what he types meanwhile stays his.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CaptionReview } from './CaptionReview'
import type { RecheckResult } from './posting'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLElement
let root: Root

beforeEach(() => {
  localStorage.clear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const words = [
  { text: 'I', start: 1, end: 1.1 },
  { text: 'use', start: 1.2, end: 1.4 },
  { text: 'virtues.', start: 1.5, end: 2 },
  { text: 'Go', start: 3, end: 3.2 },
  { text: 'by', start: 3.3, end: 3.5 },
  { text: 'it.', start: 3.6, end: 4 },
]

async function show(onRecheck: (phrases: string[]) => Promise<RecheckResult>) {
  await act(async () =>
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
        onRecheck={onRecheck}
        recheckKey="job-1"
      />,
    ),
  )
}

const boxes = () => [...host.querySelectorAll('textarea')] as HTMLTextAreaElement[]

describe("Claude's check of the captions", () => {
  it('runs by itself when they open, once a video', async () => {
    const onRecheck = vi.fn(async (phrases: string[]) => ({ phrases: phrases.map((p) => p.replace('virtues', 'Vertus').replace('by', 'buy')), changed: [0, 1], costCents: 1 }))
    await show(onRecheck)
    expect(onRecheck).toHaveBeenCalledTimes(1)
    expect(boxes().map((b) => b.value).join(' ')).toContain('Vertus')
    expect(host.textContent).toContain('Claude fixed')
    act(() => root.unmount())
    root = createRoot(host)
    await show(onRecheck)
    expect(onRecheck).toHaveBeenCalledTimes(1)
    expect(host.textContent).toContain('Check again with Claude')
  })

  it('leaves a phrase he typed into while it checked', async () => {
    let answer: (r: RecheckResult) => void = () => {}
    const onRecheck = vi.fn((phrases: string[]) => new Promise<RecheckResult>((resolve) => (answer = () => resolve({ phrases: phrases.map((p) => p.toUpperCase()), changed: phrases.map((_, i) => i), costCents: 1 }))))
    await show(onRecheck)
    const first = boxes()[0]
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(first, 'I use Vertus.')
      first.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => answer({} as RecheckResult))
    expect(boxes()[0].value).toBe('I use Vertus.')
    expect(boxes().slice(1).some((b) => b.value === b.value.toUpperCase() && /[A-Z]/.test(b.value))).toBe(true)
  })
})
