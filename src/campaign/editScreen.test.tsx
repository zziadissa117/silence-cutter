// The one edit screen: the cuts and the captions of a video on the same page.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { EditScreen } from './EditScreen'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLElement
let root: Root

beforeEach(() => {
  vi.useFakeTimers()
  window.scrollTo = vi.fn() as never
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
})

const words = [
  { text: 'This', start: 0.5, end: 0.8 },
  { text: 'app', start: 0.9, end: 1.2 },
  { text: 'rocks.', start: 1.3, end: 1.7 },
  { text: 'Link', start: 6, end: 6.3 },
  { text: 'in', start: 6.4, end: 6.5 },
  { text: 'bio.', start: 6.6, end: 7 },
]

function show(fields: { onKeep?: () => void; onChange?: () => void; onFinish?: () => void } = {}) {
  act(() =>
    root.render(
      <EditScreen
        id="job1"
        name="take.mov"
        file={null}
        cuts={{ duration: 10, initial: [{ start: 0, end: 4 }, { start: 5, end: 10 }], words }}
        shown={words}
        review={{ approveLabel: 'Approve' }}
        onKeep={fields.onKeep ?? (() => {})}
        onChange={fields.onChange ?? (() => {})}
        onFinish={fields.onFinish ?? (() => {})}
      />,
    ),
  )
}

const button = (text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)

describe('the edit screen', () => {
  it('has the cuts and the captions on one page', () => {
    show()
    expect(button('Split')).toBeTruthy()
    expect(button('Delete')).toBeTruthy()
    const phrases = [...host.querySelectorAll<HTMLTextAreaElement>('.phrases textarea')].map((t) => t.value)
    expect(phrases).toEqual(['This app rocks.', 'Link in bio.'])
    expect(button('Approve')).toBeTruthy()
    // No second video, and no going back and forth.
    expect(button('Captions')).toBeUndefined()
    expect(button('Cuts')).toBeUndefined()
  })

  it('tells the captions to follow a change to the cuts once it settles', () => {
    const onKeep = vi.fn()
    show({ onKeep })
    act(() => button('Delete')!.click())
    expect(onKeep).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(500))
    expect(onKeep).toHaveBeenCalledWith([{ start: 5, end: 10 }], [{ start: 0, end: 4 }, { start: 5, end: 10 }])
  })

  it('approves with the cuts and the captions as he left them', () => {
    const onFinish = vi.fn()
    show({ onFinish })
    act(() => button('Delete')!.click())
    act(() => button('Approve')!.click())
    expect(onFinish).toHaveBeenCalledTimes(1)
    const [how, cuts, said] = onFinish.mock.calls[0]
    expect(how).toBe('with')
    expect(cuts.keep).toEqual([{ start: 5, end: 10 }])
    expect(said.map((w: { text: string }) => w.text)).toEqual(words.map((w) => w.text))
  })
})
