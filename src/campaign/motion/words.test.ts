import { describe, expect, it } from 'vitest'

import { cleanStoryboard, fakeStoryboard, motionMessage } from '../../../supabase/functions/postiz/motion.ts'
import { drawMotion, splitAt, type Timing } from './draw'
import { kineticFor } from './make'
import { blockAt, blockText, kineticPhrases, layoutBlock, type Kinetic } from './words'

const said = (texts: string[], step = 0.4) => texts.map((text, i) => ({ text, start: i * step, end: i * step + step * 0.8 }))
const timing = (words: { start: number; end: number }[]): Timing => ({ start: (i) => words[i]?.start ?? Infinity, end: (i) => words[i]?.end ?? Infinity })

const fakeCtx = () =>
  new Proxy(
    {},
    {
      get: (_t, key) => (key === 'measureText' ? (s: string) => ({ width: s.length * 30 }) : key === 'createLinearGradient' || key === 'createRadialGradient' ? () => ({ addColorStop() {} }) : () => {}),
      set: () => true,
    },
  ) as unknown as OffscreenCanvasRenderingContext2D

describe('Format 2 (words): the storyboard', () => {
  it('keeps only its own parts, its emphasis and its colour', () => {
    const board = cleanStoryboard(
      {
        format: 'words',
        grade: 'teal',
        emphasis: [
          { at: 3, style: 'gold' },
          { at: 4, style: 'big' },
          { at: 6, style: 'serif' },
          { at: 7, style: 'big' },
          { at: 99, style: 'huge' },
        ],
        hook: { at: 0, to: 1, label: 'x', text: '10' },
        scenes: [
          { from: 2, to: 9, says: '', parts: [{ kind: 'cards', at: 2, cards: [{ badge: 'a', tone: 'purple', at: 2, lines: [] }] }, { kind: 'diamonds', at: 2, items: [{ at: 3 }, { at: 4 }] }] },
          { from: 10, to: 30, says: '', parts: [{ kind: 'flash', at: 10, to: 30 }, { kind: 'point', at: 11, number: 2, text: 'not setting goals' }] },
        ],
      },
      40,
    )
    expect(board.format).toBe('words')
    expect(board.grade).toBe('teal')
    expect(board.hook).toBeNull()
    // Two loud words side by side: the second dropped. A serif word leads into the big one.
    expect(board.emphasis).toEqual([
      { at: 3, style: 'gold' },
      { at: 6, style: 'serif' },
      { at: 7, style: 'big' },
    ])
    expect(board.scenes[0].parts.map((p) => p.kind)).toEqual(['diamonds'])
    const [flash, point] = board.scenes[1].parts
    expect(flash).toMatchObject({ kind: 'flash', at: 10, to: 17 })
    expect(point).toMatchObject({ kind: 'point', number: 2, text: 'NOT SETTING GOALS' })
  })

  it('a plan from before there were two looks is the board, and never moves the face in the words look', () => {
    expect(cleanStoryboard({ scenes: [{ from: 0, to: 3, says: '', parts: [{ kind: 'title', at: 0, text: 'x' }] }] }, 5).format).toBe('board')
    const words = cleanStoryboard({ format: 'words', scenes: [{ from: 0, to: 3, says: '', parts: [{ kind: 'diamonds', at: 0, items: [{ at: 1 }] }] }] }, 5)
    expect(splitAt(words, { start: (i) => i, end: (i) => i + 0.5 }, 1)).toBe(0)
    expect(fakeStoryboard(10, 'words').format).toBe('words')
  })

  it('tells Claude the look he picked, or to pick', () => {
    expect(motionMessage('w', '', null, [], 'words')).toContain('he picked "words"')
    expect(motionMessage('w', '', null, [])).toContain('you pick')
  })
})

describe('Format 2 (words): the block under his face', () => {
  it('splits his words into blocks at a sentence, a comma, a pause, or six words', () => {
    const words = said(['can', 'you', 'turn', 'a', 'clip,', 'into', 'a', 'viral', 'edit.', 'one', 'two', 'three', 'four', 'five', 'six', 'seven'])
    expect(kineticPhrases(words)).toEqual([
      [0, 5],
      [5, 9],
      [9, 15],
      [15, 16],
    ])
    const paused = [...said(['a', 'b']), { text: 'c', start: 3, end: 3.3 }]
    expect(kineticPhrases(paused)).toEqual([
      [0, 2],
      [2, 3],
    ])
  })

  it('shows words without trailing punctuation, gold ones in capitals', () => {
    expect(blockText(' viral,', 'gold')).toBe('VIRAL')
    expect(blockText('Bruh....', null)).toBe('Bruh....')
    expect(blockText('"goals?"', null)).toBe('goals')
  })

  it('puts a big word on its own line, the serif word before it beside it', () => {
    const words = said(['here', 'are', 'the', 'three', 'big', 'mistakes'])
    const kinetic: Kinetic = { words, timing: timing(words), phrases: [[0, 6]], styleOf: (i) => (i === 2 ? 'serif' : i === 3 ? 'big' : null) }
    const placed = layoutBlock(fakeCtx(), kinetic, [0, 6], 1080, 1920)
    const line = (i: number) => placed.find((p) => p.index === i)!.y
    expect(line(0)).toBe(line(1))
    expect(line(2)).toBe(line(3))
    expect(line(3)).toBeGreaterThan(line(0))
    expect(line(4)).toBeGreaterThan(line(3))
  })

  it('a block is up from its first word to the next block', () => {
    const words = said(['a', 'b.', 'c', 'd'])
    const kinetic: Kinetic = { words, timing: timing(words), phrases: kineticPhrases(words), styleOf: () => null }
    expect(blockAt(kinetic, -1)).toBeNull()
    expect(blockAt(kinetic, 0.5)?.phrase).toEqual([0, 2])
    expect(blockAt(kinetic, 0.9)?.phrase).toEqual([2, 4])
  })

  it('draws every part of the words look at every moment without throwing', () => {
    const words = said(Array.from({ length: 30 }, (_, i) => `w${i}${i % 7 === 6 ? '.' : ''}`))
    const board = cleanStoryboard(
      {
        format: 'words',
        grade: 'warm',
        emphasis: [{ at: 2, style: 'gold' }],
        scenes: [
          { from: 3, to: 8, says: '', parts: [{ kind: 'diamonds', at: 3, items: [{ at: 4 }, { at: 5 }, { at: 6 }] }] },
          { from: 9, to: 14, says: '', parts: [{ kind: 'point', at: 9, number: 1, text: 'one' }] },
          { from: 15, to: 18, says: '', parts: [{ kind: 'flash', at: 15, to: 18 }] },
          { from: 19, to: 22, says: '', parts: [{ kind: 'dim', at: 19, to: 22, text: 'Bruh' }] },
        ],
        end: { at: 25, text: 'DM EDIT' },
      },
      words.length,
    )
    const kinetic: Kinetic = { words, timing: timing(words), phrases: kineticPhrases(words), styleOf: (i) => (i === 2 ? 'gold' : null) }
    for (let t = 0; t < 13; t += 0.1) drawMotion(fakeCtx(), 1080, 1920, board, timing(words), t, kinetic)
  })
})

describe('Format 2 (words): the words Claude picked, on the captions he fixed', () => {
  it('follows each picked word by when it is said, whatever he typed', () => {
    const heard = said(['I', 'make', 'ten', 'k', 'a', 'month'])
    const plan = { keep: [{ start: 0, end: 3 }], duration: 3, silences: 0, fillerWords: 0, stutters: 0, words: heard, spoken: heard, aligned: true, cleanSpeech: false }
    const board = cleanStoryboard({ format: 'words', emphasis: [{ at: 2, style: 'gold' }], scenes: [] }, heard.length)
    // He typed "ten k" as one word "10K": the gold goes to it.
    const edited = [heard[0], heard[1], { text: '10K', start: heard[2].start, end: heard[3].end }, heard[4], heard[5]]
    const made = kineticFor(plan, { edited }, board)
    expect(made.words.map((w) => w.text.trim())).toEqual(['I', 'make', '10K', 'a', 'month'])
    expect(made.styles).toEqual([null, null, 'gold', null, null])
  })
})
