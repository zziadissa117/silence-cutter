// The front door: nothing but the sign-in page until there is a session, and
// back to it the moment the session ends.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// cloud.ts pulls in the Dexie store, which jsdom has no IndexedDB for. The
// gate only reads the session, so the store is stubbed out.
vi.mock('./store', () => ({
  applyRemote: vi.fn(),
  cacheFile: vi.fn(),
  cachedFile: vi.fn(),
  enqueueEverything: vi.fn(),
  getMeta: vi.fn(),
  markSent: vi.fn(),
  markUploaded: vi.fn(),
  outboxEntries: vi.fn(),
  setMeta: vi.fn(),
  storedRow: vi.fn(),
}))

import { SESSION_EVENT, signOut } from './cloud'
import { LoginGate } from './LoginGate'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLElement
let root: Root

beforeEach(() => {
  localStorage.clear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const show = () =>
  act(() =>
    root.render(
      <LoginGate>
        <p>the app</p>
      </LoginGate>,
    ),
  )

describe('the login gate', () => {
  it('shows the sign-in page and nothing of the app when signed out', () => {
    show()
    expect(host.textContent).toContain('Sign in')
    expect(host.textContent).not.toContain('the app')
    // No way to cancel out of it, and no way to make a login.
    expect(host.textContent).not.toContain('Cancel')
    expect(host.textContent).not.toMatch(/create/i)
  })

  it('shows the app when there is already a session, with no network needed', () => {
    localStorage.setItem('cutter.session', JSON.stringify({ name: 'me', token: 't.k' }))
    show()
    expect(host.textContent).toContain('the app')
    expect(host.textContent).not.toContain('Sign in')
  })

  it('puts the sign-in page back when the session ends', () => {
    localStorage.setItem('cutter.session', JSON.stringify({ name: 'me', token: 't.k' }))
    show()
    expect(host.textContent).toContain('the app')

    act(() => signOut())

    expect(host.textContent).toContain('Sign in')
    expect(host.textContent).not.toContain('the app')
  })

  it('opens the app when the session appears (signed in elsewhere, or another tab)', () => {
    show()
    expect(host.textContent).not.toContain('the app')
    localStorage.setItem('cutter.session', JSON.stringify({ name: 'me', token: 't.k' }))
    act(() => {
      window.dispatchEvent(new Event(SESSION_EVENT))
    })
    expect(host.textContent).toContain('the app')
  })

  it('does not let the button submit an empty or short password', () => {
    show()
    const button = host.querySelector('button[type="submit"]') as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })
})
