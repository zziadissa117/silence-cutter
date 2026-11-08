// Posting set up with a Buffer key or a Postiz key - his ask (2026-11-08):
// "it can be a buffer api key too that works better, make it so he can put
// either one".

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./store', async (original) => {
  const real = await original<Record<string, unknown>>()
  return Object.fromEntries(Object.keys(real).map((key) => [key, typeof real[key] === 'function' ? vi.fn() : real[key]]))
})
vi.mock('./cloud', async (original) => ({
  ...(await original<typeof import('./cloud')>()),
  currentSession: () => ({ token: 't' }),
}))

import { PostingSetup } from './PostingSetup'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLDivElement
let sent: Record<string, unknown>[] = []

beforeEach(() => {
  sent = []
  localStorage.clear()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)))
      return new Response(JSON.stringify({ id: 'p1', accounts: [], settings: { via: 'buffer' }, timezone: 'UTC', hasAnthropic: true, vapidPublic: null }), { status: 200 })
    }),
  )
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

const type = async (input: HTMLInputElement, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })

describe('posting set up with either key', () => {
  it('starts on Buffer and sends the key as a Buffer key', async () => {
    const done = vi.fn()
    await act(async () => root.render(<PostingSetup again={false} onDone={done} onCancel={() => {}} />))
    expect(host.textContent).toContain('Buffer API key')
    const [key, anthropic] = [...host.querySelectorAll('input[type=password]')] as HTMLInputElement[]
    await type(key, 'buf-123')
    await type(anthropic, 'sk-ant')
    await act(async () => (host.querySelector('button[type=submit]') as HTMLButtonElement).click())
    expect(sent[0]).toMatchObject({ action: 'connect', bufferKey: 'buf-123', anthropicKey: 'sk-ant' })
    expect(sent[0]).not.toHaveProperty('postizKey')
    expect(done).toHaveBeenCalled()
  })

  it('sends a Postiz key when Postiz is picked', async () => {
    await act(async () => root.render(<PostingSetup again={false} onDone={() => {}} onCancel={() => {}} />))
    const postiz = [...host.querySelectorAll('[role=radio]')].find((b) => b.textContent === 'Postiz') as HTMLButtonElement
    await act(async () => postiz.click())
    expect(host.textContent).toContain('Postiz API key')
    const [key, anthropic] = [...host.querySelectorAll('input[type=password]')] as HTMLInputElement[]
    await type(key, 'pz-9')
    await type(anthropic, 'sk-ant')
    await act(async () => (host.querySelector('button[type=submit]') as HTMLButtonElement).click())
    expect(sent[0]).toMatchObject({ action: 'connect', postizKey: 'pz-9' })
  })
})
