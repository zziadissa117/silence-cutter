// A product step's words, placed on its phone screen (his ask, 2026-11-11).

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const kept: { id: string; size: number }[] = []
const retired: string[][] = []
vi.mock('./store', () => ({
  loadBankFile: vi.fn(async () => null),
  loadBank: vi.fn(async () => []),
  saveBankFile: vi.fn(async (id: string, blob: Blob) => {
    kept.push({ id, size: blob.size })
  }),
  retireBankFiles: vi.fn(async (ids: string[]) => {
    retired.push(ids)
  }),
}))
vi.mock('./videoBank', () => ({ useVideoBank: () => [], videoFile: vi.fn(async () => null) }))
vi.mock('./fingerprint', () => ({ fingerprint: vi.fn(async () => 'fp') }))
vi.mock('./headlineFont', () => ({ headlineFontReady: vi.fn(async () => {}) }))

import { stepTexts, withoutName, type StepText } from './batch'
import { blankAngle } from './look'
import { StepTexts, snapToMiddle, startingTexts, type StepLook } from './StepTexts'
import { overlayBox } from './stepOverlays'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('the words a step puts over its clip', () => {
  it('its name at the top until he places his own; his own exactly as placed; none when he took them all out', () => {
    expect(stepTexts({ name: 'Open the app' })).toEqual([{ text: 'Open the app' }])
    expect(stepTexts({ name: 'Step 2' })).toEqual([])
    const own: StepText[] = [
      { id: 'a', text: 'Open the app', place: { x: 0.5, y: 0.2, scale: 1 } },
      { id: 'b', text: 'Link in bio', place: { x: 0.5, y: 0.8, scale: 1.3 }, style: 'box' },
      { id: 'c', text: '  ', place: { x: 0.5, y: 0.5, scale: 1 } },
    ]
    expect(stepTexts({ name: 'Open the app', texts: own }).map((t) => t.text)).toEqual(['Open the app', 'Link in bio'])
    expect(stepTexts({ name: 'Open the app', texts: [] })).toEqual([])
  })

  it('the editor starts from its name at the top', () => {
    expect(startingTexts({ name: 'Open the app' })).toMatchObject([{ text: 'Open the app', place: { x: 0.5, y: 0.2 } }])
    expect(startingTexts({ name: 'Step 1' })).toEqual([])
  })

  // His rule (2026-11-13): "On my talking heads, I don't want a headline every
  // single time there's a new clip ... I only need the captions".
  it("a talking head's step never has its name: not to start with, not saved with it before", () => {
    expect(startingTexts({ name: 'Nope, do this instead' }, true)).toEqual([])
    const saved: StepText[] = [
      { id: 'a', text: 'NOPE do this instead!', place: { x: 0.5, y: 0.2, scale: 1 } },
      { id: 'b', text: 'Link in bio', place: { x: 0.5, y: 0.8, scale: 1 } },
    ]
    expect(startingTexts({ name: 'Nope, do this instead', texts: saved }, true).map((t) => t.id)).toEqual(['b'])
    expect(withoutName({ name: 'Nope, do this instead' }, saved).map((t) => t.text)).toEqual(['Link in bio'])
    // Words that only share some of the name are his own.
    expect(withoutName({ name: 'Nope' }, [{ text: 'Nope, never' }])).toHaveLength(1)
    expect(withoutName({ name: 'Step 2' }, [{ text: 'Step 2' }])).toHaveLength(1)
  })
})

describe('placing words on the phone screen', () => {
  let root: Root
  let host: HTMLDivElement
  beforeEach(() => {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  it('adds words at the bottom, takes a look, and saves them where they are', async () => {
    const onSave = vi.fn()
    await act(async () =>
      root.render(<StepTexts step={{ id: 's1', name: 'Open the app', files: [] }} look={blankAngle('a', 'A').headline} onSave={onSave} onClose={() => {}} />),
    )
    const button = (text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === text) as HTMLButtonElement
    await act(async () => button('+ Text at the bottom').click())
    const box = host.querySelector('.step-text-edit input') as HTMLInputElement
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(box, 'Link in bio')
      box.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => button('White box').click())
    await act(async () => (host.querySelector('[aria-label="Bigger"]') as HTMLButtonElement).click())
    await act(async () => button('Save').click())
    const saved = (onSave.mock.calls[0][0] as StepLook).texts!
    expect(saved.map((t) => t.text)).toEqual(['Open the app', 'Link in bio'])
    expect(saved[1]).toMatchObject({ style: 'box', place: { x: 0.5, y: 0.8 } })
    expect(saved[1].place.scale).toBeGreaterThan(1)
  })

  it("on a talking head's step: an empty screen, the name saved before gone, no way to put it back", async () => {
    const onSave = vi.fn()
    const step = {
      id: 's1',
      name: 'Nope, do this instead',
      files: [],
      texts: [{ id: 'a', text: 'Nope, do this instead', place: { x: 0.5, y: 0.2, scale: 1 } }],
    }
    await act(async () => root.render(<StepTexts step={step} talking look={blankAngle('a', 'A').headline} onSave={onSave} onClose={() => {}} />))
    expect(host.textContent).toContain('No words on this step')
    expect(host.textContent).not.toContain('Back to its name at the top')
    const button = (text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === text) as HTMLButtonElement
    await act(async () => button('Save').click())
    expect((onSave.mock.calls[0][0] as StepLook).texts).toEqual([])
  })
})

describe('pictures and videos on a step (his ask, 2026-11-13)', () => {
  let root: Root
  let host: HTMLDivElement
  beforeEach(() => {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    kept.length = 0
    retired.length = 0
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  const pick = async (file: File) => {
    const input = host.querySelector('input[aria-label="Add a picture or video from your phone"]') as HTMLInputElement
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
  }

  it('adds one from his phone, kept with the clips, made bigger, saved with the step', async () => {
    const onSave = vi.fn()
    await act(async () => root.render(<StepTexts step={{ id: 's1', name: 'Step 1', files: [] }} look={blankAngle('a', 'A').headline} onSave={onSave} onClose={() => {}} />))
    await pick(new File(['png!'], 'logo.png', { type: 'image/png' }))
    expect(kept).toHaveLength(1)
    expect(host.textContent).toContain('Pops up every time this step plays')
    await act(async () => (host.querySelector('[aria-label="Bigger"]') as HTMLButtonElement).click())
    const button = (text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === text) as HTMLButtonElement
    await act(async () => button('Save').click())
    const saved = onSave.mock.calls[0][0] as StepLook
    expect(saved.overlays).toHaveLength(1)
    expect(saved.overlays[0]).toMatchObject({ file: { id: kept[0].id, name: 'logo.png', type: 'image/png' }, place: { x: 0.5, y: 0.42 } })
    expect(saved.overlays[0].place.width).toBeCloseTo(0.55)
    expect(retired).toEqual([])
  })

  it('lets go of what he added when he cancels, and of one he takes out', async () => {
    const onSave = vi.fn()
    const old = { id: 'o1', file: { id: 'f-old', name: 'old.mp4', type: 'video/mp4', size: 9 }, place: { x: 0.5, y: 0.3, width: 0.5 } }
    await act(async () => root.render(<StepTexts step={{ id: 's1', name: 'Step 1', files: [], overlays: [old] }} look={blankAngle('a', 'A').headline} onSave={onSave} onClose={() => {}} />))
    await pick(new File(['png!'], 'logo.png', { type: 'image/png' }))
    const button = (text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === text) as HTMLButtonElement
    await act(async () => button('Take it out').click())
    await act(async () => button('Save').click())
    // The old one stays; the new one, taken out, goes.
    expect((onSave.mock.calls[0][0] as StepLook).overlays.map((o) => o.id)).toEqual(['o1'])
    expect(retired.flat()).toEqual([kept[0].id])
  })
})

describe('centring by the line', () => {
  it('snaps to the middle when close, and says which way', () => {
    expect(snapToMiddle(0.49, 0.3)).toEqual({ x: 0.5, y: 0.3, across: true, down: false })
    expect(snapToMiddle(0.4, 0.505)).toEqual({ x: 0.4, y: 0.5, across: false, down: true })
    expect(snapToMiddle(0.3, 0.3)).toEqual({ x: 0.3, y: 0.3, across: false, down: false })
  })

  it("an overlay's box: its width, its own shape, centred where he put it", () => {
    expect(overlayBox({ x: 0.5, y: 0.5, width: 0.5 }, 9 / 16, 1080, 1920)).toEqual({ x: 270, y: 808, width: 540, height: 304 })
    // A tall one never taller than the frame.
    expect(overlayBox({ x: 0.5, y: 0.5, width: 1 }, 4, 1080, 1920).height).toBe(1920)
  })
})
