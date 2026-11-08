// More -> Motion graphics: the plan he sees before anything is made, and the
// chat that changes it.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { cleanStoryboard } from '../../supabase/functions/postiz/motion.ts'
import type { MotionSession } from './motion/session'

const words = Array.from({ length: 30 }, (_, i) => ({ text: ` word${i}`, start: i / 2, end: i / 2 + 0.4 }))
const plan = { keep: [{ start: 0, end: 15 }], duration: 15, silences: 0, fillerWords: 0, stutters: 0, words, spoken: words, aligned: true, cleanSpeech: false }
const board = cleanStoryboard(
  {
    hook: { at: 0, to: 3, label: 'per month', text: '+10 000 $' },
    scenes: [{ from: 6, to: 14, says: 'Two cards side by side.', parts: [{ kind: 'title', at: 6, text: 'Two contracts' }] }],
    end: { at: 28, text: 'Follow for more' },
  },
  words.length,
)

let kept: MotionSession | null = null
const saved: MotionSession[] = []
vi.mock('./motion/session', () => ({
  loadSession: vi.fn(async () => kept),
  freshFile: vi.fn(async (_id: string, fallback: Blob) => fallback),
  saveSession: vi.fn(async (s: MotionSession) => {
    saved.push(s)
  }),
  clearSession: vi.fn(async () => {
    kept = null
  }),
}))
vi.mock('./motion/frames', () => ({
  FrameReader: class {
    frameAt = async () => null
    dispose() {}
  },
}))
const motionPlan = vi.fn()
vi.mock('./posting', async (original) => ({ ...(await original<Record<string, unknown>>()), motionPlan: (...a: unknown[]) => motionPlan(...a), postingHere: () => ({ profile: { id: 'p' }, sendHere: true }) }))

import { MotionView } from './MotionView'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLDivElement

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  saved.length = 0
  motionPlan.mockReset()
  // jsdom draws nothing: a canvas whose context does nothing.
  HTMLCanvasElement.prototype.getContext = (() =>
    new Proxy(
      {},
      {
        get: (_t, key) => (key === 'measureText' ? () => ({ width: 10 }) : key === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {}),
        set: () => true,
      },
    )) as never
  HTMLCanvasElement.prototype.toDataURL = () => 'data:image/jpeg;base64,'
  URL.createObjectURL = () => 'blob:video'
  URL.revokeObjectURL = () => {}
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const settle = async () => {
  for (let i = 0; i < 5; i++) await act(async () => await new Promise((r) => setTimeout(r, 0)))
}

describe('Motion graphics', () => {
  it('starts on picking a video, with an optional line of what he wants', async () => {
    kept = null
    await act(async () => root.render(<MotionView onBack={() => {}} />))
    await settle()
    expect(host.textContent).toContain('Pick a talking video')
    expect(host.querySelector('textarea')).not.toBeNull()
  })

  it("shows Claude's plan before anything is made: the hook, each scene, the banner", async () => {
    kept = { id: 'm1', file: new Blob(['x']), fileName: 'take.mov', ask: '', plan, storyboard: board, chat: [], costCents: 3 }
    await act(async () => root.render(<MotionView onBack={() => {}} />))
    await settle()
    expect(host.textContent).toContain('Over your face')
    expect(host.textContent).toContain('Two cards side by side.')
    expect(host.textContent).toContain('Follow for more')
    expect(host.textContent).toContain('Make the video')
    expect(host.textContent).toContain('3¢')
  })

  it('a chat message changes the plan and Claude says what it did', async () => {
    kept = { id: 'm1', file: new Blob(['x']), fileName: 'take.mov', ask: '', plan, storyboard: board, chat: [], costCents: 0 }
    const changed = { ...board, scenes: [{ ...board.scenes[0], says: 'Just the title now.' }] }
    motionPlan.mockResolvedValue({ storyboard: changed, reply: 'Took the cards out.', costCents: 2 })
    await act(async () => root.render(<MotionView onBack={() => {}} />))
    await settle()
    const box = host.querySelector('.motion-say textarea') as HTMLTextAreaElement
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
      set.call(box, 'drop the cards')
      box.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const send = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Send')!
    await act(async () => send.click())
    await settle()
    expect(motionPlan).toHaveBeenCalledWith(expect.objectContaining({ storyboard: board, chat: [{ from: 'him', text: 'drop the cards' }] }))
    expect(host.textContent).toContain('Took the cards out.')
    expect(host.textContent).toContain('Just the title now.')
    expect(saved.at(-1)?.storyboard).toEqual(changed)
  })
})

describe('Motion graphics: captions he can fix, as on Videos', () => {
  it("opens the Cutter's caption screen, and what he types is what the video shows", async () => {
    kept = { id: 'm1', file: new Blob(['x']), fileName: 'take.mov', ask: '', plan, storyboard: board, chat: [], costCents: 0 }
    await act(async () => root.render(<MotionView onBack={() => {}} />))
    await settle()
    const edit = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Edit captions')!
    await act(async () => edit.click())
    await settle()
    const box = host.querySelector('textarea, input[type=text]') as HTMLTextAreaElement | HTMLInputElement
    expect(box).not.toBeNull()
    await act(async () => {
      const proto = box instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(box, 'Fixed words here')
      box.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const done = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Done')!
    await act(async () => done.click())
    await settle()
    const last = saved.at(-1)!
    expect(last.captions?.edited?.map((w) => w.text.trim()).join(' ')).toContain('Fixed words here')
    expect(last.storyboard).toEqual(board)
    expect(host.textContent).toContain('Edit captions (changed)')
  })
})
