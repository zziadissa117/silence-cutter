// People: a sign-in link can be for Trial reels and nothing else.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./cloud', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  listPeople: vi.fn(async () => [
    { name: 'samtpnq', status: 'active', until: null, since: '2026-11-07', trial: true, only: 'trial', devices: [] },
    { name: 'jake', status: 'active', until: null, since: '2026-11-01', trial: false, devices: [] },
  ]),
  makeInvite: vi.fn(async () => ({ code: 'c'.repeat(40), until: '2026-11-09T00:00:00Z' })),
}))

import { People } from './People'
import { makeInvite } from './cloud'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
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

const flush = () => act(async () => new Promise((r) => setTimeout(r, 0)))

describe('a link for Trial reels only', () => {
  it('makes the link that way when ticked, and says so', async () => {
    await act(async () => root.render(<People />))
    await flush()
    const input = host.querySelector('input[aria-label="Login name"]') as HTMLInputElement
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      set.call(input, 'SAMTPNQ')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const only = host.querySelector('.trial-only-pick input') as HTMLInputElement
    await act(async () => only.click())
    const make = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Make link') as HTMLButtonElement
    await act(async () => make.click())
    await flush()
    expect(makeInvite).toHaveBeenCalledWith('samtpnq', 'trial')
    expect(host.textContent).toContain('Link for samtpnq · Trial reels only')
  })

  it("shows such a login as Trial reels only, with no Trial reels switch to turn off", async () => {
    await act(async () => root.render(<People />))
    await flush()
    expect(host.textContent).toContain('Trial reels only · on 0 phones')
    // Only jake (a normal login) has the switch.
    expect([...host.querySelectorAll('button')].filter((b) => b.textContent === 'Turn on')).toHaveLength(1)
  })
})
