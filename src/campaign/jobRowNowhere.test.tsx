import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Job } from './jobs'
import { JobRow } from './JobRow'
import { EDIT_WINDOW_MS, UNSENT_KEEP_MS, keptFor } from './store'

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

const done = {
  id: 'j1',
  name: 'take.mov',
  campaignId: 'general',
  angleId: 'g',
  label: 'General',
  headlineText: '',
  status: 'done',
  phase: 'cutting',
  progress: 1,
  result: { blob: new Blob(), storedAs: null, originalDurationSec: 20, newDurationSec: 15, cuts: 3, logoAt: [], picturesAt: [], headline: '', notHeard: [] },
} as unknown as Job

function show(fields: { onEditAgain?: () => void; sendTo?: { campaigns: { id: string; name: string }[]; onSend: (id: string) => void } }) {
  act(() =>
    root.render(
      <ul>
        <JobRow
          job={done}
          label="General"
          campaigns={[]}
          onApprove={() => {}}
          onMusic={() => {}}
          pictures={[]}
          onSkipPicture={() => {}}
          onChoose={() => {}}
          onHeadline={() => {}}
          onHeadlineDone={() => {}}
          onRetry={() => {}}
          onRemove={() => {}}
          {...fields}
        />
      </ul>,
    ),
  )
  const open = host.querySelector('.vrow-open') as HTMLButtonElement
  if (open.getAttribute('aria-expanded') === 'false') act(() => open.click())
}

describe('a made video that went nowhere', () => {
  it('can be edited again to pick its campaign', () => {
    const onEditAgain = vi.fn()
    show({ onEditAgain })
    const button = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Edit again and pick its campaign')!
    act(() => button.click())
    expect(onEditAgain).toHaveBeenCalled()
  })

  it('can be sent as it is to a campaign that posts', () => {
    const onSend = vi.fn()
    show({ sendTo: { campaigns: [{ id: 'inflow', name: 'Inflow' }], onSend } })
    const select = host.querySelector('[aria-label="Send it as it is to a campaign"]') as HTMLSelectElement
    expect([...select.options].map((o) => o.textContent)).toEqual(['Pick a campaign…', 'Inflow'])
    act(() => {
      select.value = 'inflow'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(onSend).toHaveBeenCalledWith('inflow')
  })

  it('says nothing of it for a video that was sent', () => {
    show({})
    expect(host.textContent).not.toContain('Not sent anywhere')
  })

  it('is kept a week, not two hours, so it can still be given a campaign', () => {
    expect(keptFor({ unsent: true })).toBe(UNSENT_KEEP_MS)
    expect(keptFor({})).toBe(EDIT_WINDOW_MS)
    expect(UNSENT_KEEP_MS).toBe(7 * 24 * 60 * 60 * 1000)
  })
})
