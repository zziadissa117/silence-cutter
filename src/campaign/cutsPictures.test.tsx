// A picture put on a video by hand, edited in the cuts editor: picked with a
// tap that keeps the playhead where it was, its bar dragged straight away -
// moved, or stretched by its end - dragged to a spot on the video, deleted.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CutsEditor } from './CutsEditor'
import type { ManualPicture } from './manualPictures'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const picture: ManualPicture = { id: 'p1', source: { kind: 'phone', name: 'logo.png', type: 'image/png' }, at: 2, seconds: 3, position: 'top-right', widthPct: 40 }

let host: HTMLElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  URL.createObjectURL = vi.fn(() => 'blob:picture')
  URL.revokeObjectURL = vi.fn()
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function open() {
  const onDone = vi.fn()
  await act(async () =>
    root.render(
      <CutsEditor
        name="take.mov"
        file={null}
        duration={10}
        initial={[{ start: 0, end: 10 }]}
        words={[]}
        overlays={[picture]}
        loadImage={async () => new Blob(['png'], { type: 'image/png' })}
        onDone={onDone}
        onCancel={() => {}}
      />,
    ),
  )
  await act(async () => {})
  return onDone
}

const button = (label: string) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === label || b.getAttribute('aria-label') === label) as HTMLButtonElement
const done = (onDone: ReturnType<typeof vi.fn>) => {
  act(() => button('Done').click())
  return onDone.mock.calls.at(-1)![1] as ManualPicture[]
}

describe('a picture on a video, in the cuts editor', () => {
  it('is picked with a tap, and the playhead stays where he left it', async () => {
    await open()
    expect(host.querySelector('.pic-edit')).toBeNull()
    const before = host.querySelector('.cuts-timer')!.textContent
    await act(async () => (host.querySelector('.tl-bar.picture') as HTMLElement).click())
    expect(host.querySelector('.pic-edit')).not.toBeNull()
    // Not sent to the picture's start (2 s): his place is kept.
    expect(host.querySelector('.cuts-timer')!.textContent).toBe(before)
    // Nothing to set by hand: no seconds, no size, no "Start it here".
    expect(host.querySelector('.pic-edit')!.textContent).not.toMatch(/On screen for|Size|Start it here|Put back/)
    expect(button('Longer')).toBeUndefined()
  })

  /** A finger on the bar, moved `dx` px, then let go - no tap first. */
  const drag = async (at: 'middle' | 'end' | 'start', dx: number) => {
    const bar = host.querySelector('.tl-bar.picture') as HTMLElement
    bar.getBoundingClientRect = () => ({ left: 100, top: 0, width: 100, height: 28, right: 200, bottom: 28, x: 100, y: 0, toJSON: () => ({}) })
    const x = at === 'middle' ? 150 : at === 'end' ? 195 : 105
    const pointer = (type: string, clientX: number) => {
      const e = new MouseEvent(type, { bubbles: true, clientX, clientY: 10 }) as MouseEvent & { pointerId: number }
      Object.defineProperty(e, 'pointerId', { value: 1 })
      bar.dispatchEvent(e)
    }
    await act(async () => pointer('pointerdown', x))
    await act(async () => pointer('pointermove', x + dx))
    await act(async () => pointer('pointerup', x + dx))
  }

  it('is made longer by dragging its end, straight away', async () => {
    const onDone = await open()
    await drag('end', 60)
    // Held, it is picked too.
    expect(host.querySelector('.pic-edit')).not.toBeNull()
    const made = done(onDone)[0]
    expect(made.seconds).toBeGreaterThan(3)
    expect(made.at).toBe(2)
  })

  it('is moved along the video by dragging its middle, straight away', async () => {
    const onDone = await open()
    await drag('middle', 60)
    const made = done(onDone)[0]
    expect(made.at).toBeGreaterThan(2)
    expect(made.seconds).toBe(3)
  })

  it('is dragged to a spot of its own', async () => {
    const onDone = await open()
    await act(async () => (host.querySelector('.tl-bar.picture') as HTMLElement).click())
    const frame = host.querySelector('.review-frame') as HTMLElement
    frame.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 400, right: 200, bottom: 400, x: 0, y: 0, toJSON: () => ({}) })
    const img = host.querySelector('.cuts-pic-preview.editing') as HTMLImageElement
    expect(img).not.toBeNull()
    const pointer = (type: string, x: number, y: number) => {
      const e = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }) as MouseEvent & { pointerId: number }
      Object.defineProperty(e, 'pointerId', { value: 1 })
      img.dispatchEvent(e)
    }
    await act(async () => pointer('pointerdown', 100, 100))
    await act(async () => pointer('pointermove', 60, 300))
    await act(async () => pointer('pointerup', 60, 300))
    await act(async () => (host.querySelector('.pic-edit .linkbtn') as HTMLButtonElement).click())
    const moved = done(onDone)[0]
    // 40 px left of a 200 px frame, 200 px down a 400 px one.
    expect(moved.center!.y - 0.5).toBeGreaterThan(0)
    expect(moved.center!.x).toBeLessThan(0.75)
  })

  it('is deleted', async () => {
    const onDone = await open()
    await act(async () => (host.querySelector('.tl-bar.picture') as HTMLElement).click())
    await act(async () => button('Delete picture').click())
    expect(host.querySelector('.pic-edit')).toBeNull()
    expect(host.querySelector('.tl-bar.picture')).toBeNull()
    expect(done(onDone)).toEqual([])
  })
})
