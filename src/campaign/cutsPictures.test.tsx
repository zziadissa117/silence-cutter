// A picture put on a video by hand, edited in the cuts editor: picked from
// the row under the controls, made longer or shorter, bigger or smaller,
// dragged to a spot, deleted.

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
  it('opens under the video when picked, and can be made longer and shorter', async () => {
    const onDone = await open()
    expect(host.querySelector('.pic-edit')).toBeNull()
    await act(async () => (host.querySelector('.pic-chip') as HTMLButtonElement).click())
    expect(host.querySelector('.pic-edit')?.textContent).toContain('3.0 s')
    await act(async () => button('Longer').click())
    await act(async () => button('Longer').click())
    await act(async () => button('Shorter').click())
    expect(host.querySelector('.pic-seconds')?.textContent).toBe('3.5 s')
    // "Done" on the picture closes it; the page's Done keeps the changes.
    await act(async () => (host.querySelector('.pic-edit .linkbtn') as HTMLButtonElement).click())
    expect(done(onDone)[0].seconds).toBe(3.5)
  })

  it('is made bigger or smaller with the slider', async () => {
    const onDone = await open()
    await act(async () => (host.querySelector('.pic-chip') as HTMLButtonElement).click())
    const slider = host.querySelector('[aria-label="How big the picture is"]') as HTMLInputElement
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
      set.call(slider, '72')
      slider.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(host.querySelector('.pic-edit output')?.textContent).toBe('72%')
    await act(async () => (host.querySelector('.pic-edit .linkbtn') as HTMLButtonElement).click())
    expect(done(onDone)[0].widthPct).toBe(72)
  })

  it('is dragged to a spot of its own', async () => {
    const onDone = await open()
    await act(async () => (host.querySelector('.pic-chip') as HTMLButtonElement).click())
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
    await act(async () => (host.querySelector('.pic-chip') as HTMLButtonElement).click())
    await act(async () => button('Delete picture').click())
    expect(host.querySelector('.pic-edit')).toBeNull()
    expect(host.querySelector('.pic-chip')).toBeNull()
    expect(done(onDone)).toEqual([])
  })
})
