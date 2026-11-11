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

  it('glass look: a swish as each card slides in, a whoosh for the light screen, a tick on a key phrase, a pop on the call to action', () => {
    const board = cleanStoryboard(
      {
        format: 'glass',
        title: { text: 'How I edit', to: 2 },
        emphasis: [{ at: 2, style: 'pill' }],
        scenes: [
          { from: 4, to: 8, says: '', parts: [{ kind: 'tag', at: 4, to: 8, label: 'x', text: 'edited end-to-end', mark: 'end-to-end', place: 'low' }] },
          { from: 10, to: 16, says: '', parts: [{ kind: 'steps', at: 10, to: 16, tag: '', items: [{ text: 'a', at: 11 }, { text: 'b', at: 13 }] }] },
        ],
      },
      20,
    )
    const cues = motionSounds(board, start)
    expect(cues).toContainEqual({ sound: 'swish', at: 0 })
    expect(cues).toContainEqual({ sound: 'tick', at: 1 })
    expect(cues).toContainEqual({ sound: 'swish', at: 2 })
    expect(cues).toContainEqual({ sound: 'whoosh', at: 5 })
    expect(cues.filter((c) => c.sound === 'pop').length).toBe(3)
  })

  it('never two closer than the gap - the stronger one stays', () => {
    const board = cleanStoryboard(
      { format: 'glass', emphasis: [{ at: 4, style: 'pill' }], scenes: [{ from: 4, to: 8, says: '', parts: [{ kind: 'stat', at: 4, to: 8, text: '94%', place: 'side' }] }] },
      12,
    )
    const cues = motionSounds(board, start)
    for (let i = 1; i < cues.length; i++) expect(cues[i].at - cues[i - 1].at).toBeGreaterThanOrEqual(MIN_GAP)
    expect(cues.find((c) => c.at === 2)?.sound).toBe('swish')
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

describe('his own sound effects on the graphics (2026-11-11: the made-up ones are gone)', () => {
  const bank = [
    { id: 'a', name: 'Whoosh fast' },
    { id: 'b', name: 'swoosh 2' },
    { id: 'c', name: 'Vine boom' },
    { id: 'd', name: 'my intro song' },
  ]

  it('picks an effect named for each kind of moment, taking turns', async () => {
    const { bankSounds, effectsFor } = await import('./sfx')
    expect(effectsFor('whoosh', bank).map((e) => e.id)).toEqual(['a', 'b'])
    expect(effectsFor('hit', bank).map((e) => e.id)).toEqual(['c'])
    const sounds = bankSounds(
      [
        { sound: 'whoosh', at: 1 },
        { sound: 'whoosh', at: 5 },
        { sound: 'whoosh', at: 9 },
        { sound: 'hit', at: 3 },
      ],
      bank,
    )
    expect(sounds.find((s) => s.effectId === 'a')?.moments).toEqual([1, 9])
    expect(sounds.find((s) => s.effectId === 'b')?.moments).toEqual([5])
    expect(sounds.find((s) => s.effectId === 'c')?.moments).toEqual([3])
  })

  it('leaves a moment silent when none of his effects is for it', async () => {
    const { bankSounds } = await import('./sfx')
    expect(bankSounds([{ sound: 'ding', at: 2 }], bank)).toEqual([])
    expect(bankSounds([{ sound: 'pop', at: 2 }], [])).toEqual([])
  })
})
