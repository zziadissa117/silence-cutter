import { describe, expect, it } from 'vitest'

import { carryOver, cleanCaptions, cleanRepost, repostDueAt, textFor, variationNote } from './repost.ts'

describe('cleanRepost', () => {
  it('is off unless turned on, and keeps days sane', () => {
    expect(cleanRepost(undefined)).toEqual({ on: false, afterDays: 7 })
    expect(cleanRepost({ on: true, afterDays: 14 })).toEqual({ on: true, afterDays: 14 })
    expect(cleanRepost({ on: true, afterDays: 400 })).toEqual({ on: true, afterDays: 7 })
    expect(cleanRepost({ on: 'yes' }).on).toBe(false)
  })
})

describe('repostDueAt', () => {
  it('is null when off and days later when on', () => {
    expect(repostDueAt(1000, { on: false, afterDays: 7 })).toBeNull()
    expect(repostDueAt(0, undefined)).toBeNull()
    expect(repostDueAt(0, { on: true, afterDays: 2 })).toBe(2 * 86_400_000)
  })
})

describe('textFor', () => {
  const post = { caption: 'one', title: 't', captions: { a: { caption: 'for a' } } }
  it('uses the account own text, else the post', () => {
    expect(textFor(post, 'a')).toEqual({ caption: 'for a', title: 't' })
    expect(textFor(post, 'b')).toEqual({ caption: 'one', title: 't' })
    expect(textFor({ ...post, captions: null }, 'a').caption).toBe('one')
  })
})

describe('cleanCaptions', () => {
  it('keeps real strings, drops junk, applies the rules', () => {
    const out = cleanCaptions({ a: { caption: ' hi ' }, 'bad id!': { caption: 'x' }, b: { caption: '   ' }, c: 5 }, (c) => c.trim() + '!')
    expect(out).toEqual({ a: { caption: 'hi!' } })
  })
  it('an empty or missing map clears them', () => {
    expect(cleanCaptions(null, (c) => c)).toEqual({})
    expect(cleanCaptions({}, (c) => c)).toEqual({})
  })
})

describe('variationNote', () => {
  it('quotes the earlier caption and asks for a different one', () => {
    expect(variationNote('Old words')).toContain('Old words')
    expect(variationNote('Old words')).toContain('different')
    expect(variationNote(null)).toBe('')
  })
})

describe('carryOver', () => {
  it('keeps the caption, title and per-account captions, with the rules applied', () => {
    const out = carryOver({ caption: ' Hi ', title: 'T', captions: { a: { caption: 'x' } } }, (c) => c.trim() + '!')
    expect(out).toEqual({ caption: 'Hi!', title: 'T', captions: { a: { caption: 'x!' } } })
  })
  it('is null when there is nothing to keep', () => {
    expect(carryOver(undefined, (c) => c)).toBeNull()
    expect(carryOver({ caption: '  ' }, (c) => c)).toBeNull()
  })
})
