// The Batch tab's two ways to stop: Stop (nothing more made, what is
// scheduled keeps posting) and, beside it, Stop and take out what is
// scheduled (his ask, 2026-11-01).

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BatchStatus } from './BatchStatus'

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

const show = (stopAll: { label: string; busy: boolean; run: () => void } | null) =>
  act(() =>
    root.render(
      <BatchStatus
        state={{ tone: 'ok' as never, title: 'Making', line: '' }}
        where="phone"
        days={[]}
        making={null}
        waiting={0}
        failed={0}
        lastReady={null}
        heardAt={null}
        freeGB={null}
        sending={null}
        stop={{ label: 'Stop', busy: false, run: vi.fn() }}
        stopAll={stopAll}
      />,
    ),
  )

const buttons = () => [...host.querySelectorAll('button')].map((b) => b.textContent)

describe('stopping a batch', () => {
  it('has Stop and, beside it, Stop and take out what is scheduled', () => {
    const run = vi.fn()
    show({ label: 'Stop and take out the 12 scheduled', busy: false, run })
    expect(buttons()).toEqual(['Stop', 'Stop and take out the 12 scheduled'])
    act(() => (host.querySelectorAll('button')[1] as HTMLButtonElement).click())
    expect(run).toHaveBeenCalledOnce()
  })

  it('shows only Stop when nothing is scheduled', () => {
    show(null)
    expect(buttons()).toEqual(['Stop'])
  })
})
