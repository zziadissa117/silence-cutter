// The headline's look - White box, Outline or Snapchat - picked right where
// the headline is written: under each video's headline, and for a batch.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Job } from './jobs'
import { JobRow } from './JobRow'
import { withHeadlineStyle, type Angle, type Campaign } from './look'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const angle = { id: 'a1', name: 'Main', headline: { style: 'box', text: '' } } as unknown as Angle
const campaign = { id: 'inflow', name: 'Inflow', angles: [angle] } as unknown as Campaign

describe('a headline look in place of the angle\'s', () => {
  it('changes only the headline, and leaves the angle as it is when none was picked', () => {
    expect(withHeadlineStyle(angle, undefined)).toBe(angle)
    expect(withHeadlineStyle(angle, 'box')).toBe(angle)
    const snap = withHeadlineStyle(angle, 'snap')
    expect(snap.headline.style).toBe('snap')
    expect(snap.name).toBe('Main')
    expect(angle.headline.style).toBe('box')
  })
})

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

const sorted = (day: Record<string, unknown> = {}) =>
  ({
    id: 'j1',
    name: 'take.mov',
    campaignId: 'inflow',
    angleId: 'a1',
    label: 'Inflow',
    headlineText: 'wait for it',
    status: 'sorted',
    phase: 'cutting',
    progress: 0,
    day: { plan: { keep: [], words: [], checks: [] }, ...day },
  }) as unknown as Job

async function show(job: Job) {
  const onHeadlineStyle = vi.fn()
  await act(async () =>
    root.render(
      <ul>
        <JobRow
          job={job}
          label="Inflow"
          campaigns={[campaign]}
          onApprove={() => {}}
          onMusic={() => {}}
          onNoEffects={() => {}}
          pictures={[]}
          onSkipPicture={() => {}}
          onChoose={() => {}}
          onHeadline={() => {}}
          onHeadlineDone={() => {}}
          onHeadlineStyle={onHeadlineStyle}
          onRetry={() => {}}
          onRemove={() => {}}
        />
      </ul>,
    ),
  )
  const open = host.querySelector('.vrow-open') as HTMLButtonElement
  if (open.getAttribute('aria-expanded') === 'false') await act(async () => open.click())
  return onHeadlineStyle
}

const picked = () => host.querySelector('[aria-label="Headline style"] [aria-checked="true"]')?.textContent

describe("a video's headline look", () => {
  it("sits right under its headline, starting as the angle's", async () => {
    const onHeadlineStyle = await show(sorted())
    expect(picked()).toBe('White box')
    const snap = [...host.querySelectorAll('[aria-label="Headline style"] button')].find((b) => b.textContent === 'Snapchat') as HTMLButtonElement
    await act(async () => snap.click())
    expect(onHeadlineStyle).toHaveBeenCalledWith('snap')
  })

  it('shows the one picked for this video', async () => {
    await show(sorted({ headlineStyle: 'snap' }))
    expect(picked()).toBe('Snapchat')
  })
})
