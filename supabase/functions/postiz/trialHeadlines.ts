// A talking Trial reel's headlines (his ask, 2026-11-11): one talking clip that
// did well, made again and again - "the exact same words ... the captions are
// going to be the exact same each time. The difference will be that, per
// video, the headline is going to be different." Claude writes them from what
// he says in it, in the style of his best past headlines; he crosses out the
// ones he doesn't like once, and the copies take turns with the rest.
//
// Plain TypeScript with no imports, for Deno and the tests.

import type { PastHeadline } from './videoHeadline.ts'

/** How many Claude writes: about a day's copies, each with its own. */
export const TRIAL_HEADLINES = 20
const MAX_WORDS = 12

export const TRIAL_HEADLINES_SYSTEM = `You write the headlines for copies of one short vertical talking video (Instagram Reels, posted as Trial Reels to people who don't follow the creator). Every copy has the same words spoken and the same captions; only the headline - the hook on screen in the first second - changes from copy to copy, to find the one that makes people stop scrolling.

You are given what the creator says in the video, headlines he has used before (most viewed first when views are known), and headlines this video already has.

Write the number of headlines asked for:
- Each about what the video really says - its main point, promise, surprise or claim - taken from the whole video.
- Really different from each other: different angles (a question, a bold claim, a "POV", a number, a warning, a result, curiosity), not the same sentence reworded.
- Written like a person, not like an AI: plain words, no "unlock", "game-changer", "secret weapon", "level up", no colons, no em dashes, no title case. In the style of his past headlines: their length, tone, casing, use of emoji. Never copy one of them or one this video already has.
- Only say what the video itself says. Never invent facts, numbers, prices or results.
- At most ${MAX_WORDS} words each, one line, no hashtags, no quotation marks around it.
- In the language the video is spoken in.

Answer with JSON only: {"headlines": ["...", "..."]}`

export const TRIAL_HEADLINES_SCHEMA = {
  type: 'object',
  properties: { headlines: { type: 'array', items: { type: 'string' } } },
  required: ['headlines'],
  additionalProperties: false,
} as const

/** What Claude is told. */
export function trialHeadlinesMessage(words: string, count: number, past: readonly PastHeadline[], have: readonly string[]): string {
  return [
    `Write ${count} headlines.`,
    '',
    'His past headlines:',
    ...(past.length > 0 ? past.map((h) => `- ${h.text}${h.views !== null ? ` (${h.views} views a video)` : ''}`) : ['(none yet)']),
    '',
    'Headlines this video already has:',
    ...(have.length > 0 ? have.map((h) => `- ${h}`) : ['(none)']),
    '',
    'What he says in this video:',
    words.slice(0, 6000),
  ].join('\n')
}

const key = (t: string) => t.toLowerCase().replace(/\s+/g, ' ').trim()

/** Claude's answer made safe: one line each, no quotes or hashtags, not too
 *  long, none twice or one the video already has, at most `count`. */
export function cleanTrialHeadlines(value: unknown, have: readonly string[], count = TRIAL_HEADLINES): string[] {
  const raw = value && typeof value === 'object' ? (value as { headlines?: unknown }).headlines : null
  const seen = new Set(have.map(key))
  const out: string[] = []
  for (const h of Array.isArray(raw) ? raw : []) {
    if (typeof h !== 'string') continue
    const text = h
      .replace(/\s*#\S+/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
      .trim()
    if (!text || text.split(' ').length > MAX_WORDS + 3 || text.length > 140 || seen.has(key(text))) continue
    seen.add(key(text))
    out.push(text)
    if (out.length >= count) break
  }
  return out
}
