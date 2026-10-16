import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const reported = vi.fn()
vi.mock('./report', () => ({ report: (r: unknown) => reported(r) }))

import { pickArrived, pickStarted, pickSaved, whenPickGoesWrong } from './pickWatch'

const said: (string | null)[] = []

beforeEach(() => {
  vi.useFakeTimers()
  said.length = 0
  reported.mockClear()
  whenPickGoesWrong((m) => said.push(m))
})

afterEach(() => {
  pickSaved()
  vi.useRealTimers()
})

/** Opens the picker, then comes back to the page as it closes. */
function pickAndClose() {
  pickStarted()
  vi.advanceTimersByTime(2_000)
  window.dispatchEvent(new Event('focus'))
}

describe('a pick the iPhone is slow to hand over', () => {
  it('says it is still preparing first, and only gives up after two minutes', () => {
    pickAndClose()
    vi.advanceTimersByTime(16_000)
    expect(said.at(-1)).toContain('still preparing')
    expect(reported).not.toHaveBeenCalled()
    vi.advanceTimersByTime(110_000)
    expect(said.at(-1)).toContain("didn't hand the video over")
    expect(reported).toHaveBeenCalledWith(expect.objectContaining({ kind: 'empty-pick' }))
  })

  it('clears the note and says how late it was when the video does come', () => {
    pickAndClose()
    vi.advanceTimersByTime(40_000)
    expect(pickArrived([new File(['x'], 'a.mov')])).toBeNull()
    expect(said.at(-1)).toBeNull()
    expect(reported).toHaveBeenCalledWith(expect.objectContaining({ kind: 'check', phase: 'pick' }))
    vi.advanceTimersByTime(200_000)
    expect(reported).toHaveBeenCalledTimes(1)
  })
})
