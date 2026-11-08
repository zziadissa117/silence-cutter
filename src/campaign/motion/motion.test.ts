import { describe, expect, it } from 'vitest'

import { cleanStoryboard, type Storyboard } from '../../../supabase/functions/postiz/motion.ts'
import { BOARD_BOTTOM, appear, countText, drawMotion, faceDropAt, FACE_DROP, layoutScene, sceneWindows, splitAt, type Timing } from './draw'
import { MotionTrack, cutTiming, rawTimeAt } from './track'

/** Word i said from i/2 s to i/2 + 0.4 s. */
const words = Array.from({ length: 40 }, (_, i) => ({ start: i / 2, end: i / 2 + 0.4 }))
const time: Timing = { start: (i) => words[i]?.start ?? Infinity, end: (i) => words[i]?.end ?? Infinity }

const board: Storyboard = cleanStoryboard(
  {
    hook: { at: 0, to: 3, label: 'per month', text: '+10 000 $' },
    scenes: [
      {
        from: 6,
        to: 14,
        says: 'two cards',
        parts: [
          { kind: 'title', at: 6, text: '2 types of contracts' },
          { kind: 'cards', at: 7, cards: [{ badge: 'base pay', tone: 'purple', at: 7, lines: [{ text: 'per video', at: 9, mark: 'check' }] }, { badge: 'cpm', tone: 'green', at: 8, lines: [{ text: 'per views', at: 10, mark: 'cross' }] }] },
        ],
      },
      {
        from: 16,
        to: 24,
        says: 'tiles then phones',
        parts: [
          { kind: 'tiles', at: 16, count: 10, steps: [{ at: 16, filled: 2, tone: 'purple', locked: true }, { at: 20, filled: 10, tone: 'green', locked: false }], window: 'Make videos', unit: 'videos' },
          { kind: 'phones', at: 18, items: [{ text: '50', at: 18 }, { text: '10 000', at: 19, lit: true }], sign: '=', prices: [{ text: '25 $', at: 20 }, { text: '50 $', at: 22 }] },
        ],
      },
      {
        from: 30,
        to: 38,
        says: 'a sum',
        parts: [
          { kind: 'math', at: 30, lines: [{ text: '50 videos', at: 30 }, { text: '× 1 500 views', at: 31 }], result: { text: '= 300 $ / day', at: 33 } },
          { kind: 'list', at: 34, items: [{ text: 'garanti', at: 34, icon: 'check' }, { text: 'more money', at: 35 }] },
          { kind: 'icons', at: 36, items: [{ icon: 'video', text: 'Film', at: 36 }, { icon: 'rocket', text: 'Go', at: 37 }] },
          { kind: 'number', at: 36, label: 'a day', text: '300 $' },
          { kind: 'note', at: 37, text: 'max 1 or 2 videos' },
        ],
      },
    ],
    end: { at: 39, text: '+ Follow for more tips' },
  },
  words.length,
)

describe('motion graphics: when the board is up', () => {
  it('is down on his face, slides up for a scene, and stays up between scenes close together', () => {
    expect(splitAt(board, time, 1)).toBe(0)
    expect(splitAt(board, time, 5)).toBe(1)
    expect(splitAt(board, time, 2.95)).toBeGreaterThan(0)
    expect(splitAt(board, time, 2.95)).toBeLessThan(1)
    // Between scene 1 (ends ~7.75 s) and scene 2 (starts ~7.8 s): still up.
    expect(splitAt(board, time, 7.75)).toBe(1)
    // A long gap before the third scene: back on his face.
    expect(splitAt(board, time, 13)).toBe(0)
    expect(faceDropAt(board, time, 5, 1920)).toBe(Math.round(FACE_DROP * 1920))
  })

  it('gives each scene its own window, never into the next', () => {
    const w = sceneWindows(board, time)
    expect(w[0].end).toBeLessThanOrEqual(w[1].start)
    expect(w[0].start).toBeCloseTo(3 - 0.2)
  })

  it('brings a part up just before its word', () => {
    expect(appear(2.9, 3)).toBe(0)
    expect(appear(3.3, 3)).toBe(1)
  })

  it('a word not reached yet in the render shows nothing', () => {
    const later: Timing = { start: () => Infinity, end: () => Infinity }
    expect(splitAt(board, later, 5)).toBe(0)
  })
})

describe('motion graphics: numbers counting up in their own writing', () => {
  it('keeps spaces, commas and what is around the number', () => {
    expect(countText('+10 000 $', 1)).toBe('+10 000 $')
    expect(countText('+10 000 $', 0)).toBe('+0 $')
    expect(countText('= $1,500 / day', 0.999)).toMatch(/^= \$1,\d{3} \/ day$/)
    expect(countText('4.5x', 0)).toBe('0.0x')
    expect(countText('no number', 0.5)).toBe('no number')
  })
})

describe('motion graphics: laid out on the board', () => {
  it('fits every scene between the top bar and the board edge', () => {
    for (const scene of board.scenes) {
      const { boxes, scale, originY } = layoutScene(scene, 1080, 1920)
      const last = boxes[boxes.length - 1]
      expect(originY).toBeGreaterThanOrEqual(0.09 * 1920 - 1)
      expect(originY + (last.y + last.h) * scale).toBeLessThanOrEqual(BOARD_BOTTOM * 1920)
    }
  })
})

describe('motion graphics: drawn', () => {
  it('draws every kind of part at every moment without throwing', () => {
    const calls: string[] = []
    const gradient = { addColorStop: () => {} }
    const ctx = new Proxy(
      {},
      {
        get: (_target, key) => {
          if (key === 'measureText') return (s: string) => ({ width: s.length * 20 })
          if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => gradient
          return (...args: unknown[]) => {
            calls.push(String(key))
            return args
          }
        },
        set: () => true,
      },
    ) as unknown as OffscreenCanvasRenderingContext2D
    for (let t = 0; t < 21; t += 0.1) drawMotion(ctx, 1080, 1920, board, time, t)
    expect(calls).toContain('fillText')
    expect(calls).toContain('arcTo')
  })
})

describe('motion graphics: word numbers to the finished video', () => {
  const keep = [
    { start: 0, end: 4 },
    { start: 6, end: 20 },
  ]
  it('in the render, each word lands with its part as the render reaches it', () => {
    const track = new MotionTrack(words, keep)
    expect(track.timing.start(14)).toBe(Infinity)
    track.enterRange(0, 0)
    expect(track.timing.start(2)).toBe(1)
    expect(track.timing.start(14)).toBe(Infinity)
    track.enterRange(1, -2)
    expect(track.timing.start(14)).toBe(5)
    // Said in the gap that was cut: lands where the next part starts.
    expect(track.timing.start(10)).toBe(4)
  })

  it('before it is made, from the kept parts alone - the same answer', () => {
    const timing = cutTiming(words, keep)
    expect(timing.start(2)).toBe(1)
    expect(timing.start(14)).toBe(5)
    expect(timing.start(10)).toBe(4)
    expect(rawTimeAt(5, keep)).toBe(7)
    expect(rawTimeAt(99, keep)).toBeCloseTo(19.95)
  })
})

import { numbersSaid } from './Planning'

describe('motion graphics: the numbers he says, shown while Claude plans', () => {
  it('picks out each number with what it counts', () => {
    expect(numbersSaid(['I', 'make', '10K', 'a', 'month,', 'with', '50', 'videos', 'and', '10', '000', 'views.', '10K'])).toEqual(['10K', '50 videos', '10 000 views'])
    expect(numbersSaid(['at', '$4', 'per', '1000'])).toEqual(['$4', '1000'])
    expect(numbersSaid(['no', 'numbers', 'here'])).toEqual([])
  })
})
