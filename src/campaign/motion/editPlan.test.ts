// Changing the plan by hand: every text a moment shows, changed in place;
// a moment taken out; the call to action always stays.

import { describe, expect, it } from 'vitest'

import { cleanStoryboard } from '../../../supabase/functions/postiz/motion'
import { fieldsOf, removable, withField, withoutSpot } from './editPlan'

const board = cleanStoryboard(
  {
    format: 'board',
    hook: { at: 0, to: 3, label: 'a day', text: '$300' },
    scenes: [
      { from: 4, to: 8, says: 'A card over your face.', parts: [{ kind: 'pop', at: 4, to: 8, text: 'One video, then wait', tone: 'dark' }] },
      {
        from: 10,
        to: 20,
        says: 'The math.',
        parts: [
          { kind: 'title', at: 10, text: 'The math' },
          { kind: 'math', at: 11, lines: [{ text: '50 videos', at: 11 }, { text: '× 1,500 views', at: 12 }], result: { text: '= $300 / day', at: 14 } },
        ],
      },
    ],
    end: { at: 25, text: 'Comment "UGC"' },
  },
  30,
)

describe('changing the plan by hand', () => {
  it('lists every text a moment shows, numbered when it has several graphics', () => {
    expect(fieldsOf(board, { kind: 'scene', index: 0 }).map((f) => [f.label, f.value])).toEqual([['Card', 'One video, then wait']])
    expect(fieldsOf(board, { kind: 'scene', index: 1 }).map((f) => f.label)).toEqual(['1. Title', '2. Line 1', '2. Line 2', '2. Result'])
    expect(fieldsOf(board, { kind: 'hook' }).map((f) => f.value)).toEqual(['$300', 'a day'])
    expect(fieldsOf(board, { kind: 'end' }).map((f) => f.value)).toEqual(['Comment "UGC"'])
  })

  it('changes the one text, and the list line says what it shows now', () => {
    const next = withField(board, { kind: 'scene', index: 1 }, 'parts.1.result.text', '= $310 / day')
    const math = next.scenes[1].parts[1]
    expect(math.kind === 'math' && math.result.text).toBe('= $310 / day')
    expect(next.scenes[1].says).toContain('= $310 / day')
    // Nothing else moved; the old plan is untouched.
    expect(next.scenes[0]).toBe(board.scenes[0])
    const was = board.scenes[1].parts[1]
    expect(was.kind === 'math' && was.result.text).toBe('= $300 / day')
  })

  it("never empties a graphic's main words, but a small line can go", () => {
    expect(withField(board, { kind: 'scene', index: 0 }, 'parts.0.text', '   ')).toBe(board)
    expect(withField(board, { kind: 'hook' }, 'label', '').hook?.label).toBe('')
    expect(withField(board, { kind: 'end' }, 'text', 'Save this for later').end?.text).toBe('Save this for later')
  })

  it('only changes texts that are there', () => {
    expect(withField(board, { kind: 'scene', index: 0 }, 'parts.0.at', '3')).toBe(board)
    expect(withField(board, { kind: 'scene', index: 5 }, 'parts.0.text', 'x')).toBe(board)
  })

  it("a comparison's two sides, each changeable", () => {
    const glass = cleanStoryboard(
      { format: 'glass', scenes: [{ from: 2, to: 14, says: '', parts: [{ kind: 'compare', at: 2, to: 14, left: { label: 'most people', text: '1 video a week' }, right: { label: 'me', text: '25 a day', at: 8 } }] }] },
      20,
    )
    expect(fieldsOf(glass, { kind: 'scene', index: 0 }).map((f) => f.label)).toEqual(['Left, small line', 'Left (crossed out)', 'Right, small line', 'Right (ticked)'])
    const next = withField(glass, { kind: 'scene', index: 0 }, 'parts.0.right.text', '30 a day')
    expect(next.scenes[0].parts[0]).toMatchObject({ right: { text: '30 a day', at: 8 } })
  })

  it('takes a moment out, but never the call to action', () => {
    expect(withoutSpot(board, { kind: 'scene', index: 0 }).scenes.map((s) => s.says)).toEqual(['The math.'])
    expect(withoutSpot(board, { kind: 'hook' }).hook).toBeNull()
    expect(removable({ kind: 'end' })).toBe(false)
    expect(withoutSpot(board, { kind: 'end' }).end).toEqual(board.end)
  })
})
