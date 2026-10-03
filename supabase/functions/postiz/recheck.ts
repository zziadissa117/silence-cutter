// Claude's second look at the burned-in captions: fixing words the phone's
// small speech model misheard (names, brands, products), never rewriting what
// was said. Pure rules around the model call, so they can be tested. No
// imports.

export const RECHECK_SYSTEM = `You check the captions of a short video that a creator spoke. They were written by a small speech-to-text model, which mishears brand names, product names, people's names and unusual words.

You are given the captions as a numbered list of phrases, in order, and a vocabulary: names and terms this video is likely to use.

Return the same list, same order, same number of phrases, fixing only words that were clearly misheard. A fix must stay close to what the model wrote in sound and spelling (for example "pump fund" to "Pump.fun" when that is in the vocabulary).

Rules:
- Never add, remove, merge or split phrases. Never reorder them.
- Never add words that were not spoken, never remove words, never reword, never "improve" grammar or style, never translate.
- Fix a spelling only when you are confident. If you are not sure, return the phrase exactly as given.
- Keep casing and punctuation as given, except for fixing a word's own spelling and capitalisation (a name's capital letter).
- A phrase that is already right comes back unchanged.`

export const RECHECK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['phrases'],
  properties: { phrases: { type: 'array', items: { type: 'string' } } },
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/** Edit distance between two strings. */
export function distance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let last = prev[0]
    prev[0] = i
    for (let j = 1; j <= b.length; j++) {
      const old = prev[j]
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, last + (a[i - 1] === b[j - 1] ? 0 : 1))
      last = old
    }
  }
  return prev[b.length]
}

/** Takes Claude's version of a phrase only when it is a spelling fix and not
 *  a rewrite: nearly the same letters, and at most one word more or fewer
 *  (a name written as two words that is really one). Otherwise the phrase
 *  stays as it was heard. */
export function acceptFix(original: string, fixed: unknown): string {
  if (typeof fixed !== 'string') return original
  const next = fixed.replace(/\s+/g, ' ').trim()
  if (!next || next === original) return original
  const a = norm(original)
  const b = norm(next)
  if (a === b) return next // only capitals or punctuation changed
  const words = (s: string) => (s ? s.split(' ').length : 0)
  if (Math.abs(words(a) - words(b)) > 1) return original
  const longest = Math.max(a.length, b.length)
  // A fix changes a few letters, not the sentence.
  if (distance(a, b) > Math.max(3, Math.floor(longest * 0.25))) return original
  return next
}

/** Dollars per million tokens for the model the function uses (claude-opus-5,
 *  Anthropic's published price, checked 2026-09-25). */
export const PRICE_PER_MTOK = { input: 5, output: 25 }

/** What a call cost, in cents, from the token counts the API reported. */
export function costCents(inputTokens: number, outputTokens: number): number {
  return ((inputTokens * PRICE_PER_MTOK.input + outputTokens * PRICE_PER_MTOK.output) / 1_000_000) * 100
}
