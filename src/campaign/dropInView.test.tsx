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
  prepareClip: vi.fn(async (file: File) => {
    if (file.name === 'bad.mov') throw new Error('no talking heard in it')
    return { file: { id: `cut-${file.name}`, name: file.name, type: 'video/mp4', size: 1 }, words: [], text: said[file.name] }
  }),
}))
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
  bank = { steps } as BatchBank
  retired.length = 0
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const render = () =>
  act(async () =>
    root.render(
      <DropIn
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
    expect(first.textContent).toContain('Not sure which step')
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
})
