// The Formats tab: a campaign's formats, takes in and videos out, saved for
// the brand and scheduled over the week.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { PendingJob } from './store'

let held: PendingJob[] = []

vi.mock('./store', async (original) => {
  const real = await original<Record<string, unknown>>()
  const stubs = Object.fromEntries(Object.keys(real).map((key) => [key, typeof real[key] === 'function' ? vi.fn(async () => undefined) : real[key]]))
  return { ...stubs, heldVideos: vi.fn(async () => held), loadHeldVideo: vi.fn(async () => new Blob(['mp4'], { type: 'video/mp4' })) }
})

import { FormatsView } from './FormatsView'
import type { Job } from './jobs'
import type { Angle, Campaign } from './look'
import type { Profile } from './posting'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const routine = { id: 'f1', name: 'Morning routine', isFormat: true } as unknown as Angle
const general = { id: 'g', name: 'General', general: true } as unknown as Angle
const vertus = { id: 'vertus', name: 'Vertus', angles: [general, routine] } as unknown as Campaign
const profile = {
  id: 'p1',
  accounts: [{ id: 'tt', name: 'vertus', platform: 'tiktok', profile: 'vertus', picture: '', disabled: false }],
  settings: { campaigns: { vertus: { accounts: ['tt'], times: ['12:00', '18:00'] } } },
} as unknown as Profile

const keptVideo = (id: string): PendingJob =>
  ({ id, fileName: `${id}.mov`, campaignId: 'vertus', angleId: 'f1', forFormat: 'f1', madeAt: 1, held: { transcript: 'hi', headline: 'h', duration: 31, size: 10 } }) as unknown as PendingJob

let host: HTMLElement
let root: Root

beforeEach(() => {
  localStorage.clear()
  held = []
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const button = (text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(text)) as HTMLButtonElement

async function show(jobs: Job[] = []) {
  const props = {
    onNewFormat: vi.fn(),
    onEditFormat: vi.fn(),
    onAddTakes: vi.fn(),
    onSchedule: vi.fn(async () => '2 scheduled: Mon, Tue'),
    onRemove: vi.fn(),
    onRetry: vi.fn(),
  }
  await act(async () =>
    root.render(<FormatsView campaigns={[vertus]} profile={profile} jobs={jobs} heldVersion={0} clipsOf={() => ({ before: 'intro', middle: 0 })} {...props} />),
  )
  await act(async () => {})
  return props
}

describe('the Formats tab', () => {
  it("lists a campaign's formats with what each has", async () => {
    held = [keptVideo('a'), keptVideo('b')]
    const making = { id: 'm', name: 'm.mov', forFormat: 'f1', status: 'working', phase: 'cutting', progress: 0.5 } as unknown as Job
    await show([making])
    expect(host.textContent).toContain('Morning routine')
    expect(host.textContent).toContain('2 ready · 1 making')
    // The General angle is not a format.
    expect(host.textContent).not.toContain('General')
  })

  it('makes a new format under the name he types', async () => {
    const props = await show()
    await act(async () => button('+ New format').click())
    const input = host.querySelector('input[type="text"]') as HTMLInputElement
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
      set.call(input, 'Day in the life')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => button('Create').click())
    expect(props.onNewFormat).toHaveBeenCalledWith(vertus, 'Day in the life')
  })

  it('shows a format: its joined clips, takes being made and videos ready', async () => {
    held = [keptVideo('a'), keptVideo('b')]
    const failed = { id: 'x', name: 'x.mov', forFormat: 'f1', status: 'failed', phase: 'cutting', progress: 0, error: 'No sound.' } as unknown as Job
    const props = await show([failed])
    await act(async () => button('Morning routine').click())
    expect(host.textContent).toContain('joined on every take: intro before')
    expect(host.textContent).toContain('Ready · 2')
    expect(host.textContent).toContain('0:31')
    expect(host.textContent).toContain('No sound.')
    await act(async () => button('Try again').click())
    expect(props.onRetry).toHaveBeenCalledWith('x')
    await act(async () => button('Look & clips').click())
    expect(props.onEditFormat).toHaveBeenCalledWith(vertus, routine)
  })

  it('schedules every ready video for the week, or the next 5 days, and says how it went', async () => {
    held = [keptVideo('a'), keptVideo('b')]
    const props = await show()
    await act(async () => button('Morning routine').click())
    expect(host.textContent).toContain('The week:')
    await act(async () => button('Schedule for the week').click())
    expect(props.onSchedule).toHaveBeenCalledWith(vertus, routine, ['a', 'b'], 7)
    expect(host.textContent).toContain('2 scheduled: Mon, Tue')
    await act(async () => button('Next 5 days').click())
    expect(props.onSchedule).toHaveBeenLastCalledWith(vertus, routine, ['a', 'b'], 5)
  })

  it('says to pick the accounts before it can schedule', async () => {
    held = [{ ...keptVideo('a'), campaignId: 'lonely' } as PendingJob]
    const lonely = { ...vertus, id: 'lonely' } as Campaign
    await act(async () =>
      root.render(
        <FormatsView
          campaigns={[lonely]}
          profile={profile}
          jobs={[]}
          heldVersion={0}
          clipsOf={() => ({ middle: 0 })}
          onNewFormat={vi.fn()}
          onEditFormat={vi.fn()}
          onAddTakes={vi.fn()}
          onSchedule={vi.fn(async () => '')}
          onRemove={vi.fn()}
          onRetry={vi.fn()}
        />,
      ),
    )
    await act(async () => {})
    await act(async () => button('Morning routine').click())
    expect(host.textContent).toContain("Pick Vertus's accounts first")
  })
})
