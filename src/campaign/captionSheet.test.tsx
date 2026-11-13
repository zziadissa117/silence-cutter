// The captions' phrases in a sheet over the screen (his ask, 2026-11-13):
// see-through, half or three quarters of the screen, closed and opened, kept
// as he leaves it, and on the keyboard while he types.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CaptionReview } from './CaptionReview'
import { CaptionSheet } from './CaptionSheet'

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
  { text: 'This', start: 1, end: 1.2 },
  { text: 'app', start: 1.3, end: 1.5 },
  { text: 'rocks.', start: 1.6, end: 2 },
  { text: 'Link', start: 3, end: 3.2 },
  { text: 'in', start: 3.3, end: 3.4 },
  { text: 'bio.', start: 3.5, end: 3.8 },
]

const review = () =>
  act(async () =>
    root.render(
      <CaptionReview name="take.mov" file={null} initial={words} approveLabel="Approve" onChange={() => {}} onApprove={() => {}} onSkip={() => {}} onClose={() => {}} />,
    ),
  )
const sheet = () => document.querySelector('.caption-sheet') as HTMLElement | null

describe("the captions' sheet", () => {
  it('opens on a caption check over the screen, closes, and stays as he left it', async () => {
    await review()
    // Over the whole screen (on the page's body), not in the page's flow.
    expect(sheet()?.parentElement).toBe(document.body)
    expect([...sheet()!.querySelectorAll('textarea')].map((t) => t.value)).toEqual(['This app rocks.', 'Link in bio.'])
    expect(host.querySelector('.caption-sheet-open')?.textContent).toContain('2 phrases')
    await act(async () => (sheet()!.querySelector('[aria-label="Close the captions"]') as HTMLButtonElement).click())
    expect(sheet()).toBeNull()
    // The approve and the look are the page's, the screen his.
    expect([...host.querySelectorAll('button')].some((b) => b.textContent === 'Approve')).toBe(true)
    act(() => root.unmount())
    root = createRoot(host)
    await review()
    expect(sheet()).toBeNull()
    await act(async () => (host.querySelector('.caption-sheet-open') as HTMLButtonElement).click())
    expect(sheet()).toBeTruthy()
  })

  it('half the screen or three quarters, from its grip - kept for next time', async () => {
    await act(async () => root.render(<CaptionSheet open title="Captions" onClose={() => {}}>phrases</CaptionSheet>))
    expect(sheet()?.classList.contains('tall')).toBe(false)
    await act(async () => (sheet()!.querySelector('.caption-sheet-grip') as HTMLButtonElement).click())
    expect(sheet()?.classList.contains('tall')).toBe(true)
    expect(localStorage.getItem('captions.sheetTall')).toBe('true')
  })

  it('sits on the keyboard while he types', async () => {
    const listeners: (() => void)[] = []
    const vv = { height: 844, offsetTop: 0, addEventListener: (_: string, f: () => void) => listeners.push(f), removeEventListener: () => {} }
    vi.stubGlobal('visualViewport', vv)
    Object.defineProperty(window, 'innerHeight', { value: 844, configurable: true })
    await act(async () => root.render(<CaptionSheet open title="Captions" onClose={() => {}}>phrases</CaptionSheet>))
    expect(sheet()!.style.bottom).toBe('')
    // The keyboard comes up: 336 px of the screen left above it.
    vv.height = 508
    await act(async () => listeners.forEach((f) => f()))
    expect(sheet()!.style.bottom).toBe('336px')
    expect(parseFloat(sheet()!.style.height)).toBeLessThanOrEqual(508 - 64)
    vi.unstubAllGlobals()
  })
})
