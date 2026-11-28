import { describe, expect, it } from 'vitest'

import { emptyBank, formatBank, type BankFile, type BatchBank, type BatchFormat, type BatchSlot } from './batch'
import { leftToMake, missingFor, planVideos } from './batchRun'
import { levelsOf, popScale } from './splitRender'
import { DEFAULT_MONEY, goalIn, lineAt, linesFrom, moneyLine } from './splitScreen'

const files = (prefix: string, n: number, extra: Partial<BankFile> = {}): BankFile[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, name: `${prefix}${i}.mp4`, type: 'video/mp4', size: 1, formats: ['s'], ...extra }))
const slots = (n: number): BatchSlot[] => Array.from({ length: n }, (_, i) => ({ date: '2026-11-29', time: `${String(i % 24).padStart(2, '0')}:00` }))

const format: BatchFormat = { id: 's', kind: 'split', name: 'Soccer', lines: [{ text: 'Step 1. Find a soccer match', at: 0 }] }
const soccer = (fields: Partial<BatchBank> = {}): BatchBank => ({
  ...emptyBank('fairside', 'a1'),
  formats: [format],
  reactions: [...files('react', 3), ...files('desk', 2, { role: 'desk' })],
  products: [...files('match', 4, { role: 'under' }), ...files('product', 1)],
  headlines: ['Soccer = Rent paid'],
  music: [{ id: 'song', name: 'song.mp3', type: 'audio/mpeg', size: 1 }],
  ...fields,
})

describe('split screen batches', () => {
  it('mixes every reaction with every match, computer clip and product - never the same whole video twice', () => {
    const sub = formatBank(soccer(), format)
    expect(sub.reactions.map((r) => r.id)).toEqual(['react0', 'react1', 'react2'])
    expect(sub.steps?.map((s) => s.files.length)).toEqual([4, 2, 1])
    expect(leftToMake(soccer()).total).toBe(3 * 4 * 2 * 1)
    const plan = planVideos(soccer(), slots(24), { id: 'b', rand: () => 0.3 })
    expect(plan.videos).toHaveLength(24)
    const whole = new Set(plan.videos.map((v) => [v.reaction.id, ...(v.steps ?? []).map((s) => s.file.id)].join('+')))
    expect(whole.size).toBe(24)
    for (const v of plan.videos) {
      expect(v.steps?.map((s) => s.file.id.replace(/\d+$/, ''))).toEqual(['match', 'desk', 'product'])
      expect(v.voice).toBe(true)
      expect(v.split?.lines[0].text).toBe('Step 1. Find a soccer match')
      expect(v.split?.amount).toMatch(/^\+\$[\d,]+\.\d\d US$/)
    }
  })

  it('says what is missing', () => {
    expect(missingFor(formatBank(soccer({ reactions: files('react', 1) }), format))).toContain('a clip for You at the computer')
  })

  it('draws a believable amount in his range, the same for the same video', () => {
    expect(moneyLine('v1')).toBe(moneyLine('v1'))
    for (let i = 0; i < 200; i++) {
      const line = moneyLine(`v${i}`)
      const amount = Number(line.replace(/[^\d.]/g, ''))
      expect(amount).toBeGreaterThanOrEqual(DEFAULT_MONEY.min)
      expect(amount).toBeLessThanOrEqual(DEFAULT_MONEY.max)
    }
    expect(moneyLine('x', { min: 1000, max: 1000 })).toBe('+$1,000.00 US')
  })

  it('shows each step line from its moment until the next', () => {
    const lines = [
      { text: 'Step 2', at: 4 },
      { text: 'Step 1', at: 0 },
    ]
    expect(lineAt(lines, 0)).toBe('Step 1')
    expect(lineAt(lines, 3.9)).toBe('Step 1')
    expect(lineAt(lines, 4)).toBe('Step 2')
    expect(lineAt([], 3)).toBeNull()
  })

  it('keeps the moments of lines already set, spreads new ones', () => {
    const before = [{ text: 'Step 1', at: 0 }, { text: 'Step 2', at: 7.5 }]
    expect(linesFrom('Step 1\nStep 2\nStep 3', before, 15)).toEqual([
      { text: 'Step 1', at: 0 },
      { text: 'Step 2', at: 7.5 },
      { text: 'Step 3', at: 10 },
    ])
    expect(linesFrom('A\nB', [], 10).map((l) => l.at)).toEqual([0, 5])
  })

  it('finds the goal where the sound jumps', () => {
    const levels = [...Array(40).fill(0.05), ...Array(10).fill(0.6), ...Array(10).fill(0.3)]
    expect(goalIn(levels, 0.05)).toBeCloseTo(2, 5)
    expect(goalIn(Array(40).fill(0.2), 0.05)).toBeNull()
  })

  it('reads loudness in windows', () => {
    const plane = new Float32Array(4410).fill(0.5)
    const levels = levelsOf([plane, plane], 44100, 0.05)
    expect(levels).toHaveLength(2)
    expect(levels[0]).toBeCloseTo(0.5, 5)
  })

  it('pops the amount in', () => {
    expect(popScale(0)).toBe(0)
    expect(popScale(0.09)).toBeGreaterThan(0.5)
    expect(popScale(1)).toBe(1)
  })
})
