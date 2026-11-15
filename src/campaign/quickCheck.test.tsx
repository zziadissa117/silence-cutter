// The quick look at every clip of a talking head format (his ask,
// 2026-11-15): each plays whole, arrows through them, Mirror, Remove,
// Re-edit, Replace - no captions.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { BankFile, BatchBank, BatchStep } from './batch'

const retired: string[][] = []
vi.mock('./store', () => ({
  loadBankFile: vi.fn(async (f: BankFile) => (f.id === 'gone' ? null : new Blob([f.id]))),
  saveBankFile: vi.fn(async () => {}),
  retireBankFiles: vi.fn(async (ids: string[]) => void retired.push(ids)),
}))
vi.mock('./talkLink', () => ({ downloadFile: vi.fn(async () => Promise.reject(new Error('no server'))) }))
vi.mock('./talkCaptions', () => ({ keptWords: () => null }))

import { QuickCheck } from './QuickCheck'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const clip = (id: string, extra: Partial<BankFile> = {}): BankFile => ({ id, name: `${id}.mp4`, type: 'video/mp4', size: 1, ...extra })

let bank: BatchBank
let root: Root
let host: HTMLDivElement
const onReedit = vi.fn()
const onReplace = vi.fn(() => true)
const onClose = vi.fn()

beforeEach(() => {
  URL.createObjectURL = () => `blob:${Math.random()}`
  URL.revokeObjectURL = () => {}
  bank = {
    steps: [
      { id: 's1', name: 'Open the app', files: [clip('a'), clip('b', { mirror: true })], formats: ['t'] },
      { id: 's2', name: 'Tap create', files: [clip('c')], formats: ['t'] },
    ],
    reactions: [clip('h', { formats: ['t'], talks: true })],
  } as unknown as BatchBank
  retired.length = 0
  onReedit.mockClear()
  onReplace.mockClear()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const settle = async () => {
  for (let i = 0; i < 6; i++) await act(async () => await new Promise((r) => setTimeout(r, 0)))
}
const render = async () => {
  await act(async () =>
    root.render(
      <QuickCheck
        formatId="t"
        steps={bank.steps as BatchStep[]}
        hooks={bank.reactions}
        getBank={() => bank}
        keep={(next) => void (bank = next)}
        onReedit={onReedit}
        onReplace={onReplace}
        onClose={onClose}
      />,
    ),
  )
  await settle()
}
const button = (text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) as HTMLButtonElement
const label = (name: string) => host.querySelector(`[aria-label="${name}"]`) as HTMLButtonElement

describe('the quick look at every clip', () => {
  it('goes through every clip, step by step then the hooks, each playing whole - no captions', async () => {
    await render()
    expect(host.textContent).toContain('1 / 4')
    expect(host.textContent).toContain('1 · Open the app')
    expect(host.querySelector('video')?.getAttribute('aria-label')).toBe('a.mp4')
    expect(host.querySelector('video')?.hasAttribute('loop')).toBe(true)
    expect(label('Previous clip').disabled).toBe(true)
    await act(async () => label('Next clip').click())
    await settle()
    expect(host.textContent).toContain('2 / 4')
    expect(host.querySelector('.clip-viewer.mirrored')).not.toBeNull()
    await act(async () => label('Next clip').click())
    await act(async () => label('Next clip').click())
    await settle()
    expect(host.textContent).toContain('4 / 4')
    expect(host.textContent).toContain('Hook')
    expect(label('Next clip').disabled).toBe(true)
  })

  it('Mirror is saved on the clip at once, and flips the picture', async () => {
    await render()
    await act(async () => button('Mirror').click())
    await render()
    expect(bank.steps![0].files[0].mirror).toBe(true)
    expect(host.querySelector('.clip-viewer.mirrored')).not.toBeNull()
    await act(async () => button('Mirrored').click())
    await render()
    expect(bank.steps![0].files[0].mirror).toBeUndefined()
  })

  it('Remove takes it out of the batch; the next one comes to its place', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await render()
    await act(async () => button('Remove').click())
    await render()
    expect(bank.steps![0].files.map((f) => f.id)).toEqual(['b'])
    expect(retired).toEqual([['a']])
    expect(host.textContent).toContain('1 / 3')
    expect(host.querySelector('video')?.getAttribute('aria-label')).toBe('b.mp4')
  })

  it('Re-edit and Replace hand the clip over, with where it is', async () => {
    await render()
    await act(async () => button('Re-edit').click())
    expect(onReedit.mock.calls[0][0]).toMatchObject({ file: { id: 'a' }, place: 's1' })
    const input = host.querySelector('input[aria-label="Replace with a video from your phone"]') as HTMLInputElement
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'new.mov', { type: 'video/quicktime' })], configurable: true })
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
    await settle()
    expect(onReplace).toHaveBeenCalledTimes(1)
    expect((onReplace.mock.calls[0] as unknown[])[1]).toMatchObject({ file: { id: 'a' }, place: 's1' })
    expect(host.textContent).toContain("it takes this clip's place once you approve it on the check")
  })
})
