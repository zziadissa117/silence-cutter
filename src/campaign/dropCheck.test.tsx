// His check of a talking head's edited clips, one by one (his report,
// 2026-11-13): where each goes - pointed out every time - and its captions on
// the Cutter's own caption check (stubbed here: tested in its own files).

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { BatchBank, BatchFormat, BatchStep } from './batch'
import type { CaptionWord } from './captions'
import { loadQueue, saveQueue, type ToCheck } from './dropQueue'
import type { Campaign } from './look'

const retired: string[][] = []
vi.mock('./store', () => ({
  loadBankFile: vi.fn(async () => new Blob(['clip'])),
  saveBankFile: vi.fn(async () => {}),
  retireBankFiles: vi.fn(async (ids: string[]) => void retired.push(ids)),
}))
vi.mock('./talkLink', () => ({ downloadFile: vi.fn(async () => new Blob(['clip'])) }))
vi.mock('./posting', () => ({ postingHere: () => ({}), recheckCaptions: vi.fn() }))
// The caption check itself: what it is handed, and Approve with a fixed phrase.
const seen: { name: string; recheckKey?: string; captionStyle?: string; hasRecheck: boolean }[] = []
vi.mock('./CaptionReview', () => ({
  CaptionReview: (p: {
    name: string
    top: React.ReactNode
    initial: CaptionWord[]
    approveLabel: string
    recheckKey?: string
    captionStyle?: string
    onRecheck?: unknown
    onCaptionStyle: (s: string) => void
    onApprove: (w: CaptionWord[]) => void
    onSkip: (w: CaptionWord[]) => void
  }) => {
    seen.push({ name: p.name, recheckKey: p.recheckKey, captionStyle: p.captionStyle, hasRecheck: Boolean(p.onRecheck) })
    return (
      <section>
        {p.top}
        <span className="review-name">{p.name}</span>
        <button type="button" onClick={() => p.onCaptionStyle('highlight')}>
          Style
        </button>
        <button type="button" onClick={() => p.onApprove([{ text: 'Fixed', start: 0, end: 0.5 }])}>
          {p.approveLabel}
        </button>
        <button type="button" onClick={() => p.onSkip([])}>
          Without captions
        </button>
      </section>
    )
  },
}))

import { DropCheck } from './DropCheck'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const steps: BatchStep[] = [
  { id: 's1', name: 'Nope, do this instead', files: [], formats: ['t'] },
  { id: 's2', name: 'Open the app', files: [{ id: 'old', name: 'old.mp4', type: 'video/mp4', size: 1 }], formats: ['t'] },
]
const format: BatchFormat = { id: 't', kind: 'talking', name: 'Talk' }
const campaign = { id: 'c', name: 'Pump Fun', brandWords: ['Pump Fun'], posting: { rules: '' } } as unknown as Campaign
const clip = (id: string, place: string | null, sure: boolean, extra: Partial<ToCheck> = {}): ToCheck => ({
  file: { id, name: `${id}.mp4`, type: 'video/mp4', size: 1, fp: `fp-${id}`, edited: true },
  name: `${id}.mov`,
  text: `words of ${id}`,
  words: [{ text: 'heard', start: 0, end: 0.4 }],
  place,
  sure,
  ...extra,
})

let root: Root
let host: HTMLDivElement
let bank: BatchBank
let formatNow: BatchFormat
const onClose = vi.fn()
beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  bank = { steps: structuredClone(steps), reactions: [] } as unknown as BatchBank
  formatNow = { ...format }
  retired.length = 0
  seen.length = 0
  onClose.mockClear()
  localStorage.clear()
  window.scrollTo = () => {}
  Element.prototype.scrollTo = () => {}
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const render = () =>
  act(async () =>
    root.render(
      <DropCheck
        format={formatNow}
        steps={bank.steps!}
        campaign={campaign}
        getBank={() => bank}
        keep={(next) => void (bank = next)}
        onFormat={(patch) => void (formatNow = { ...formatNow, ...patch })}
        onClose={onClose}
      />,
    ),
  )
const button = (text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(text)) as HTMLButtonElement
const click = (text: string) => act(async () => button(text).click())

describe('checking every clip, one by one', () => {
  it('points out each clip and where it goes - the unsure ones first - and puts it in the batch only when he approves', async () => {
    saveQueue('t', [clip('a', 's1', true), clip('b', 's1', false)])
    await render()
    // The one it wasn't sure of first, marked.
    expect(host.querySelector('.review-name')?.textContent).toBe('b.mov')
    expect(host.textContent).toContain('Clip 1 of 2')
    expect(host.textContent).toContain('Not sure - check it')
    const lit = () => host.querySelector('.drop-check-steps [aria-checked="true"]')?.textContent
    expect(lit()).toBe('1Nope, do this instead')
    // He moves it to step 2 and approves: there, with his captions.
    await click('Open the app')
    expect(lit()).toBe('2Open the app')
    expect(host.textContent).not.toContain('Not sure - check it')
    await click('Approve & next clip')
    expect(bank.steps![1].files.map((f) => f.id)).toEqual(['old', 'b'])
    expect(bank.steps![1].files[1]).toMatchObject({ edited: true, captions: [{ text: 'Fixed' }] })
    // Its step learns how he says it.
    expect(bank.steps![1].heard).toEqual(['words of b'])
    // The next one; the last says Approve.
    expect(host.textContent).toContain('Clip 2 of 2')
    expect(host.querySelector('.review-name')?.textContent).toBe('a.mov')
    await click('Approve')
    expect(bank.steps![0].files.map((f) => f.id)).toEqual(['a'])
    expect(loadQueue('t')).toEqual([])
    expect(onClose).toHaveBeenCalled()
    // Claude checks each clip's captions by itself, once per clip.
    expect(seen.every((s) => s.hasRecheck)).toBe(true)
    expect(new Set(seen.map((s) => s.recheckKey))).toEqual(new Set(['drop:fp-b', 'drop:fp-a']))
  })

  it('one no step fits must be given a place first; Leave out lets its clip go', async () => {
    saveQueue('t', [clip('c', null, false), clip('d', 's2', true)])
    await render()
    expect(host.textContent).toContain('No step fits what it says')
    await click('Approve & next clip')
    expect(host.textContent).toContain('Pick where it goes, then Approve.')
    expect(loadQueue('t')).toHaveLength(2)
    await click('Leave out')
    await click('Leave it out')
    expect(retired).toEqual([['c']])
    expect(bank.steps!.flatMap((s) => s.files).map((f) => f.id)).not.toContain('c')
    expect(host.querySelector('.review-name')?.textContent).toBe('d.mov')
  })

  it('an edited clip takes the place of the one it was made from; the caption style he picks is the format’s', async () => {
    saveQueue('t', [clip('e', 's2', true, { replaces: 'old' })])
    await render()
    await click('Style')
    expect(formatNow.captionStyle).toBe('highlight')
    await click('Without captions')
    expect(bank.steps![1].files.map((f) => f.id)).toEqual(['e'])
    expect(bank.steps![1].files[0].captions).toEqual([])
    expect(retired).toEqual([['old']])
  })

  it('a hook goes in with his voice kept, as one of this format’s hooks', async () => {
    saveQueue('t', [clip('h', 'hook', true)])
    await render()
    await click('Approve')
    expect(bank.reactions).toEqual([expect.objectContaining({ id: 'h', formats: ['t'], talks: true, edited: true })])
  })
})
