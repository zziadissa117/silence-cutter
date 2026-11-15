// The clip screen's Length: the clip's timeline opens with its parts on it
// (found 2026-11-15 writing the guide: it opened before they were read, and
// stayed empty).

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { BankFile, BatchBank, BatchFormat } from './batch'

vi.mock('./store', () => ({
  loadBankFile: vi.fn(async () => new Blob(['clip'], { type: 'video/mp4' })),
  saveBankFile: vi.fn(async () => {}),
  retireBankFiles: vi.fn(async () => {}),
}))
vi.mock('./talkLink', () => ({ downloadFile: vi.fn(async () => null) }))
vi.mock('./clipEdit', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  // Read a moment later, as the phone reads the clip from its storage.
  sourceOf: vi.fn(
    () =>
      new Promise((resolve) =>
        setTimeout(
          () =>
            resolve({
              source: { fileId: 'h1', size: 1, type: 'video/mp4', keep: [{ start: 0, end: 4 }], words: [], duration: 4, effects: {}, brandWords: [], voice: false, seed: 'h1', self: true },
              recording: new Blob(['clip'], { type: 'video/mp4' }),
            }),
          20,
        ),
      ),
  ),
}))
// The timeline (tested in its own files). Like the real one it takes its
// parts when it opens.
vi.mock('./CutsEditor', async () => {
  const { useState } = await vi.importActual<typeof import('react')>('react')
  return {
    CutsEditor: (p: { initial: { start: number; end: number }[] }) => {
      const [initial] = useState(p.initial)
      return <span className="timeline-parts">{JSON.stringify(initial)}</span>
    },
  }
})

import { ClipEditor } from './ClipEditor'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLElement
let root: Root

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:clip')
  URL.revokeObjectURL = vi.fn()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const hook: BankFile = { id: 'h1', name: 'hook.mp4', type: 'video/mp4', size: 1, seconds: 4, edited: true, formats: ['f'] }
const format: BatchFormat = { id: 'f', kind: 'talking', name: 'Talking head' }
const bank = { campaignId: 'c', angleId: 'a', reactions: [hook], products: [], headlines: [], music: [], perDay: 1, days: 1, used: {}, formats: [format] } as BatchBank

describe("the clip screen's Length", () => {
  it('opens the timeline with the clip on it, once it is read', async () => {
    await act(async () =>
      root.render(<ClipEditor format={format} steps={[]} hooks={[hook]} getBank={() => bank} keep={() => {}} onCaptions={() => {}} onReplace={() => true} onClose={() => {}} />),
    )
    const length = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Length') as HTMLButtonElement
    await act(async () => length.click())
    expect(document.body.textContent).toContain('Getting the clip…')
    await act(() => new Promise((resolve) => setTimeout(resolve, 60)))
    expect(document.body.querySelector('.timeline-parts')?.textContent).toBe('[{"start":0,"end":4}]')
  })
})
