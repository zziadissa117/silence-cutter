// Saving many videos waiting for approval at once (his ask, 2026-11-22).
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./outbox', () => ({ localVideo: vi.fn(async (key: string) => new Blob([`video ${key}`], { type: 'video/mp4' })) }))

import type { ServerPost } from './posting'
import { SAVE_GROUP, SavePicker } from './SavePicker'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
const shared: File[][] = []

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  shared.length = 0
  Object.defineProperty(navigator, 'share', { configurable: true, value: vi.fn(async ({ files }: { files: File[] }) => void shared.push(files)) })
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const post = (n: number, campaign = 'covered'): ServerPost =>
  ({ id: `p${n}`, key: `k${n}`, campaignId: campaign, campaignName: campaign === 'covered' ? 'Covered' : 'Other', fileName: `clip${n}.mp4`, headline: `Headline ${n}`, videoUrl: null, status: 'waiting' }) as unknown as ServerPost

const button = (text: RegExp) => [...host.querySelectorAll('button')].find((b) => text.test(b.textContent ?? '')) as HTMLButtonElement
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))))

describe('saving videos waiting for approval', () => {
  it('every one ticked to start; untick one, then get and save the rest', async () => {
    const onClose = vi.fn()
    act(() => root.render(<SavePicker posts={[post(1), post(2), post(3)]} onClose={onClose} />))
    const boxes = host.querySelectorAll<HTMLInputElement>('input[type=checkbox]')
    expect([...boxes].every((b) => b.checked)).toBe(true)
    act(() => boxes[1].click())
    act(() => button(/^Save 2$/).click())
    await settle()
    await settle()
    await act(async () => button(/Save 2 to my phone/).click())
    expect(shared).toHaveLength(1)
    expect(shared[0].map((f) => f.name)).toEqual(['clip1_covered.mp4', 'clip3_covered.mp4'])
    expect(host.textContent).toContain('2 saved')
  })

  it(`in groups of ${SAVE_GROUP}, a tap to get and a tap to save each`, async () => {
    const posts = Array.from({ length: 16 }, (_, i) => post(i + 1))
    act(() => root.render(<SavePicker posts={posts} onClose={() => {}} />))
    act(() => button(/^Save 16$/).click())
    await settle()
    await settle()
    await act(async () => button(/Save 8 to my phone \(1-8 of 16\)/).click())
    act(() => button(/Get the next 8/).click())
    await settle()
    await settle()
    await act(async () => button(/Save 8 to my phone \(9-16 of 16\)/).click())
    expect(shared.map((g) => g.length)).toEqual([8, 8])
    expect(host.textContent).toContain('16 saved')
  })
})
