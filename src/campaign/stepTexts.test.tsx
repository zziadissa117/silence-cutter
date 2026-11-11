// A product step's words, placed on its phone screen (his ask, 2026-11-11).

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./store', () => ({ loadBankFile: vi.fn(async () => null) }))
vi.mock('./headlineFont', () => ({ headlineFontReady: vi.fn(async () => {}) }))

import { stepTexts, type StepText } from './batch'
import { blankAngle } from './look'
import { StepTexts, startingTexts } from './StepTexts'

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
    const saved = onSave.mock.calls[0][0] as StepText[]
    expect(saved.map((t) => t.text)).toEqual(['Open the app', 'Link in bio'])
    expect(saved[1]).toMatchObject({ style: 'box', place: { x: 0.5, y: 0.8 } })
    expect(saved[1].place.scale).toBeGreaterThan(1)
  })
})
