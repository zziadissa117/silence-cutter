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

function show(fields: { onKeep?: () => void; onChange?: () => void; onFinish?: () => void; review?: Record<string, unknown> } = {}) {
  act(() =>
    root.render(
      <EditScreen
        id="job1"
        name="take.mov"
        file={null}
        cuts={{ duration: 10, initial: [{ start: 0, end: 4 }, { start: 5, end: 10 }], words }}
        shown={words}
        review={{ approveLabel: 'Approve', ...fields.review }}
        onKeep={fields.onKeep ?? (() => {})}
        onChange={fields.onChange ?? (() => {})}
        onFinish={fields.onFinish ?? (() => {})}
      />,
    ),
  )
}

const button = (text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)

describe('the edit screen', () => {
  it('has the cuts and the captions on one page, in the timeline editor', () => {
    show()
    act(() => button('Timeline editor')!.click())
    expect(host.querySelector('.cuts.quick')).toBeNull()
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

describe('the quick check', () => {
  const recheck = vi.fn(async (phrases: string[]) => ({ phrases: phrases.map((p) => (p === 'Link in bio.' ? 'Link in my bio.' : p)), changed: [1], costCents: 1 }))

  beforeEach(() => {
    localStorage.clear()
    recheck.mockClear()
  })

  it('opens on the video and the phrases Claude changed, one card at a time', async () => {
    show({ review: { onRecheck: recheck, recheckKey: 'job1' } })
    expect(host.querySelector('.cuts.quick')).not.toBeNull()
    expect(host.querySelector('.phrases')).toBeNull()
    await act(async () => {})
    expect(recheck).toHaveBeenCalledTimes(1)
    expect(host.textContent).toContain('1 of 1 to look at')
    expect(host.querySelector('.quick-text')?.textContent).toBe('Link in my bio.')
    expect(host.textContent).toContain('Claude changed it from Link in bio.')
    act(() => button('Good')!.click())
    expect(host.textContent).toContain('All 1 checked')
  })

  it("Undo change puts back what was heard, and Approve takes it as it is", async () => {
    const onFinish = vi.fn()
    show({ onFinish, review: { onRecheck: recheck, recheckKey: 'job1' } })
    await act(async () => {})
    act(() => button('Undo change')!.click())
    act(() => button('Approve')!.click())
    const said = onFinish.mock.calls[0][2] as { text: string }[]
    expect(onFinish.mock.calls[0][0]).toBe('with')
    expect(said.map((w) => w.text).join(' ')).toBe('This app rocks. Link in bio.')
  })

  it('Fix opens a box for that one phrase only', async () => {
    const onChange = vi.fn()
    show({ onChange, review: { onRecheck: recheck, recheckKey: 'job1' } })
    await act(async () => {})
    act(() => button('Fix')!.click())
    const box = host.querySelector<HTMLInputElement>('input.quick-fix')!
    expect(box.value).toBe('Link in my bio.')
    expect(host.querySelectorAll('textarea')).toHaveLength(0)
  })

  it('says so when nothing needs a look', async () => {
    const none = vi.fn(async (phrases: string[]) => ({ phrases, changed: [], costCents: 0 }))
    show({ review: { onRecheck: none, recheckKey: 'job1' } })
    await act(async () => {})
    expect(host.textContent).toContain('Every caption looks right')
  })
})

describe('the quick check after Claude', () => {
  beforeEach(() => localStorage.clear())

  it("shows what Claude wasn't sure of, and not the cutter's unsure moments Claude already read", async () => {
    const unsure = vi.fn(async (phrases: string[]) => ({ phrases, changed: [], unsure: [0], costCents: 1 }))
    // A sound the cutter was unsure about, right on "Link in bio."
    show({ review: { onRecheck: unsure, recheckKey: 'job2', riskSpans: [{ start: 6.1, end: 6.2 }] } })
    await act(async () => {})
    expect(host.textContent).toContain('1 of 1 to look at')
    expect(host.querySelector('.quick-text')?.textContent).toBe('This app rocks.')
  })
})

describe('the timeline editor', () => {
  const arrow = (name: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!

  it('undoes and redoes with the arrows at the top', () => {
    const onKeep = vi.fn()
    show({ onKeep })
    act(() => button('Timeline editor')!.click())
    expect(arrow('Undo').disabled).toBe(true)
    act(() => button('Delete')!.click())
    expect(arrow('Undo').disabled).toBe(false)
    act(() => arrow('Undo').click())
    act(() => vi.advanceTimersByTime(500))
    expect(arrow('Redo').disabled).toBe(false)
    act(() => arrow('Redo').click())
    act(() => vi.advanceTimersByTime(500))
    expect(onKeep).toHaveBeenLastCalledWith([{ start: 5, end: 10 }], expect.anything())
    expect(arrow('Redo').disabled).toBe(true)
  })

  it('has no zoom buttons - the timeline is pinched', () => {
    show()
    act(() => button('Timeline editor')!.click())
    expect(arrow('Zoom in')).toBeNull()
    expect(host.textContent).toContain('Pinch the timeline to zoom')
  })

  it('opens full screen from the top', () => {
    show()
    act(() => arrow('Full screen').click())
    expect(host.querySelector('.cuts.full')).not.toBeNull()
    act(() => arrow('Close full screen').click())
    expect(host.querySelector('.cuts.full')).toBeNull()
  })
})
