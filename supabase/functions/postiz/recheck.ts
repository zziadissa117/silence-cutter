// Claude's look at the burned-in captions with the video's context - the
// campaign, the brand, the angle, the headline, the whole video: putting back
// what the phone's small speech model misheard, by meaning as well as sound
// (his words, 2026-10-29: "check the logic of them", the way a person who
// knows the context would), never rewriting what was said. Pure rules around the model call, so they can be tested. No
// imports.

export const RECHECK_SYSTEM = `You check the captions burned into a short video a creator spoke to camera. A small speech-to-text model on his phone wrote them. It hears sounds, not meaning: it writes brand and product names as ordinary words ("virtues" for Vertus), splits or joins words, mishears numbers and amounts ("twenty case" for 20K), and picks the wrong word of two that sound alike ("by" for "buy", "their" for "there").

You are given what the video is for - the campaign, the brand and what it does, the angle, the headline on screen, how this campaign's earlier videos were described - and the whole video's captions as a numbered list of phrases, in order.

First understand what he is saying, the way a person who knows the brand and listens to the whole video would. Then return the same list, same order, same number of phrases, with every word the speech model got wrong put back to what he really said. Judge by meaning: a word that sounds like what he said but makes no sense in that sentence, for this video, is wrong.

Rules:
- Fix only what was misheard. Never reword what he really said, never "improve" his grammar, slang or style, never add or drop a thought, never translate. If he said it, it stays, even if it is clumsy.
- Never add, remove, merge or split phrases. Never reorder them.
- Brand, product and people's names spelled exactly as the brand writes them.
- Amounts and numbers as a viewer reads them best ("20K", "$500", "3x").
- If you are not sure what he said, leave the phrase exactly as given.
- Keep casing and punctuation as given, except where a fix needs its own (a name's capitals).
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

/** Takes Claude's version of a phrase only when it is what was said put
 *  right and not a rewrite: a misheard word or two put back by the sense of
 *  the video ("twenty case" to "20K", "by" to "buy"), at most two words more
 *  or fewer, and the phrase mostly the same letters. Otherwise the phrase
 *  stays as it was heard. */
export function acceptFix(original: string, fixed: unknown): string {
  if (typeof fixed !== 'string') return original
  const next = fixed.replace(/\s+/g, ' ').trim()
  if (!next || next === original) return original
  const a = norm(original)
  const b = norm(next)
  if (a === b) return next // only capitals or punctuation changed
  const words = (s: string) => (s ? s.split(' ').length : 0)
  if (Math.abs(words(a) - words(b)) > 2) return original
  const longest = Math.max(a.length, b.length)
  // A fix changes a word or two, not the sentence.
  if (distance(a, b) > Math.max(6, Math.floor(longest * 0.4))) return original
  return next
}

/** Dollars per million tokens for the model the function uses (claude-opus-5,
 *  Anthropic's published price, checked 2026-09-25). */
export const PRICE_PER_MTOK = { input: 5, output: 25 }

/** What a call cost, in cents, from the token counts the API reported. */
export function costCents(inputTokens: number, outputTokens: number): number {
  return ((inputTokens * PRICE_PER_MTOK.input + outputTokens * PRICE_PER_MTOK.output) / 1_000_000) * 100
}

/** What a video is for, as the phone knows it: what Claude needs to hear the
 *  captions the way he meant them. Every field cut to a sane length. */
export interface RecheckContext {
  campaign: string
  brand: string[]
  /** The brand's own caption rules - usually what it is and does. */
  about: string
  angle: string
  headline: string
}

export function cleanContext(value: unknown): RecheckContext {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const text = (x: unknown, most: number) => (typeof x === 'string' ? x.trim().slice(0, most) : '')
  return {
    campaign: text(v.campaign, 120),
    brand: (Array.isArray(v.brand) ? v.brand : []).filter((b): b is string => typeof b === 'string' && b.trim() !== '').slice(0, 20).map((b) => b.trim().slice(0, 60)),
    about: text(v.about, 2000),
    angle: text(v.angle, 120),
    headline: text(v.headline, 300),
  }
}

/** The message Claude reads: what the video is for, then its captions. */
export function recheckMessage(context: RecheckContext, vocabulary: readonly string[], earlier: readonly string[], phrases: readonly string[]): string {
  const lines = [
    context.campaign ? `Campaign: ${context.campaign}` : '',
    context.brand.length > 0 ? `Brand, as it is written: ${context.brand.join(', ')}` : '',
    context.about ? `About the brand and its videos (the brand's own rules):\n${context.about}` : '',
    context.angle ? `Angle of this video: ${context.angle}` : '',
    context.headline ? `Headline on screen: ${context.headline}` : '',
    `Names and terms this video is likely to use: ${vocabulary.length > 0 ? vocabulary.join(', ') : '(none given)'}`,
    earlier.length > 0 ? `How this campaign's earlier videos were described:\n${earlier.map((c) => `- ${c}`).join('\n')}` : '',
  ].filter(Boolean)
  return `${lines.join('\n\n')}\n\nCaptions:\n${phrases.map((p, i) => `${i + 1}. ${p}`).join('\n')}`
}
