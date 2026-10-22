// The edit screen as TikTok's editor: the headline on the video to drag and
// size, words of his own (+ Text), and a picture or video over him
// (+ Overlay) - each kept on the video when he is done.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CutsEditor, overlayRows } from './CutsEditor'
import type { HeadlinePlace } from './look'
import type { ManualPicture } from './manualPictures'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLElement
let root: Root
const restore: (() => void)[] = []

/** jsdom has no canvas and lays nothing out: a canvas that measures every
 *  letter 10 px wide, and a frame 200 x 400. */
beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  localStorage.clear()
  URL.createObjectURL = vi.fn(() => 'blob:thing')
  URL.revokeObjectURL = vi.fn()
  const ctx = new Proxy(
    { measureText: (s: string) => ({ width: s.length * 10, fontBoundingBoxAscent: 20, fontBoundingBoxDescent: 5 }) } as Record<string, unknown>,
    { get: (target, key) => (key in target ? target[key as string] : () => {}), set: () => true },
  )
  const getContext = HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.getContext = (() => ctx) as unknown as typeof getContext
  const width = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
  const height = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 200 })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 400 })
  restore.push(() => {
    HTMLCanvasElement.prototype.getContext = getContext
    if (width) Object.defineProperty(HTMLElement.prototype, 'clientWidth', width)
    if (height) Object.defineProperty(HTMLElement.prototype, 'clientHeight', height)
  })
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  for (const undo of restore.splice(0)) undo()
})

const headlineLook = { text: 'wait for it', position: 'top', style: 'outline', size: 'medium' } as const

async function open({ overlays = [] as ManualPicture[], place = null as HeadlinePlace | null } = {}) {
  const onDone = vi.fn()
  const onPlace = vi.fn()
  await act(async () =>
    root.render(
      <CutsEditor
        name="take.mov"
        file={null}
        duration={10}
        initial={[{ start: 0, end: 10 }]}
        words={[]}
        overlays={overlays}
        videoBank={[{ id: 'v1', name: 'Screen recording', seconds: 7, loadStill: async () => null }]}
        loadVideo={async () => new Blob(['mp4'], { type: 'video/mp4' })}
        headline={{ look: headlineLook, seconds: 4, place, onPlace }}
        onDone={onDone}
        onCancel={() => {}}
      />,
    ),
  )
  await act(async () => {})
  return { onDone, onPlace }
}

const button = (label: string) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === label || b.getAttribute('aria-label') === label) as HTMLButtonElement
const set = (input: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}
const done = (onDone: ReturnType<typeof vi.fn>) => {
  act(() => button('Done').click())
  return onDone.mock.calls.at(-1)![1] as ManualPicture[]
}
const pointer = (target: Element, type: string, x: number, y: number, id = 1) => {
  const e = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }) as MouseEvent & { pointerId: number }
  Object.defineProperty(e, 'pointerId', { value: id })
  target.dispatchEvent(e)
}

describe('words of his own', () => {
  it('go on at the playhead in the middle, in the headline look, as he types them', async () => {
    const { onDone } = await open()
    await act(async () => button('+ Text').click())
    const box = host.querySelector('.pic-edit input[aria-label="Your words"]') as HTMLInputElement
    expect(box).not.toBeNull()
    expect(document.activeElement).toBe(box)
    await act(async () => set(box, 'link in bio'))
    await act(async () => button('Snapchat').click())
    // Drawn where they will be: a box over them to take hold of.
    expect(host.querySelector('.cuts-text-hold[aria-label^="Your words"]')).not.toBeNull()
    await act(async () => (host.querySelector('.pic-edit .linkbtn') as HTMLButtonElement).click())
    const [words] = done(onDone)
    expect(words.source).toEqual({ kind: 'text', text: 'link in bio', style: 'snap' })
    expect(words.center).toEqual({ x: 0.5, y: 0.42 })
    expect(words.at).toBe(0)
  })

  it('are dropped when nothing was typed in them', async () => {
    const { onDone } = await open()
    await act(async () => button('+ Text').click())
    await act(async () => (host.querySelector('.pic-edit .linkbtn') as HTMLButtonElement).click())
    expect(done(onDone)).toEqual([])
  })

  it('are dragged and pinched like a picture', async () => {
    const words: ManualPicture = { id: 't1', source: { kind: 'text', text: 'hi', style: 'box' }, at: 0, seconds: 3, position: 'middle', widthPct: 40, center: { x: 0.5, y: 0.42 } }
    const { onDone } = await open({ overlays: [words] })
    const frame = host.querySelector('.review-frame') as HTMLElement
    frame.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 400, right: 200, bottom: 400, x: 0, y: 0, toJSON: () => ({}) })
    const hold = host.querySelector('.cuts-text-hold[aria-label^="Your words"]')!
    await act(async () => pointer(hold, 'pointerdown', 100, 100))
    await act(async () => pointer(hold, 'pointermove', 140, 180))
    await act(async () => pointer(hold, 'pointerup', 140, 180))
    const [moved] = done(onDone)
    expect(moved.center!.x).toBeCloseTo(0.7, 2)
    expect(moved.center!.y).toBeCloseTo(0.62, 2)
  })
})

describe('the headline on the video', () => {
  it('is dragged where he wants it, kept once the finger lets go', async () => {
    const { onPlace } = await open()
    const frame = host.querySelector('.review-frame') as HTMLElement
    frame.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 400, right: 200, bottom: 400, x: 0, y: 0, toJSON: () => ({}) })
    const hold = host.querySelector('.cuts-text-hold[aria-label^="The headline"]')!
    expect(hold).not.toBeNull()
    await act(async () => pointer(hold, 'pointerdown', 100, 80))
    expect(onPlace).not.toHaveBeenCalled()
    await act(async () => pointer(hold, 'pointermove', 100, 280))
    await act(async () => pointer(hold, 'pointerup', 100, 280))
    expect(onPlace).toHaveBeenCalledTimes(1)
    const place = onPlace.mock.calls[0][0] as HeadlinePlace
    expect(place.x).toBeCloseTo(0.5, 2)
    expect(place.y).toBeGreaterThan(0.6)
    expect(place.scale).toBe(1)
  })

  it('is sized with its slider, and put back in its spot', async () => {
    const { onPlace } = await open({ place: { x: 0.5, y: 0.7, scale: 1 } })
    await act(async () => button('Headline').click())
    expect(host.querySelector('.pic-edit')?.getAttribute('aria-label')).toBe('The headline')
    const slider = host.querySelector('[aria-label="How big the headline is"]') as HTMLInputElement
    await act(async () => set(slider, '150'))
    await act(async () => slider.dispatchEvent(new MouseEvent('pointerup', { bubbles: true })))
    expect(onPlace).toHaveBeenLastCalledWith({ x: 0.5, y: 0.7, scale: 1.5 })
    await act(async () => button('Put back').click())
    expect(onPlace).toHaveBeenLastCalledWith(null)
    expect(button('Put back')).toBeUndefined()
  })
})

describe('an overlay', () => {
  it('can be a video from the video bank, up for its own length, muted', async () => {
    const { onDone } = await open()
    await act(async () => button('+ Overlay').click())
    expect(host.querySelector('.pic-picker')?.textContent).toContain('A photo or video from my phone')
    const cell = [...host.querySelectorAll('.pic-cell')].find((c) => c.textContent?.includes('Screen recording')) as HTMLButtonElement
    await act(async () => cell.click())
    await act(async () => {})
    expect(host.querySelector('.pic-edit')?.textContent).toContain('Video at')
    expect(host.querySelector('.pic-edit')?.textContent).toContain('Plays without its sound.')
    expect(host.querySelector('video.cuts-video-preview')).not.toBeNull()
    expect(button('Longer').disabled).toBe(true)
    await act(async () => (host.querySelector('.pic-edit .linkbtn') as HTMLButtonElement).click())
    const [video] = done(onDone)
    expect(video.source).toEqual({ kind: 'video', videoId: 'v1' })
    expect(video).toMatchObject({ seconds: 7, length: 7, position: 'middle', widthPct: 70 })
  })
})

describe('the timeline', () => {
  it('gives things up at the same time rows of their own', () => {
    const { row, rows } = overlayRows([
      { id: 'a', at: 0, seconds: 3 },
      { id: 'b', at: 1, seconds: 3 },
      { id: 'c', at: 3, seconds: 1 },
      { id: 'd', at: 4, seconds: 1 },
    ])
    expect(rows).toBe(2)
    expect(['a', 'b', 'c', 'd'].map((id) => row.get(id))).toEqual([0, 1, 0, 0])
  })
})
