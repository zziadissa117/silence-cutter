// Where a talking head's edited clip goes, and the batch once he approves it
// (his reports, 2026-11-13).

import { beforeEach, describe, expect, it } from 'vitest'

import type { BatchBank } from './batch'
import { addToQueue, checkOrder, HOOK, loadQueue, notEdited, placeOf, placed, sameRecording, suggestPlace, type ToCheck } from './dropQueue'

const bank = (): BatchBank =>
  ({
    reactions: [{ id: 'h1', name: 'hook.mov', type: 'video/quicktime', size: 1, formats: ['t'], talks: true, fp: 'fp-hook' }],
    steps: [
      { id: 's1', name: 'Nope, do this instead', formats: ['t'], files: [{ id: 'a', name: 'a.mp4', type: 'video/mp4', size: 1, from: 'fp-a', edited: true }] },
      { id: 's2', name: 'Open the app', formats: ['t'], files: [{ id: 'raw', name: 'raw.mov', type: 'video/quicktime', size: 1, fp: 'fp-raw' }] },
    ],
  }) as unknown as BatchBank

const steps = bank().steps!

describe('where an edited clip goes', () => {
  it('where he asked; else where the clip it replaces is; else the step whose name he says - his hooks when none fits and the format takes them', () => {
    expect(suggestPlace(bank(), steps, 'anything', { to: 's2', hooks: false })).toEqual({ place: 's2', sure: true })
    expect(suggestPlace(bank(), steps, 'anything', { replaces: 'raw', hooks: false })).toEqual({ place: 's2', sure: true })
    expect(suggestPlace(bank(), steps, 'nope do this instead', { hooks: false })).toEqual({ place: 's1', sure: true })
    expect(suggestPlace(bank(), steps, 'hello there everyone', { hooks: false })).toEqual({ place: null, sure: false })
    expect(suggestPlace(bank(), steps, 'hello there everyone', { hooks: true })).toEqual({ place: HOOK, sure: true })
  })

  it('finds the same recording in the batch: cut from it before, or added as filmed', () => {
    expect(sameRecording(bank(), 't', 'fp-a')?.id).toBe('a')
    expect(sameRecording(bank(), 't', 'fp-raw')?.id).toBe('raw')
    expect(sameRecording(bank(), 't', 'fp-hook')?.id).toBe('h1')
    expect(sameRecording(bank(), 'other', 'fp-hook')).toBeNull()
    expect(placeOf(bank(), 'raw')).toBe('s2')
    expect(placeOf(bank(), 'h1')).toBe(HOOK)
    expect(placeOf(bank(), 'nope')).toBeNull()
  })

  it('puts an approved clip in its place, out of everywhere else, in place of the clip it replaces', () => {
    const clip = { id: 'new', name: 'raw.mp4', type: 'video/mp4', size: 1, edited: true }
    const after = placed(bank(), 't', clip, 's2', 'raw')
    expect(after.steps![1].files.map((f) => f.id)).toEqual(['new'])
    const hooked = placed(after, 't', clip, HOOK)
    expect(hooked.steps![1].files).toEqual([])
    expect(hooked.reactions.map((r) => [r.id, r.formats, r.talks])).toEqual([
      ['h1', ['t'], true],
      ['new', ['t'], true],
    ])
  })

  it('the clips still as he filmed them: steps, and hooks unless he keeps them raw', () => {
    const b = bank()
    expect(notEdited(b.steps!, b.reactions).map((f) => f.id)).toEqual(['raw', 'h1'])
    expect(notEdited(b.steps!, []).map((f) => f.id)).toEqual(['raw'])
  })
})

describe('the clips waiting for his check', () => {
  beforeEach(() => localStorage.clear())
  const item = (id: string, place: string | null, sure: boolean): ToCheck => ({ file: { id, name: id, type: 'video/mp4', size: 1 }, name: id, text: '', words: [], place, sure })

  it('kept per format, a clip once; the ones it was not sure of first', () => {
    addToQueue('t', item('x', 's1', true))
    addToQueue('t', item('y', null, false))
    addToQueue('t', item('x', 's2', true))
    expect(loadQueue('t').map((q) => [q.file.id, q.place])).toEqual([
      ['y', null],
      ['x', 's2'],
    ])
    expect(loadQueue('other')).toEqual([])
    expect(checkOrder([item('a', 's1', true), item('b', 's1', false), item('c', null, true)]).map((q) => q.file.id)).toEqual(['b', 'c', 'a'])
  })
})
