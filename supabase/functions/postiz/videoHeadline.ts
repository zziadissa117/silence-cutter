// The headline over a talking video, written by Claude from what he says in
// it - not his first line. His ask (2026-11-04): "Stop automatically putting
// the headline as the first line ... take a sort of summary of the whole
// video and make a headline about it that's going to grab people's
// attention. Take as an example my previous headlines."
//
// Claude is given the video's words, the campaign, and his own past
// headlines (most viewed first, when views are known), and writes one.
//
// Plain TypeScript with no imports, for Deno and the tests.

const MAX_WORDS = 12

export const VIDEO_HEADLINE_SYSTEM = `You write the headline that sits over a short vertical talking video for a brand campaign (TikTok, Instagram Reels, YouTube Shorts). It is the hook: the few words on screen in the first second that make someone stop scrolling.

You are given what the creator says in the video, the campaign's name, and headlines he has used before (most viewed first when views are known).

Write ONE headline:
- About what this video is really about - its main point or promise, taken from the whole video, not just its first sentence.
- Written to grab attention, in the style of his past headlines: their length, tone, wording, casing, use of numbers, "POV", emoji. Do not copy one of them.
- Only say what the video itself says. Never invent facts, numbers, prices or results that are not in it.
- At most ${MAX_WORDS} words, one line, no hashtags, no quotation marks around it.
- In the language the video is spoken in.

Answer with JSON only: {"headline": "..."}`

export const VIDEO_HEADLINE_SCHEMA = {
  type: 'object',
  properties: { headline: { type: 'string' } },
  required: ['headline'],
  additionalProperties: false,
}

export interface PastHeadline {
  text: string
  /** Views a video, when known. */
  views: number | null
}

/** His past headlines, each once, most viewed first, at most `max`. */
export function pastHeadlines(rows: readonly { headline: string | null; views: number | null }[], max = 30): PastHeadline[] {
  const seen = new Map<string, { text: string; views: number[] }>()
  for (const row of rows) {
    const text = (row.headline ?? '').replace(/\s+/g, ' ').trim()
    if (!text || text.length > 160) continue
    const key = text.toLowerCase()
    const entry = seen.get(key) ?? { text, views: [] }
    if (typeof row.views === 'number' && Number.isFinite(row.views)) entry.views.push(row.views)
    seen.set(key, entry)
  }
  return [...seen.values()]
    .map((e) => ({ text: e.text, views: e.views.length > 0 ? Math.round(e.views.reduce((a, b) => a + b, 0) / e.views.length) : null }))
    .sort((a, b) => (b.views ?? -1) - (a.views ?? -1))
    .slice(0, max)
}

/** What Claude is told. */
export function videoHeadlineMessage(words: string, campaign: string, past: readonly PastHeadline[]): string {
  return [
    `Campaign: ${campaign.slice(0, 120)}`,
    '',
    'His past headlines:',
    ...(past.length > 0 ? past.map((h) => `- ${h.text}${h.views !== null ? ` (${h.views} views a video)` : ''}`) : ['(none yet)']),
    '',
    'What he says in this video:',
    words.slice(0, 6000),
  ].join('\n')
}

/** Claude's answer made safe: one line, no quotes around it, not too long.
 *  Empty when there is nothing usable - the phone then uses his first line. */
export function cleanVideoHeadline(value: unknown): string {
  const raw = value && typeof value === 'object' ? (value as { headline?: unknown }).headline : null
  if (typeof raw !== 'string') return ''
  const text = raw
    .replace(/\s*#\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .trim()
  if (!text || text.length > 120 || text.split(' ').length > MAX_WORDS + 3) return ''
  return text
}
