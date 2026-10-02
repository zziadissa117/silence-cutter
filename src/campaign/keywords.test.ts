import { describe, expect, it } from 'vitest'

import { findMentions, firing, listeningPrompt, soundKey, squash } from './keywords'

const heard = (...words: [string, number][]) => words.map(([text, start]) => ({ text, start, end: start + 0.3 }))

describe('squash', () => {
  it('keeps only letters and digits, and drops a possessive', () => {
    expect(squash(' Inflow.')).toBe('inflow')
    expect(squash("Inflow's")).toBe('inflow')
    expect(squash('In-flow,')).toBe('inflow')
    expect(squash('Pump.Fun')).toBe('pumpfun')
  })
})

describe('soundKey', () => {
  it('gives the same key to the ways the model wrote the same name', () => {
    // Real spellings from whisper-tiny.en, across voices.
    expect(new Set(['Inflow', 'inflow', 'Enflow', 'influ'].map(soundKey)).size).toBe(1)
    expect(new Set(['Vertus', 'Virtus', 'Virtues', 'Verdes'].map(soundKey)).size).toBe(1)
  })

  it('keeps different words apart', () => {
    expect(soundKey('info')).not.toBe(soundKey('inflow'))
    expect(soundKey('various')).not.toBe(soundKey('vertus'))
    expect(soundKey('voters')).not.toBe(soundKey('vertus'))
  })
})

describe('findMentions', () => {
  it('finds the name as said, whatever its case and punctuation', () => {
    expect(findMentions(heard([' So', 0], [' Inflow', 0.5], [' pays.', 1]), ['inflow'])).toEqual([0.5])
  })

  it('finds the model’s own spellings of the name from the one spelling he typed', () => {
    expect(findMentions(heard([' about', 0], [' Virtues', 0.4]), ['Vertus'])).toEqual([0.4])
    expect(findMentions(heard([' about', 0], [" Virtu's", 0.4]), ['Vertus'])).toEqual([0.4])
    expect(findMentions(heard([' called', 0], [' Enflow', 0.4]), ['Inflow'])).toEqual([0.4])
    expect(findMentions(heard([' called', 0], [" Inflow's", 0.4]), ['Inflow'])).toEqual([0.4])
  })

  it('matches a name the model split in two, and one it joined', () => {
    expect(findMentions(heard([' I', 0], [' use', 0.3], [' in', 0.7], [' flow', 0.9]), ['inflow'])).toEqual([0.7])
    expect(findMentions(heard([' Inflow', 2]), ['in flow'])).toEqual([2])
  })

  it('never finds the name by sound across several words', () => {
    // "for this" sounds like "Vertus" - an everyday phrase must not bring the
    // logo up.
    expect(findMentions(heard([' for', 1], [' this', 1.2]), ['Vertus'])).toEqual([])
  })

  it('does not match ordinary words that only look a little like it', () => {
    expect(findMentions(heard([' info', 1], [' various', 3], [' voters', 5]), ['Inflow', 'Vertus'])).toEqual([])
  })

  it('finds a name of two words however the model spelled each one', () => {
    expect(findMentions(heard([' like', 0], [' Sidney', 0.5], [' Sweeny.', 0.9]), ['Sydney Sweeney'])).toEqual([0.5])
    expect(findMentions(heard([' Sydney', 2], [' Sweeney', 2.4]), ['Sydney Sweeney'])).toEqual([2])
  })

  it('does not find a two-word name from one of its words, or from words that only share sounds', () => {
    expect(findMentions(heard([' Sydney', 2], [' said', 2.4]), ['Sydney Sweeney'])).toEqual([])
    expect(findMentions(heard([' sadly', 2], [' swan', 2.4]), ['Sydney Sweeney'])).toEqual([])
  })

  it('counts the same moment once when two spellings both match it', () => {
    expect(findMentions(heard([' in', 1], [' flow', 1.2]), ['inflow', 'in flow', 'flow'])).toEqual([1])
  })

  it('returns every mention, in order', () => {
    expect(findMentions(heard([' Inflow', 1], [' is', 1.5], [' great', 2], [' Enflow', 9]), ['inflow'])).toEqual([1, 9])
  })

  it('finds nothing when there is nothing to listen for', () => {
    expect(findMentions(heard([' Inflow', 1]), [])).toEqual([])
    expect(findMentions(heard([' Inflow', 1]), ['  ', ','])).toEqual([])
  })
})

describe('firing', () => {
  it('keeps only the first mention unless asked for every one', () => {
    expect(firing([1, 5, 9], 'first')).toEqual([1])
    expect(firing([1, 5, 9], 'every')).toEqual([1, 5, 9])
    expect(firing([], 'first')).toEqual([])
  })
})

describe('listeningPrompt', () => {
  it('names each word once, as he typed it', () => {
    expect(listeningPrompt(['Vertus', 'vertus', ' Sydney '])).toBe('Vertus, Sydney.')
    expect(listeningPrompt([])).toBe('')
  })
})
