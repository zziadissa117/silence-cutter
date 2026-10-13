import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const songs = [
  { id: 's1', name: 'Sad piano', type: 'audio/mpeg', size: 2_400_000, fp: 'a' },
  { id: 's2', name: 'Late night beat', type: 'audio/mp4', size: 900_000, fp: 'b' },
]
const meta = new Map<string, string>([['music:bank', JSON.stringify(songs)]])

vi.mock('./store', () => ({
  getMeta: vi.fn(async (key: string) => meta.get(key) ?? null),
  setMeta: vi.fn(async (key: string, value: string) => void meta.set(key, value)),
  saveBankFile: vi.fn(async () => undefined),
  loadBankFile: vi.fn(async () => null),
  deleteBankFile: vi.fn(async () => undefined),
}))

import { MusicBankView } from './MusicBankView'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('the music bank screen', () => {
  it('lists each song by the name he gave it, with a play button and a way to rename it', async () => {
    await act(async () => root.render(<MusicBankView />))
    await act(async () => {})
    expect(host.textContent).toContain('Sad piano')
    expect(host.textContent).toContain('Late night beat')
    expect(host.querySelector('[aria-label="Play Sad piano"]')).not.toBeNull()
    expect(host.querySelector('[aria-label="Play Late night beat"]')).not.toBeNull()
    const name = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Sad piano')!
    expect(name.title).toBe('Tap to rename')
    expect((host.querySelector('input[type="file"]') as HTMLInputElement).accept).toContain('video/*')
  })

  it('renames a song from its name', async () => {
    await act(async () => root.render(<MusicBankView />))
    await act(async () => {})
    const name = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Sad piano')!
    await act(async () => name.click())
    const input = host.querySelector('[aria-label="Track name"]') as HTMLInputElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, 'Emotional piano')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => input.blur())
    await act(async () => {})
    expect(JSON.parse(meta.get('music:bank')!)[0].name).toBe('Emotional piano')
    expect(host.textContent).toContain('Emotional piano')
  })
})
