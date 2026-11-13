// "Drop in all videos" on a talking head format (his ask, 2026-11-13): each
// clip cut and heard (stubbed here), put in the step it says, then one quick
// check where a clip can be moved or left out.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { BatchBank, BatchStep } from './batch'

const said: Record<string, string> = {
  'a.mov': 'Nope, do this instead.',
  'b.mov': 'and now open the app',
  'c.mov': 'hello there everyone',
}
vi.mock('./prepareDrop', () => ({
  prepareClip: vi.fn(async (file: File, { from }: { from?: string }) => {
    if (file.name === 'bad.mov') throw new Error('no talking heard in it')
    return { file: { id: `cut-${file.name}`, name: file.name, type: 'video/mp4', size: 1, from }, words: [], text: said[file.name] }
  }),
}))
// A recording's fingerprint: its name, here.
vi.mock('./fingerprint', () => ({ fingerprint: vi.fn(async (file: File) => `fp-${file.name}`) }))
const retired: string[] = []
vi.mock('./store', () => ({ retireBankFiles: vi.fn(async (ids: string[]) => void retired.push(...ids)) }))

import { DropIn } from './DropIn'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const steps: BatchStep[] = [
  { id: 's1', name: 'Nope, do this instead', files: [] },
  { id: 's2', name: 'Open the app', files: [] },
]

let root: Root
let host: HTMLDivElement
let bank: BatchBank
beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  bank = { steps, reactions: [] } as unknown as BatchBank
  retired.length = 0
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const render = (hooks = false) =>
  act(async () =>
    root.render(
      <DropIn
        formatId="t"
        hooks={hooks}
        steps={bank.steps!}
        names={[]}
        getBank={() => bank}
        keep={(next) => {
          bank = next
        }}
      />,
    ),
  )

const drop = async (names: string[]) => {
  const input = host.querySelector('input[aria-label="Drop in all videos"]') as HTMLInputElement
  Object.defineProperty(input, 'files', { value: names.map((n) => new File(['x'], n, { type: 'video/quicktime' })), configurable: true })
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
  for (let i = 0; i < 5; i++) await act(async () => await new Promise((r) => setTimeout(r, 0)))
}

describe('dropping in all his clips', () => {
  it('puts each in the step it says, shows the unsure ones first, and keeps what he moves', async () => {
    await render()
    await drop(['a.mov', 'b.mov', 'c.mov', 'bad.mov'])
    expect(bank.steps![0].files.map((f) => f.id)).toEqual(['cut-a.mov'])
    expect(bank.steps![1].files.map((f) => f.id)).toEqual(['cut-b.mov'])
    expect(host.textContent).toContain('Check them · 4 clips · 1 to look at')
    // The one it couldn't place comes first, to pick its step.
    const first = host.querySelector('.drop-in-row') as HTMLElement
    expect(first.textContent).toContain('Not sure where it goes')
    const pick = first.querySelector('select') as HTMLSelectElement
    await act(async () => {
      pick.value = 's2'
      pick.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(bank.steps![1].files.map((f) => f.id)).toEqual(['cut-b.mov', 'cut-c.mov'])
    expect(host.textContent).toContain("bad.mov: couldn't use it (no talking heard in it)")
    // Checked: the step remembers how he said it.
    await act(async () => ([...host.querySelectorAll('button')].find((b) => b.textContent === 'Looks good') as HTMLButtonElement).click())
    expect(bank.steps![1].heard).toEqual(['hello there everyone', 'and now open the app'])
    expect(host.querySelector('.drop-in-check')).toBeNull()
  })

  it('leaves one out, and lets its clip go', async () => {
    await render()
    await drop(['a.mov'])
    const pick = host.querySelector('.drop-in-row select') as HTMLSelectElement
    await act(async () => {
      pick.value = 'out'
      pick.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(bank.steps![0].files).toEqual([])
    expect(retired).toEqual(['cut-a.mov'])
  })

  it('in a format that takes hooks, a clip that says no step is a hook; one dropped in before is not kept twice', async () => {
    await render(true)
    await drop(['a.mov', 'c.mov'])
    expect(bank.steps![0].files.map((f) => f.id)).toEqual(['cut-a.mov'])
    expect(bank.reactions.map((r) => r.id)).toEqual(['cut-c.mov'])
    expect(bank.reactions[0]).toMatchObject({ formats: ['t'], talks: true })
    // Clearly no step: a hook, nothing to look at.
    expect(host.textContent).toContain('all sure')
    // Moved from the hooks to a step.
    const row = [...host.querySelectorAll('.drop-in-row')].find((r) => r.textContent?.includes('hello there')) as HTMLElement
    const pick = row.querySelector('select') as HTMLSelectElement
    await act(async () => {
      pick.value = 's2'
      pick.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(bank.reactions).toEqual([])
    expect(bank.steps![1].files.map((f) => f.id)).toEqual(['cut-c.mov'])
    await act(async () => ([...host.querySelectorAll('button')].find((b) => b.textContent === 'Looks good') as HTMLButtonElement).click())
    await drop(['a.mov'])
    expect(host.textContent).toContain('a.mov: already in from before')
    expect(bank.steps![0].files).toHaveLength(1)
  })
})
