import { describe, expect, it } from 'vitest'

import { cleanStoryboard } from '../../../supabase/functions/postiz/motion.ts'
import { MIN_GAP, makeSound, motionSounds, soundsByName, type MotionSound } from './sfx'

const start = (i: number) => i * 0.5

describe('motion graphics: the sound effects, worked out from the storyboard', () => {
  it('whooshes when the board comes up from his face, pops and ticks as parts come in, dings on a result', () => {
    const board = cleanStoryboard(
      {
        format: 'board',
        scenes: [
          { from: 2, to: 8, says: '', parts: [{ kind: 'title', at: 3, text: 'x' }, { kind: 'cards', at: 4, cards: [{ badge: 'a', tone: 'purple', at: 5, lines: [{ text: 'l', at: 7, mark: 'check' }] }] }] },
          // Right after: the board stays up - no second whoosh.
          { from: 9, to: 14, says: '', parts: [{ kind: 'math', at: 10, lines: [{ text: '1', at: 11 }], result: { text: '= 3', at: 13 } }] },
          // Long after: up again.
          { from: 30, to: 34, says: '', parts: [{ kind: 'note', at: 31, text: 'n' }] },
        ],
      },
      40,
    )
    const cues = motionSounds(board, start)
    expect(cues.filter((c) => c.sound === 'whoosh').map((c) => c.at)).toEqual([1, 15])
    expect(cues).toContainEqual({ sound: 'ding', at: 6.5 })
    expect(cues).toContainEqual({ sound: 'tick', at: 3.5 })
    expect(cues.filter((c) => c.sound === 'pop').length).toBeGreaterThanOrEqual(3)
  })

  it('words look: a deep hit on gold words, a camera flash on a white flash, ticks on diamonds, no whoosh', () => {
    const board = cleanStoryboard(
      {
        format: 'words',
        emphasis: [{ at: 2, style: 'gold' }],
        scenes: [
          { from: 4, to: 8, says: '', parts: [{ kind: 'diamonds', at: 4, items: [{ at: 5 }, { at: 6 }, { at: 7 }] }] },
          { from: 10, to: 12, says: '', parts: [{ kind: 'flash', at: 10, to: 12 }] },
        ],
      },
      20,
    )
    const names = motionSounds(board, start).map((c) => c.sound)
    expect(names).toContain('hit')
    expect(names).toContain('shutter')
    expect(names.filter((n) => n === 'tick').length).toBe(3)
    expect(names).not.toContain('whoosh')
  })

  it('never two closer than the gap - the stronger one stays', () => {
    const board = cleanStoryboard(
      { format: 'words', emphasis: [{ at: 4, style: 'gold' }], scenes: [{ from: 4, to: 6, says: '', parts: [{ kind: 'point', at: 4, number: 1, text: 'x' }] }] },
      10,
    )
    const cues = motionSounds(board, start)
    for (let i = 1; i < cues.length; i++) expect(cues[i].at - cues[i - 1].at).toBeGreaterThanOrEqual(MIN_GAP)
    expect(cues.find((c) => c.at === 2)?.sound).toBe('hit')
  })

  it('groups them by sound for the render, each with its level', () => {
    const grouped = soundsByName([
      { sound: 'pop', at: 3 },
      { sound: 'tick', at: 1 },
      { sound: 'pop', at: 2 },
    ])
    expect(grouped.find((g) => g.name === 'pop')?.moments).toEqual([2, 3])
    expect(grouped.every((g) => g.volumeDb < 0)).toBe(true)
  })

  it('every sound is made, short, and never past full scale', () => {
    for (const name of ['whoosh', 'pop', 'ding', 'tick', 'hit', 'shutter', 'swish'] as MotionSound[]) {
      const samples = makeSound(name, 48000)
      expect(samples.length).toBeGreaterThan(100)
      expect(samples.length / 48000).toBeLessThan(1)
      let peak = 0
      for (const v of samples) peak = Math.max(peak, Math.abs(v))
      expect(peak).toBeGreaterThan(0.05)
      expect(peak).toBeLessThanOrEqual(1.5)
    }
  })
})
