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
const recheck = vi.fn(async (phrases: string[]) => ({ phrases, changed: [] as number[], costCents: 0 }))
vi.mock('./posting', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  motionPlan: (...a: unknown[]) => motionPlan(...a),
  recheckCaptions: (phrases: string[]) => recheck(phrases),
  postingHere: () => ({ profile: { id: 'p' }, sendHere: true }),
}))

const makeMotion = vi.fn(async () => ({ blob: new Blob(['made']), storedAs: null }))
vi.mock('./motion/make', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  makeMotionVideo: (...a: unknown[]) => makeMotion(...(a as [])),
}))

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
        get: (_t, key) => (key === 'measureText' ? () => ({ width: 10 }) : key === 'createLinearGradient' || key === 'createRadialGradient' ? () => ({ addColorStop() {} }) : () => {}),
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

  it('Make with a change typed and not sent: sends it first, then makes from the changed plan', async () => {
    kept = { id: 'm1', file: new Blob(['x']), fileName: 'take.mov', ask: '', plan, storyboard: board, chat: [], costCents: 0 }
    const changed = { ...board, scenes: [{ ...board.scenes[0], says: 'Just the title now.' }] }
    let answer: (v: unknown) => void = () => {}
    motionPlan.mockReturnValue(new Promise((r) => (answer = r)))
    await act(async () => root.render(<MotionView onBack={() => {}} />))
    await settle()
    const box = host.querySelector('.motion-say textarea') as HTMLTextAreaElement
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(box, 'drop the cards')
      box.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const make = [...host.querySelectorAll('.motion-actions button')][0] as HTMLButtonElement
    expect(make.textContent).toBe('Send my change, then make the video')
    await act(async () => make.click())
    expect(make.textContent).toBe('Sending your change…')
    expect(make.disabled).toBe(true)
    expect(motionPlan).toHaveBeenCalledWith(expect.objectContaining({ chat: [{ from: 'him', text: 'drop the cards' }] }))
    await act(async () => answer({ storyboard: changed, reply: 'Took the cards out.', costCents: 2 }))
    await settle()
    // Made from the changed plan, never the old one.
    expect(makeMotion).toHaveBeenCalledTimes(1)
    expect((makeMotion.mock.calls[0] as unknown[])[2]).toEqual(changed)
  })
})

describe('Motion graphics: Play shows the plan moving before anything is made', () => {
  it('plays his video over each cut, with the graphics drawn, and stops back on a still', async () => {
    const cutPlan = { ...plan, keep: [{ start: 0, end: 4 }, { start: 6, end: 15 }] }
    kept = { id: 'm1', file: new Blob(['x']), fileName: 'take.mov', ask: '', plan: cutPlan, storyboard: board, chat: [], costCents: 0 }
    const play = vi.fn(async () => {})
    const pause = vi.fn()
    HTMLMediaElement.prototype.play = play as never
    HTMLMediaElement.prototype.pause = pause
    let frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => frames.push(f))
    vi.stubGlobal('cancelAnimationFrame', () => {})
    try {
      await act(async () => root.render(<MotionView onBack={() => {}} />))
      await settle()
      const video = host.querySelector('video.motion-source') as HTMLVideoElement
      expect(video).not.toBeNull()
      let now = 0
      Object.defineProperty(video, 'currentTime', { get: () => now, set: (v: number) => (now = v), configurable: true })
      const button = host.querySelector('.motion-play') as HTMLButtonElement
      await act(async () => button.click())
      await settle()
      expect(play).toHaveBeenCalledTimes(1)
      expect(host.querySelector('.motion-play.on')).not.toBeNull()
      // A frame inside what was cut: the video jumps over it, as the made video will.
      now = 4.5
      const tick = frames.at(-1)!
      frames = []
      await act(async () => tick(0))
      expect(now).toBe(6)
      const slider = host.querySelector('.motion-stage input[type=range]') as HTMLInputElement
      expect(Number(slider.value)).toBeCloseTo(4)
      // Pause: back on a still, where it stopped.
      now = 8
      await act(async () => (host.querySelector('.motion-play') as HTMLButtonElement).click())
      await settle()
      expect(pause).toHaveBeenCalled()
      expect(host.querySelector('.motion-play.on')).toBeNull()
      expect(Number((host.querySelector('.motion-stage input[type=range]') as HTMLInputElement).value)).toBeCloseTo(6)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('Motion graphics: a moment changed by hand, without Claude', () => {
  const type = async (box: HTMLInputElement, value: string) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(box, value)
      box.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  it('tapping a moment shows its words; what he types is the plan, kept', async () => {
    kept = { id: 'm1', file: new Blob(['x']), fileName: 'take.mov', ask: '', plan, storyboard: board, chat: [], costCents: 0 }
    await act(async () => root.render(<MotionView onBack={() => {}} />))
    await settle()
    const scene = host.querySelector('.motion-scene') as HTMLButtonElement
    await act(async () => scene.click())
    const box = host.querySelector('.motion-edit input') as HTMLInputElement
    expect(box.value).toBe('Two contracts')
    await type(box, 'Two deals')
    expect(saved.at(-1)?.storyboard?.scenes[0].parts[0]).toMatchObject({ kind: 'title', text: 'Two deals' })
    expect(host.textContent).toContain('Two deals')
    // Emptied, the card keeps its words; the box gets them back when he leaves it.
    await type(box, '')
    expect(saved.at(-1)?.storyboard?.scenes[0].parts[0]).toMatchObject({ text: 'Two deals' })
    await act(async () => box.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
    expect((host.querySelector('.motion-edit input') as HTMLInputElement).value).toBe('Two deals')
    expect(motionPlan).not.toHaveBeenCalled()
  })

  it('takes a moment out, and puts it back', async () => {
    kept = { id: 'm1', file: new Blob(['x']), fileName: 'take.mov', ask: '', plan, storyboard: board, chat: [], costCents: 0 }
    await act(async () => root.render(<MotionView onBack={() => {}} />))
    await settle()
    await act(async () => (host.querySelector('.motion-scene') as HTMLButtonElement).click())
    const out = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Take this out')!
    await act(async () => out.click())
    expect(saved.at(-1)?.storyboard?.scenes).toEqual([])
    expect(host.querySelector('.motion-scene')).toBeNull()
    const back = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Put it back')!
    await act(async () => back.click())
    expect(saved.at(-1)?.storyboard).toEqual(board)
  })

  it('the call to action can be reworded but not taken out', async () => {
    kept = { id: 'm1', file: new Blob(['x']), fileName: 'take.mov', ask: '', plan, storyboard: board, chat: [], costCents: 0 }
    await act(async () => root.render(<MotionView onBack={() => {}} />))
    await settle()
    const cta = [...host.querySelectorAll('.motion-scenes .row-link')].find((b) => b.textContent?.includes('Call to action')) as HTMLButtonElement
    await act(async () => cta.click())
    expect([...host.querySelectorAll('button')].some((b) => b.textContent === 'Take this out')).toBe(false)
    await type(host.querySelector('.motion-edit input') as HTMLInputElement, 'Save this')
    expect(saved.at(-1)?.storyboard?.end?.text).toBe('Save this')
  })
})

describe('Motion graphics: captions he can fix, as on Videos', () => {
  it("opens the Cutter's caption screen, and what he types is what the video shows", async () => {
    kept = { id: 'm1', file: new Blob(['x']), fileName: 'take.mov', ask: '', plan, storyboard: board, chat: [], costCents: 0 }
    await act(async () => root.render(<MotionView onBack={() => {}} />))
    await settle()
    const edit = [...host.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Edit captions'))!
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

describe('Motion graphics: Format 2 (glass) has the Cutter\'s own captions', () => {
  it('shows no word styling of its own - its captions are the ones on Videos', async () => {
    const glassBoard = cleanStoryboard({ format: 'glass', emphasis: [{ at: 4, style: 'accent' }], scenes: [] }, words.length)
    kept = { id: 'm2', file: new Blob(['x']), fileName: 'take.mov', ask: '', plan, storyboard: glassBoard, chat: [], costCents: 0 }
    await act(async () => root.render(<MotionView onBack={() => {}} />))
    await settle()
    expect(host.textContent).not.toContain('Your words')
    expect(host.querySelector('.motion-word')).toBeNull()
  })

  it('a video planned in the old Format 2 goes back to its caption check, to be planned again as glass', async () => {
    kept = { id: 'm5', file: new Blob(['x']), fileName: 'take.mov', ask: '', plan, storyboard: { ...board, format: 'words' } as never, checked: true, chat: [], costCents: 0 }
    const { fromOldFormat2 } = await vi.importActual<typeof import('./motion/session')>('./motion/session')
    kept = fromOldFormat2(kept)
    expect(kept.storyboard).toBeUndefined()
    expect(kept.format).toBe('glass')
    await act(async () => root.render(<MotionView onBack={() => {}} />))
    await settle()
    expect(host.textContent).toContain('Check the captions')
  })
})

describe("Motion graphics: Claude checks the captions, as on Videos", () => {
  it('checks them by itself the first time they are opened, and its fix is what is kept', async () => {
    localStorage.clear()
    recheck.mockImplementation(async (phrases: string[]) => ({ phrases: ['Claude fixed this', ...phrases.slice(1)], changed: [0], costCents: 1 }))
    kept = { id: 'm3', file: new Blob(['x']), fileName: 'take.mov', ask: 'about money', plan, storyboard: board, chat: [], costCents: 0 }
    await act(async () => root.render(<MotionView onBack={() => {}} />))
    await settle()
    const edit = [...host.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Edit captions'))!
    expect(edit.textContent).toContain('Claude checks them')
    await act(async () => edit.click())
    await settle()
    expect(recheck).toHaveBeenCalled()
    expect(host.textContent).toContain('Claude fixed this')
  })
})

describe('Motion graphics: the caption check comes before the plan (his ask, 2026-11-08)', () => {
  it("Claude checks the heard captions by itself; Approve plans the graphics from the fixed words", async () => {
    localStorage.clear()
    recheck.mockImplementation(async (phrases: string[]) => ({ phrases: ['Ziad fixed', ...phrases.slice(1)], changed: [0], costCents: 1 }))
    motionPlan.mockResolvedValue({ storyboard: board, reply: '', costCents: 2 })
    kept = { id: 'm4', file: new Blob(['x']), fileName: 'take.mov', ask: '', plan, chat: [], costCents: 0 }
    await act(async () => root.render(<MotionView onBack={() => {}} />))
    await settle()
    expect(host.textContent).toContain('Check the captions')
    expect(recheck).toHaveBeenCalled()
    expect(motionPlan).not.toHaveBeenCalled()
    const approve = [...host.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Approve'))!
    await act(async () => approve.click())
    await settle()
    expect(saved.some((s) => s.checked)).toBe(true)
    const sent = motionPlan.mock.calls[0][0] as { words: string[] }
    expect(sent.words[0]).toBe('Ziad')
    expect(host.textContent).toContain('Two cards side by side.')
  })
})
