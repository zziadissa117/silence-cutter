import { describe, expect, it } from 'vitest'

import { cleanNote, noteMessage } from './handNote.ts'

describe("New post's note", () => {
  it('keeps a plan in sane ranges, and the rest for the captions', () => {
    expect(cleanNote({ perDay: 2, startDate: '2026-11-04', days: 14, caption: 'mention the free trial' }, 'x', '2026-11-03')).toEqual({
      plan: { perDay: 2, startDate: '2026-11-04', days: 14 },
      caption: 'mention the free trial',
    })
  })

  it('no schedule in the note: no plan; a start in the past is today', () => {
    expect(cleanNote({ perDay: null, startDate: null, days: null, caption: 'funny tone' }, 'funny tone', '2026-11-03').plan).toBeNull()
    expect(cleanNote({ perDay: 1, startDate: '2026-10-01', days: null, caption: '' }, 'x', '2026-11-03').plan).toEqual({ perDay: 1, startDate: null, days: null })
    expect(cleanNote({ perDay: 900, startDate: 'soon', days: -1, caption: '' }, 'x', '2026-11-03').plan).toBeNull()
  })

  it('an answer it could not read keeps the whole note for the captions', () => {
    expect(cleanNote(null, '2 a day, funny tone', '2026-11-03')).toEqual({ plan: null, caption: '2 a day, funny tone' })
  })

  it('tells Claude today and the count', () => {
    expect(noteMessage('2 per day', '2026-11-03', 'Tuesday', 14)).toContain('Today is Tuesday 2026-11-03.')
  })
})
