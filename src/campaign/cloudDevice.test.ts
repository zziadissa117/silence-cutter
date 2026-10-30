// Each phone's own id and name, sent with every sign-in: a login made with a
// link is tied to the phones it signs in on.

import { describe, expect, it, vi } from 'vitest'

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

import { deviceName, thisDevice } from './cloud'

describe('thisDevice', () => {
  it('makes an id once and keeps it', () => {
    localStorage.clear()
    const first = thisDevice()
    expect(first.id).toMatch(/^[\w-]{16,64}$/)
    expect(thisDevice().id).toBe(first.id)
  })
})

describe('deviceName', () => {
  const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0.1 Mobile/15E148 Safari/604.1'

  it('says which phone and how it is opened', () => {
    expect(deviceName(iphone, false)).toBe('iPhone · Safari')
    expect(deviceName(iphone, true)).toBe('iPhone · Home Screen app')
    expect(deviceName('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130 Safari/537.36', false)).toBe('Mac · Chrome')
  })
})
