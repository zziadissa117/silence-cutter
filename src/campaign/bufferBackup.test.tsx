// Settings, Posting: Buffer as a backup - a key pasted, the accounts it backs
// up, and "Postiz is down".

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./posting', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  saveBackup: vi.fn(async () => ({})),
}))

import { BufferBackup } from './BufferBackup'
import { saveBackup, type Profile } from './posting'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const account = { id: 'a1', name: 'Michaelangelo', platform: 'instagram-standalone', profile: 'traderzi2', picture: '', disabled: false }
const base = { id: 'p1', accounts: [account], settings: {}, timezone: 'America/Toronto', hasAnthropic: true, vapidPublic: null } as unknown as Profile

let host: HTMLElement
let root: Root
beforeEach(() => {
  vi.mocked(saveBackup).mockClear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const show = async (profile: Profile, onChanged = vi.fn()) => {
  await act(async () => root.render(<BufferBackup profile={profile} onChanged={onChanged} />))
  return onChanged
}
const button = (text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(text)) as HTMLButtonElement

describe('the Buffer backup in Settings', () => {
  it('asks for a key, and sends the one pasted', async () => {
    const onChanged = await show(base)
    expect(host.textContent).toContain('Not set up')
    const input = host.querySelector('input[aria-label="Buffer API key"]') as HTMLInputElement
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
      set.call(input, ' buf_123 ')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => button('Add').click())
    expect(saveBackup).toHaveBeenCalledWith({ bufferKey: ' buf_123 ' })
    expect(onChanged).toHaveBeenCalled()
  })

  it('says which accounts it backs up, and switches "Postiz is down"', async () => {
    const backup = { keys: 1, active: false, problem: null, checkedAt: null, channels: [{ name: 'traderzi2', service: 'instagram' }], matched: { a1: 'traderzi2' } }
    await show({ ...base, backup })
    expect(host.textContent).toContain('Backs up @traderzi2 on Instagram')
    const toggle = host.querySelector('input[type="checkbox"]') as HTMLInputElement
    await act(async () => toggle.click())
    expect(saveBackup).toHaveBeenCalledWith({ active: true })
  })

  it("says when the key's Instagram isn't one of the Postiz accounts", async () => {
    const backup = { keys: 1, active: false, problem: null, checkedAt: null, channels: [{ name: 'someoneelse', service: 'instagram' }], matched: {} }
    await show({ ...base, backup })
    expect(host.textContent).toContain('Buffer has someoneelse, but none of them is one of your Instagram accounts in Postiz')
  })
})
