// The Formats tab: a campaign's formats - a script, takes of each line in,
// mixed videos out, saved for the brand and scheduled over the month.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { FormatScript, FormatTake } from './formats'
import type { PendingJob } from './store'

let held: PendingJob[] = []
let script: FormatScript = { angleId: 'f1', lines: [], uses: {}, opened: [] }

vi.mock('./store', async (original) => {
  const real = await original<Record<string, unknown>>()
  const stubs = Object.fromEntries(Object.keys(real).map((key) => [key, typeof real[key] === 'function' ? vi.fn(async () => undefined) : real[key]]))
  return {
    ...stubs,
    heldVideos: vi.fn(async () => held),
    loadHeldVideo: vi.fn(async () => new Blob(['mp4'], { type: 'video/mp4' })),
    loadFormatScript: vi.fn(async () => script),
  }
})
vi.mock('./fingerprint', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  fingerprint: vi.fn(async (file: File) => `fp-${file.name}`),
}))
vi.mock('./filming', () => ({ filmingOf: vi.fn(async () => ({ seconds: 3 })) }))

import { saveBankFile, saveFormatScript } from './store'

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

const take = (id: string): FormatTake => ({ id, name: `${id}.mov`, type: 'video/quicktime', size: 10, fp: `fp-${id}.mov` })
const twoLines = (): FormatScript => ({
  angleId: 'f1',
  lines: [
    { id: 'l1', words: 'ELON MUST BE STOPPED', takes: [take('a0'), take('a1')] },
    { id: 'l2', words: 'Link in bio', takes: [take('b0')] },
  ],
  uses: { b0: 1 },
  opened: ['fp-old.mov'],
})

const keptVideo = (id: string): PendingJob =>
  ({ id, fileName: `${id}.mov`, campaignId: 'vertus', angleId: 'f1', forFormat: 'f1', madeAt: 1, held: { transcript: 'hi', headline: 'h', duration: 31, size: 10 } }) as unknown as PendingJob

let host: HTMLElement
let root: Root

beforeEach(() => {
  localStorage.clear()
  held = []
  script = { angleId: 'f1', lines: [], uses: {}, opened: [] }
  vi.mocked(saveFormatScript).mockClear()
  vi.mocked(saveBankFile).mockClear()
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
    onMake: vi.fn(async () => 2),
    onLetGo: vi.fn(),
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
    expect(host.textContent).toContain('joined on every video: intro before')
    expect(host.textContent).toContain('Ready · 2')
    expect(host.textContent).toContain('0:31')
    expect(host.textContent).toContain('No sound.')
    await act(async () => button('Try again').click())
    expect(props.onRetry).toHaveBeenCalledWith('x')
    await act(async () => button('Look & clips').click())
    expect(props.onEditFormat).toHaveBeenCalledWith(vertus, routine)
  })

  it('schedules every ready video over the month, the week, or the next 5 days, and says how it went', async () => {
    held = [keptVideo('a'), keptVideo('b')]
    const props = await show()
    await act(async () => button('Morning routine').click())
    expect(host.textContent).toContain('The week:')
    await act(async () => button('Over the month').click())
    expect(props.onSchedule).toHaveBeenCalledWith(vertus, routine, ['a', 'b'], 30)
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
          onMake={vi.fn(async () => 0)}
          onLetGo={vi.fn()}
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

  it("shows the script's lines and their takes, and makes a video for every opening", async () => {
    script = twoLines()
    const props = await show()
    await act(async () => button('Morning routine').click())
    expect(host.textContent).toContain('Script · 2 lines')
    expect(host.textContent).toContain('2 takes to open with · 1 made')
    expect(host.textContent).toContain('1 take')
    await act(async () => button('Make 2 videos').click())
    expect(props.onMake).toHaveBeenCalledWith(vertus, routine)
    expect(host.textContent).toContain('2 videos on the way')
  })

  it('adds a line under the words he types', async () => {
    script = twoLines()
    await show()
    await act(async () => button('Morning routine').click())
    const input = host.querySelector('input[aria-label="New line"]') as HTMLInputElement
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
      set.call(input, 'NO WAY HE DID THIS')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => button('+ Add line').click())
    const saved = vi.mocked(saveFormatScript).mock.calls.at(-1)![0]
    expect(saved.lines.map((l) => l.words)).toEqual(['ELON MUST BE STOPPED', 'Link in bio', 'NO WAY HE DID THIS'])
    // A line with no takes yet: nothing to make until it has some.
    expect(host.textContent).toContain('Add your takes of line 3, "NO WAY HE DID THIS"')
    expect(button('Make')).toBeUndefined()
  })

  it("keeps a line's takes once each, skipping a duplicate and an opening already made", async () => {
    script = twoLines()
    await show()
    await act(async () => button('Morning routine').click())
    const picker = host.querySelector('input[aria-label="Add takes of ELON MUST BE STOPPED"]') as HTMLInputElement
    const files = [new File(['x'], 'new.mov', { type: 'video/quicktime' }), new File(['x'], 'a0.mov'), new File(['x'], 'old.mov')]
    Object.defineProperty(picker, 'files', { value: files, configurable: true })
    await act(async () => picker.dispatchEvent(new Event('change', { bubbles: true })))
    await act(async () => {})
    expect(saveBankFile).toHaveBeenCalledTimes(1)
    const saved = vi.mocked(saveFormatScript).mock.calls.at(-1)![0]
    expect(saved.lines[0].takes.map((t) => t.name)).toEqual(['a0.mov', 'a1.mov', 'new.mov'])
    expect(host.textContent).toContain('a0.mov is already in this format')
    expect(host.textContent).toContain('old.mov already opened a video you made')
  })

  it("takes a take out: off the line, and off the phone once no video needs it", async () => {
    script = twoLines()
    const props = await show()
    await act(async () => button('Morning routine').click())
    await act(async () => button('1 take').click())
    expect(host.textContent).toContain('in 1 video')
    await act(async () => (host.querySelector('button[aria-label="Take out b0.mov"]') as HTMLButtonElement).click())
    expect(props.onLetGo).toHaveBeenCalledWith(['b0'])
    expect(vi.mocked(saveFormatScript).mock.calls.at(-1)![0].lines[1].takes).toEqual([])
  })
})
