// Captions asks everything about a video on one screen before its edit
// screen - where it goes, its headline and look, its music, captions on the
// hook - and its row in the list no longer carries them, nor Effects or
// Edit cuts.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CheckQuestions } from './CheckQuestions'
import type { Job } from './jobs'
import { JobRow } from './JobRow'
import type { Angle, Campaign } from './look'
import type { PictureChoice } from './skipPictures'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const angle = { id: 'a1', name: 'Main', headline: { style: 'box', text: '' } } as unknown as Angle
const other = { id: 'a2', name: 'Second', headline: { style: 'outline', text: '' } } as unknown as Angle
const campaign = { id: 'inflow', name: 'Inflow', angles: [angle, other] } as unknown as Campaign

let host: HTMLElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  localStorage.clear()
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const sorted = (id = 'j1', headlineText = 'wait for it') =>
  ({
    id,
    name: `${id}.mov`,
    campaignId: 'inflow',
    angleId: 'a1',
    label: 'Inflow',
    headlineText,
    status: 'sorted',
    phase: 'cutting',
    progress: 0,
    day: { plan: { keep: [{ start: 0, end: 4 }], duration: 5, words: [{ text: 'hi', start: 0, end: 1 }], checks: [] } },
  }) as unknown as Job

const buttons = () => [...host.querySelectorAll('button')]
const button = (text: string) => buttons().find((b) => b.textContent?.includes(text)) as HTMLButtonElement | undefined

async function ask(videos: Job[], hasHook = (job: Job) => job.headlineText.trim() !== '', pictures = (_job: Job): PictureChoice[] => []) {
  const calls = {
    onSkipPicture: vi.fn(),
    onChoose: vi.fn(),
    onHeadline: vi.fn(),
    onHeadlineDone: vi.fn(),
    onHeadlineStyle: vi.fn(),
    onMusic: vi.fn(),
    onNext: vi.fn(),
    onCancel: vi.fn(),
  }
  await act(async () => root.render(<CheckQuestions videos={videos} campaigns={[campaign]} hasHook={hasHook} pictures={pictures} {...calls} />))
  return calls
}

describe('the questions Captions asks', () => {
  it('has where it goes, the headline and its look, the music and the hook, then goes on', async () => {
    const calls = await ask([sorted()])
    expect(host.textContent).toContain('Goes to')
    expect(host.querySelector('input[type=text]')).not.toBeNull()
    expect(host.querySelector('[aria-label="Headline style"]')).not.toBeNull()
    expect(host.textContent).toContain('Music')
    expect(host.textContent).not.toContain('Effects')

    const select = host.querySelector('select') as HTMLSelectElement
    await act(async () => {
      select.value = 'inflow|a2'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(calls.onChoose).toHaveBeenCalledWith('j1', 'inflow', 'a2')

    await act(async () => button('Snapchat')!.click())
    expect(calls.onHeadlineStyle).toHaveBeenCalledWith('j1', 'snap')

    const hook = host.querySelector('.check-hook input[type=checkbox]') as HTMLInputElement
    expect(hook.checked).toBe(false)
    await act(async () => hook.click())
    await act(async () => button('Next')!.click())
    expect(calls.onNext).toHaveBeenCalledWith(true)
  })

  it('shows the pictures that come up in the video, each to keep or leave out', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:picture')
    URL.revokeObjectURL = vi.fn()
    const logo = { id: 'p1', words: 'lovable', image: new Blob(['png'], { type: 'image/png' }) }
    const calls = await ask([sorted()], undefined, () => [logo])
    expect(host.textContent).toContain('Pictures in this video')
    expect(host.textContent).toContain('lovable')
    const tick = host.querySelector('.toggle input[type=checkbox]') as HTMLInputElement
    expect(tick.checked).toBe(true)
    await act(async () => tick.click())
    expect(calls.onSkipPicture).toHaveBeenCalledWith('j1', 'p1', true)
  })

  it('says so when no picture comes up', async () => {
    await ask([sorted()])
    expect(host.textContent).toContain('No pictures come up in this video.')
  })

  it('starts the hook switch the way it was set last, so Next alone keeps it', async () => {
    await ask([sorted()])
    await act(async () => (host.querySelector('.check-hook input[type=checkbox]') as HTMLInputElement).click())
    await act(async () => button('Next')!.click())
    const calls = await ask([sorted('j2')])
    expect((host.querySelector('.check-hook input[type=checkbox]') as HTMLInputElement).checked).toBe(true)
    await act(async () => button('Next')!.click())
    expect(calls.onNext).toHaveBeenCalledWith(true)
  })

  it('asks no hook question for a video with no headline - just Next', async () => {
    const calls = await ask([sorted('j1', '')])
    expect(host.textContent).not.toContain('Captions on the hook?')
    await act(async () => button('Next')!.click())
    expect(calls.onNext).toHaveBeenCalledWith(undefined)
  })

  it('asks for each video when several are checked, the hook once', async () => {
    const calls = await ask([sorted('j1'), sorted('j2')])
    expect(host.querySelectorAll('.check-video')).toHaveLength(2)
    expect(host.textContent).toContain('This goes for all 2 videos')
    const headlines = host.querySelectorAll('input[type=text]')
    expect(headlines).toHaveLength(2)
    await act(async () => {
      const input = headlines[1] as HTMLInputElement
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      set.call(input, 'new one')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(calls.onHeadline).toHaveBeenCalledWith('j2', 'new one')
  })
})

async function row(onCheck?: () => void, onCuts?: () => void) {
  await act(async () =>
    root.render(
      <ul>
        <JobRow
          job={sorted()}
          label="Inflow"
          campaigns={[campaign]}
          onApprove={() => {}}
          onCheck={onCheck}
          onCuts={onCuts}
          onMusic={() => {}}
          pictures={[]}
          onSkipPicture={() => {}}
          onChoose={() => {}}
          onHeadline={() => {}}
          onHeadlineDone={() => {}}
          onHeadlineStyle={() => {}}
          onRetry={() => {}}
          onRemove={() => {}}
        />
      </ul>,
    ),
  )
  const open = host.querySelector('.vrow-open') as HTMLButtonElement
  if (open.getAttribute('aria-expanded') === 'false') await act(async () => open.click())
}

describe("a video's row", () => {
  it('leaves where it goes, the headline, music, effects and Edit cuts to its Captions screen', async () => {
    await row(() => {}, () => {})
    expect(button('Check captions')).toBeDefined()
    expect(host.textContent).not.toContain('Goes to')
    expect(host.textContent).not.toContain('Music')
    expect(host.textContent).not.toContain('Effects')
    expect(button('Edit cuts')).toBeUndefined()
    expect(button('Check cuts')).toBeUndefined()
    expect(host.textContent).toContain('"hi"')
  })

  it('keeps them for a video with no Captions screen, but never Effects', async () => {
    await row(undefined, () => {})
    expect(host.textContent).toContain('Goes to')
    expect(host.textContent).toContain('Music')
    expect(host.textContent).not.toContain('Effects')
    expect(button('Edit cuts')).toBeDefined()
  })
})
