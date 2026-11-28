import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CutsEditor } from './CutsEditor'
import type { BankPicture } from './look'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  document.body.innerHTML = ''
})

describe('a phone picture in the edit screen', () => {
  it('is kept in the campaign bank at once and named right there', async () => {
    const picture: BankPicture = { id: 'cp-1', image: new Blob(['x'], { type: 'image/png' }), words: [], addedAt: 1, campaignId: 'c1' }
    const onPhonePicture = vi.fn(async () => picture)
    const onNamePicture = vi.fn()
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    await act(async () =>
      root.render(
        <CutsEditor name="v.mov" file={null} duration={10} initial={[{ start: 0, end: 10 }]} words={[]} onPhonePicture={onPhonePicture} onNamePicture={onNamePicture} onDone={() => {}} onCancel={() => {}} />,
      ),
    )
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
    await act(async () => {
      ;[...host.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Overlay' || b.textContent?.trim() === 'Overlay')!.click()
    })
    const input = host.querySelector<HTMLInputElement>('input[type=file]')
    expect(input).not.toBeNull()
    const file = new File(['x'], 'logo.png', { type: 'image/png' })
    Object.defineProperty(input!, 'files', { value: [file], configurable: true })
    await act(async () => {
      input!.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(onPhonePicture).toHaveBeenCalledWith(file)
    const name = host.querySelector<HTMLInputElement>('input[aria-label="Picture name"]')
    expect(name).not.toBeNull()
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      set.call(name, 'Claude')
      name!.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      host.querySelector<HTMLFormElement>('.pic-name-card')!.requestSubmit()
    })
    expect(onNamePicture).toHaveBeenCalledWith('cp-1', ['Claude'])
    act(() => root.unmount())
  })
})
