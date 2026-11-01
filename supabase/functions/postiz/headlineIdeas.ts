// New headlines like the ones that work, for him to pick from (Analytics,
// What works, "Write more like the best"). His pick (2026-11-01): Claude
// drafts headlines in the style of the ★ Best ones and he taps the ones to
// add - nothing goes into a batch without his tap.
//
// Claude is shown the campaign's headlines with their views a video, best
// first (hookInsights.ts), and every headline the batch has now, so it
// doesn't write one he already has.
//
// Plain TypeScript with no imports, for Deno and the tests.

export const IDEAS = 8
const MAX_WORDS = 14

export const IDEAS_SYSTEM = `You write the headline that sits over a short vertical video for a brand campaign (TikTok, Instagram Reels, YouTube Shorts). The headline is the hook: the few words on screen in the first second that make someone stop scrolling.

You are given the campaign's name, its headlines with how many views a video each one gets (best first), and the headlines it already has.

Write new headlines that would do as well as the best ones:
- Take what the best ones have in common - their angle, promise, wording, length, tone, use of numbers or "POV", casing, emoji - and write fresh ones in that style. Do not copy them, and do not repeat any headline it already has, even reworded slightly.
- Steer away from what the weakest ones do.
- Each one short: at most ${MAX_WORDS} words, one line, no hashtags, no quotation marks around it.
- Only say what the existing headlines already claim about the product. Never invent new facts, numbers, prices, features or results the existing headlines don't support.
- Write in the same language as the existing headlines.

Answer with JSON only: {"headlines": ["...", "..."]} with ${IDEAS} headlines.`

export const IDEAS_SCHEMA = {
  type: 'object',
  properties: { headlines: { type: 'array', items: { type: 'string' } } },
  required: ['headlines'],
  additionalProperties: false,
}

export interface ScoredHeadline {
  text: string
  views: number
  videos: number
}

/** What Claude is told: the campaign, how its headlines do, what it has. */
export function ideasMessage(campaign: string, scored: readonly ScoredHeadline[], have: readonly string[]): string {
  const lines = scored.slice(0, 30).map((h) => `- "${h.text}" - ${h.views} views a video (${h.videos} videos)`)
  return [
    `Campaign: ${campaign.slice(0, 120)}`,
    '',
    'Its headlines, best first:',
    ...(lines.length > 0 ? lines : ['(no numbers yet)']),
    '',
    'Headlines it already has:',
    ...have.slice(0, 200).map((h) => `- ${h}`),
  ].join('\n')
}

const key = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}$]+/gu, ' ').trim()

/** Claude's answer made safe: strings only, one line, trimmed of quotes, not
 *  too long, none he already has or twice. */
export function cleanIdeas(value: unknown, have: readonly string[]): string[] {
  const list = value && typeof value === 'object' && Array.isArray((value as { headlines?: unknown }).headlines) ? (value as { headlines: unknown[] }).headlines : []
  const seen = new Set(have.map(key))
  const out: string[] = []
  for (const item of list) {
    if (typeof item !== 'string') continue
    const text = item
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
      .trim()
    if (!text || text.length > 120 || text.split(' ').length > MAX_WORDS + 2) continue
    if (seen.has(key(text))) continue
    seen.add(key(text))
    out.push(text)
  }
  return out.slice(0, IDEAS)
}
