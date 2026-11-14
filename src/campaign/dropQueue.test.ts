// Where a talking head's edited clip goes, and the batch once he approves it
// (his reports, 2026-11-13).

import { beforeEach, describe, expect, it } from 'vitest'

import type { BatchBank } from './batch'
import {
  addToQueue,
  checkedClip,
  checkOrder,
  clipsOfFormat,
  fileIn,
  HOOK,
  loadQueue,
  notEdited,
  placeOf,
  placed,
  queueRecheck,
  sameRecording,
  soundsElsewhere,
  suggestPlace,
  type ToCheck,
} from './dropQueue'

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

describe('where every clip of the batch is, looked at again (his ask, 2026-11-14)', () => {
  beforeEach(() => localStorage.clear())
  const words = (text: string) => text.split(' ').map((t, i) => ({ text: t, start: i, end: i + 0.5 }))

  it("points out a clip whose words say another step - a hook only when they clearly do", () => {
    expect(soundsElsewhere('so nope do this instead', steps, 's2')).toBe('s1')
    expect(soundsElsewhere('so nope do this instead', steps, 's1')).toBeNull()
    expect(soundsElsewhere('hello there everyone', steps, 's1')).toBeNull()
    expect(soundsElsewhere('', steps, 's1')).toBeNull()
    expect(soundsElsewhere('nope do this instead', steps, HOOK)).toBe('s1')
    // A hook that names a step in passing stays a hook.
    expect(soundsElsewhere('nope you should open it', steps, 's1')).toBe('s2')
    expect(soundsElsewhere('nope you should open it', steps, HOOK)).toBeNull()
  })

  it('lists every clip with where it is, what it says, and the step it sounds like - to the check, staying where it is', () => {
    const b = bank()
    b.steps![1].files.push({ id: 'wrong', name: 'w.mp4', type: 'video/mp4', size: 1 })
    const heard: Record<string, string> = { a: 'nope do this instead', wrong: 'nope do this instead' }
    const clips = clipsOfFormat(b.steps!, b.reactions, (f) => (heard[f.id] ? words(heard[f.id]) : null))
    expect(clips.map((c) => [c.file.id, c.place, c.elsewhere, c.words !== null])).toEqual([
      ['a', 's1', null, true],
      ['raw', 's2', null, false],
      ['wrong', 's2', 's1', true],
      ['h1', HOOK, null, false],
    ])
    queueRecheck('t', clips)
    queueRecheck('t', clips)
    const queue = loadQueue('t')
    expect(queue).toHaveLength(4)
    // The one that may be in the wrong step first.
    expect(checkOrder(queue)[0]).toMatchObject({ file: { id: 'wrong' }, place: 's2', sure: false, hint: 's1', recheck: true, text: 'nope do this instead' })
    // Never heard: heard on the check.
    expect(queue.find((q) => q.file.id === 'raw')).toMatchObject({ place: 's2', sure: true, unheard: true, words: [], text: '' })
  })

  it('a clip he checked is known as checked', () => {
    const file = { id: 'x', name: 'x.mp4', type: 'video/mp4', size: 1 }
    expect(checkedClip(file)).toBe(false)
    expect(checkedClip({ ...file, captions: [] })).toBe(true)
    expect(checkedClip({ ...file, checked: true })).toBe(true)
  })

  it('an older clip edited again goes back where it is - marked when its words now say another step', () => {
    expect(suggestPlace(bank(), steps, 'nope do this instead', { replaces: 'raw', hooks: false })).toEqual({ place: 's2', sure: false, hint: 's1' })
    expect(suggestPlace(bank(), steps, 'open the app now', { replaces: 'raw', hooks: false })).toEqual({ place: 's2', sure: true })
  })

  it('approved where it is, it keeps its spot; a hook moved to a step loses its hook marks', () => {
    const b = bank()
    b.steps![0].files.push({ id: 'b', name: 'b.mp4', type: 'video/mp4', size: 1 })
    const kept = placed(b, 't', { ...b.steps![0].files[0], checked: true }, 's1')
    expect(kept.steps![0].files.map((f) => [f.id, f.checked ?? false])).toEqual([
      ['a', true],
      ['b', false],
    ])
    const hookKept = placed(b, 't', { ...b.reactions[0], checked: true }, HOOK)
    expect(hookKept.reactions).toEqual([expect.objectContaining({ id: 'h1', checked: true, formats: ['t'], talks: true })])
    const moved = placed(b, 't', b.reactions[0], 's2')
    expect(moved.reactions).toEqual([])
    expect(moved.steps![1].files.at(-1)).toEqual({ id: 'h1', name: 'hook.mov', type: 'video/quicktime', size: 1, fp: 'fp-hook' })
    expect(fileIn(b, 'raw')?.name).toBe('raw.mov')
    expect(fileIn(b, 'h1')?.name).toBe('hook.mov')
    expect(fileIn(b, 'nope')).toBeNull()
  })
})
