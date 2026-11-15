import { describe, expect, it } from 'vitest'

import type { BankFile, BatchBank } from './batch'
import { atSpeed, captionsAtSpeed, clipsToSpeed, filesOfClip, leftBehind, swapClip, wantedSpeed } from './clipEdit'

const file = (id: string, more: Partial<BankFile> = {}): BankFile => ({ id, name: `${id}.mp4`, type: 'video/mp4', size: 1, ...more })

describe("a talking head's clips changed after they are in the batch (his ask, 2026-11-15)", () => {
  it("each clip at the format's speed unless he set its own", () => {
    expect(wantedSpeed(file('a'), {})).toBe(1)
    expect(wantedSpeed(file('a'), { speed: 1.1 })).toBe(1.1)
    expect(wantedSpeed(file('a', { speedSet: 1.3 }), { speed: 1.1 })).toBe(1.3)
    const clips = [file('a'), file('b', { speed: 1.1, made: 2 }), file('c', { speedSet: 1, speed: 1.1, made: 2 })]
    expect(clipsToSpeed(clips, { speed: 1.1 }).map((f) => f.id)).toEqual(['a', 'c'])
    expect(clipsToSpeed(clips, {}).map((f) => f.id)).toEqual(['b', 'c'])
  })

  it('a clip sped up before the frame-rate fix is made again; one made since is left (2026-11-15)', () => {
    expect(clipsToSpeed([file('a', { speed: 1.1 }), file('b', { speed: 1.1, made: 2 }), file('c')], { speed: 1.1 }).map((f) => f.id)).toEqual(['a'])
  })

  it('every part kept plays at the speed; 1 leaves them plain', () => {
    expect(atSpeed([{ start: 1, end: 2 }], 1.1)).toEqual([{ start: 1, end: 2, speed: 1.1 }])
    expect(atSpeed([{ start: 1, end: 2, speed: 2 } as never], 1)).toEqual([{ start: 1, end: 2 }])
  })

  it('his checked captions follow the new speed', () => {
    const [w] = captionsAtSpeed([{ text: 'hi', start: 1.1, end: 2.2 }], 1, 1.1)
    expect(w.start).toBeCloseTo(1)
    expect(w.end).toBeCloseTo(2)
  })

  it('the new clip takes the old one\'s place, and the videos made with it still count', () => {
    const bank = {
      reactions: [file('h', { formats: ['t'] })],
      products: [],
      steps: [{ id: 's1', name: 'One', files: [file('a'), file('b')] }],
      used: { a: 2 },
      made: ['h|a', 'h|b', 'x|a+b'],
    } as unknown as BatchBank
    const next = swapClip(bank, 'a', file('a2'))
    expect(next.steps![0].files.map((f) => f.id)).toEqual(['a2', 'b'])
    expect(next.used).toEqual({ a2: 2 })
    expect(next.made).toEqual(['h|a2', 'h|b', 'x|a2+b'])
    expect(swapClip(bank, 'h', file('h2')).reactions.map((f) => f.id)).toEqual(['h2'])
  })

  it('its recording goes with it; an older clip made its own source stays as the source', () => {
    const recording = { fileId: 'rec', size: 1, type: 'video/mp4', keep: [], words: [], duration: 1, effects: {} as never, brandWords: [], voice: true, seed: 's' }
    expect(filesOfClip(file('a', { source: recording }))).toEqual(['a', 'rec'])
    expect(filesOfClip(file('a'))).toEqual(['a'])
    expect(leftBehind(file('a'), file('a2', { source: { ...recording, fileId: 'a', self: true } }))).toEqual([])
    expect(leftBehind(file('a', { source: recording }), file('a2', { source: recording }))).toEqual(['a'])
  })
})
