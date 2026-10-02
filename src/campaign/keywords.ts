// Finds the moments he says the brand's name, from the words the speech model
// heard.
//
// The model on the phone is the small one, and it has never heard of most
// brands: left to itself it wrote "Inflow" as inflow, in flow, info, Enlow,
// and "Vertus" as Virtus, Virtues, Vatuz, Vetis, Verdes - a different guess
// most times. Two things fix that between them:
//
//   - the model is told the brand's name before it listens (see
//     transcribe.worker.ts), so it mostly writes it correctly. Measured on
//     14 sentences across 7 voices: Vertus 14/14, Inflow 12/14 - the other
//     two came back "Enflow".
//   - a single heard word is accepted when it SOUNDS like the name - same
//     consonants in the same order, vowels allowed to differ - which catches
//     Enflow, Virtues and Virtu's.
//
// The sound-alike match is made one heard word against one word of the name.
// Across several heard words it would find a one-word name inside ordinary
// phrases ("for this" sounds like "Vertus"), so there only the exact spelling
// counts - which still finds "in flow" for "Inflow". A name that is itself
// several words ("Sydney Sweeney") is matched word for word: each heard word
// must sound like its word of the name, so "Sidney Sweeny" counts and two
// unrelated words cannot.

import type { WordChunk } from '../media/fillerWords'

/** Lowercase letters and digits only. "Inflow's" → "inflow", "In-flow." →
 *  "inflow". */
export function squash(text: string): string {
  return text
    .toLowerCase()
    .replace(/['’]s\b/g, '')
    .replace(/[^\p{L}\p{N}]/gu, '')
}

const VOWEL = /[aeiouy]/

/** How a word sounds, roughly: its consonants in order, with the pairs a
 *  speech model mixes up (t/d, s/z, f/v, k/g, p/b) folded together, and
 *  every run of vowels reduced to one mark. "Vertus", "Virtues" and "Verdes"
 *  all come out "fartas"; "Inflow" and "Enflow" both "anfla". */
export function soundKey(word: string): string {
  let s = squash(word).replace(/[0-9]/g, '')
  s = s
    .replace(/ph/g, 'f')
    .replace(/ck/g, 'k')
    .replace(/qu/g, 'kw')
    .replace(/x/g, 'ks')
    .replace(/c(?=[eiy])/g, 's')
    .replace(/[cq]/g, 'k')
    .replace(/th/g, 't')
    .replace(/sh/g, 's')
    .replace(/gh/g, 'g')
    .replace(/b/g, 'p')
    .replace(/d/g, 't')
    .replace(/g/g, 'k')
    .replace(/v/g, 'f')
    .replace(/z/g, 's')
  let key = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    // "w" and "h" only count before a vowel: the w in "flow" and the h in
    // "oh" are not heard as consonants.
    if ((c === 'w' || c === 'h') && !VOWEL.test(s[i + 1] ?? '')) continue
    const mark = VOWEL.test(c) ? 'a' : c
    if (key[key.length - 1] !== mark) key += mark
  }
  return key
}

/** Too short to tell apart from ordinary words by sound alone. */
const MIN_KEY = 4
/** The same, for one word of a name of several words - which is already
 *  specific, since every word has to match in order. */
const MIN_WORD_KEY = 3

const MAX_JOINED = 3

/** Two mentions closer together than this are one mention - the same name
 *  matched twice, as "in flow" and "inflow". */
const SAME_MENTION_SEC = 1

/** Every moment one of `words` is said, as the time the first heard word of
 *  the match starts, in order. */
export function findMentions(heard: WordChunk[], words: string[]): number[] {
  const spellings = new Set(words.map(squash).filter((w) => w.length > 0))
  if (spellings.size === 0) return []
  const sounds = new Set(
    words.map((w) => soundKey(w)).filter((k) => k.length >= MIN_KEY),
  )
  const squashed = heard.map((w) => squash(w.text))
  // A heard word ending in 's is tried both ways: "Inflow's" is Inflow, but
  // "Virtu's" is the model's way of writing Virtus.
  const soundsLike = (text: string) =>
    sounds.has(soundKey(text)) || sounds.has(soundKey(text.replace(/['’]/g, '')))

  // Names of more than one word, as the key of each word in turn.
  const phrases = words
    .map((w) => w.trim().split(/\s+/).filter((part) => squash(part)))
    .filter((parts) => parts.length > 1 && parts.length <= MAX_JOINED)
    .map((parts) => parts.map((part) => ({ key: soundKey(part), spelling: squash(part) })))
  const wordMatches = (heardWord: WordChunk, target: { key: string; spelling: string }) =>
    squash(heardWord.text) === target.spelling ||
    (target.key.length >= MIN_WORD_KEY &&
      (soundKey(heardWord.text) === target.key || soundKey(heardWord.text.replace(/['’]/g, '')) === target.key))

  const hits: number[] = []
  for (let i = 0; i < heard.length; i++) {
    if (!squashed[i]) continue
    if (soundsLike(heard[i].text)) {
      hits.push(heard[i].start)
      continue
    }
    if (phrases.some((parts) => i + parts.length <= heard.length && parts.every((part, k) => wordMatches(heard[i + k], part)))) {
      hits.push(heard[i].start)
      continue
    }
    let joined = ''
    for (let j = i; j < Math.min(heard.length, i + MAX_JOINED); j++) {
      joined += squashed[j]
      if (spellings.has(joined)) {
        hits.push(heard[i].start)
        break
      }
    }
  }

  hits.sort((a, b) => a - b)
  const distinct: number[] = []
  for (const t of hits) {
    if (distinct.length === 0 || t - distinct[distinct.length - 1] >= SAME_MENTION_SEC) distinct.push(t)
  }
  return distinct
}

/** The mentions that fire: all of them, or only the first. */
export function firing(mentions: number[], which: 'first' | 'every'): number[] {
  return which === 'first' ? mentions.slice(0, 1) : mentions
}

/** What the speech model is told before it listens: the names, spelled the
 *  way he typed them. Whisper takes this as text that came just before, and
 *  writes those names the same way when it hears them. */
export function listeningPrompt(words: string[]): string {
  // The first spelling of each wins - the campaign's brand name comes first.
  const names = new Map<string, string>()
  for (const word of words) {
    const key = squash(word)
    if (key && !names.has(key)) names.set(key, word.trim())
  }
  return names.size > 0 ? `${[...names.values()].join(', ')}.` : ''
}
