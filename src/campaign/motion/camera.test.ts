// The shot moving with the graphics: a push-in as it opens, punch-ins as big
// moments land over his face - never while the board covers it.

import { describe, expect, it } from 'vitest'

import { cleanStoryboard } from '../../../supabase/functions/postiz/motion'
import { MAX_PUNCHES, motionCamera, punchMoments } from './camera'

const start = (i: number) => i * 0.5
const board = cleanStoryboard(
  {
    format: 'board',
    hook: { at: 0, to: 4, label: 'a day', text: '$300' },
    scenes: [
      { from: 10, to: 16, says: '', parts: [{ kind: 'pop', at: 10, to: 16, text: 'One video', tone: 'dark' }] },
      { from: 20, to: 34, says: '', parts: [{ kind: 'number', at: 22, label: 'a day', text: '$300' }] },
      { from: 40, to: 46, says: '', parts: [{ kind: 'pop', at: 41, to: 46, text: 'Goes viral', tone: 'red' }] },
      { from: 48, to: 52, says: '', parts: [{ kind: 'pop', at: 48, to: 52, text: 'Too close', tone: 'red' }] },
    ],
    end: { at: 60, text: 'Save this' },
  },
  70,
)

describe('the shot punching in as a big moment lands', () => {
  it('on cards over his face and the call to action - not under the board, not in the opening push-in', () => {
    // Hook at 0 s: the push-in's. Pop at 5 s, the board's number skipped,
    // pop at 20.5 s, the one 3.5 s later too close, the call to action at 30 s.
    expect(punchMoments(board, start)).toEqual([5, 20.5, 30])
  })

  it('in the glass look on the stat, the marked tag, the picture, the blocks clearing', () => {
    const glass = cleanStoryboard(
      {
        format: 'glass',
        scenes: [
          { from: 10, to: 16, says: '', parts: [{ kind: 'stat', at: 10, to: 16, place: 'face', tag: '', text: '2x', sub: '' }] },
          { from: 30, to: 36, says: '', parts: [{ kind: 'tag', at: 30, to: 36, place: 'face', label: '', text: 'no filler', mark: '' }] },
          { from: 40, to: 50, says: '', parts: [{ kind: 'blocks', at: 40, to: 50, place: 'face', title: 'dead space', tag: '', after: { at: 46, text: 'gone' } }] },
        ],
        end: null,
      },
      70,
    )
    // The tag without a marked word is no big moment; the call to action the
    // Cutter always adds is the last.
    expect(punchMoments(glass, start)).toEqual([5, 23, start(glass.end!.at)])
  })

  it('at most a handful in a video', () => {
    const many = cleanStoryboard(
      {
        format: 'board',
        scenes: Array.from({ length: 12 }, (_, k) => ({ from: 10 + k * 14, to: 16 + k * 14, says: '', parts: [{ kind: 'pop', at: 10 + k * 14, to: 16 + k * 14, text: 'x', tone: 'dark' }] })),
        end: null,
      },
      200,
    )
    expect(punchMoments(many, start).length).toBe(MAX_PUNCHES)
  })

  it('the preview moves like the video: pushed in through the opening, closer as a moment lands', () => {
    const camera = motionCamera(board, start, [{ start: 0, end: 40 }], 'seed')
    expect(camera.at(0).scale).toBe(1)
    expect(camera.at(2.9).scale).toBeGreaterThan(1.04)
    // A punch, on the finished video's clock.
    expect(camera.at(20.5 + 0.3).scale).toBeGreaterThan(camera.at(20.5 - 0.3).scale)
  })
})
