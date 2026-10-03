// What a post says: the caption Claude writes from what he says in the
// video, held to his rules whatever comes back.
//
// His standing rules: a caption never says it is an ad or a paid
// partnership, and every one fits the video and the campaign's niche. A
// brand's own requirements still go in - Pump.fun's #pumpfunpartner, for
// one - and those are added here if Claude leaves them out, rather than
// trusted to the prompt.
//
// Plain TypeScript with no imports, for Deno and for the unit tests.

/** A campaign's posting rules, shared by everyone who posts it. */
export interface PostingRules {
  /** Claude writes the caption, or he pastes one per post (a brand's
   *  tracking caption). */
  caption: 'claude' | 'paste'
  /** The brand's own rules for captions, as he wrote them. */
  rules: string
  /** Hashtags every post carries. */
  hashtags: string[]
  /** Who says it can go: him in the cutter, nobody (straight to Postiz),
   *  or the brand, after he sends it to them. */
  approval: 'me' | 'direct' | 'brand'
  /** A reminder when it goes live, to submit it to the brand. */
  remind: boolean
  /** Opt-in: repost the video later with a different caption (repost.ts). */
  repost?: { on: boolean; afterDays: number }
}

export const NO_RULES: PostingRules = { caption: 'claude', rules: '', hashtags: [], approval: 'me', remind: false }

/** Tags that would mark a post as paid. Never used, whatever asks for them. */
const FORBIDDEN_TAGS = new Set([
  'ad',
  'ads',
  'advert',
  'advertisement',
  'advertising',
  'sponsored',
  'sponsor',
  'sponsorship',
  'paidpartnership',
  'paidpartner',
  'paidad',
  'paidpromotion',
  'promo',
  'promotion',
  'partnership',
  'collab',
  'gifted',
])

const PAID_PHRASES = [/\bpaid partnership( with [^\n.!?#]*)?/gi, /\bsponsored by [^\n.!?#]*/gi, /\bpaid promotion\b/gi, /\bin partnership with [^\n.!?#]*/gi]

/** "#pumpfunpartner" from "pumpfunpartner", "#PumpFunPartner" or "# pumpfun partner". */
export function normalTag(tag: string): string {
  const bare = tag.trim().replace(/^#+/, '').replace(/\s+/g, '')
  return bare ? `#${bare}` : ''
}

export function isForbiddenTag(tag: string): boolean {
  return FORBIDDEN_TAGS.has(normalTag(tag).slice(1).toLowerCase())
}

const TAG = /(^|\s)#([\p{L}\p{N}_]+)/gu

function tagsIn(text: string): Set<string> {
  const found = new Set<string>()
  for (const match of text.matchAll(TAG)) found.add(match[2].toLowerCase())
  return found
}

/** The caption as it is posted: nothing that says ad or paid, and every
 *  required hashtag in it. */
export function finishCaption(text: string, required: string[]): string {
  let out = text.trim().replace(/^["“]+|["”]+$/g, '').trim()
  out = out.replace(TAG, (whole, before: string, tag: string) => (FORBIDDEN_TAGS.has(tag.toLowerCase()) ? before : whole))
  for (const phrase of PAID_PHRASES) out = out.replace(phrase, '')
  out = out
    .split('\n')
    .map((line) => line.replace(/[ \t]{2,}/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  const have = tagsIn(out)
  const missing = [...new Set(required.map(normalTag).filter(Boolean))].filter(
    (t) => !isForbiddenTag(t) && !have.has(t.slice(1).toLowerCase()),
  )
  if (missing.length > 0) {
    const endsWithTags = /#[\p{L}\p{N}_]+\s*$/u.test(out)
    out = out ? `${out}${endsWithTags ? ' ' : '\n\n'}${missing.join(' ')}` : missing.join(' ')
  }
  // Instagram and TikTok both stop at 2,200 characters.
  return out.slice(0, 2200).trim()
}

/** A caption's first line with its hashtags taken out - a title to fall
 *  back on for a post whose caption he wrote himself. */
export function captionLead(caption: string): string {
  const line = caption.split('\n').find((l) => l.replace(TAG, '$1').trim().length >= 2) ?? ''
  return line.replace(TAG, '$1').replace(/\s+/g, ' ').trim()
}

/** A YouTube title: 2 to 100 characters, no hashtags. */
export function finishTitle(title: string, fallbacks: string[]): string {
  const clean = (t: string) =>
    t
      .replace(TAG, '$1')
      .replace(/\s+/g, ' ')
      .replace(/^["“]+|["”]+$/g, '')
      .trim()
  for (const candidate of [title, ...fallbacks]) {
    const t = clean(candidate ?? '')
    if (t.length >= 2) return t.length > 100 ? `${t.slice(0, 97).trimEnd()}…` : t
  }
  return 'New video'
}

export interface CaptionInput {
  campaignName: string
  rules: string
  hashtags: string[]
  headline: string
  transcript: string
  /** What the video is about, as he put it - for a finished video he posts
   *  by hand, which was never listened to. */
  about?: string
  /** How many stills from the video come with the request. */
  stills?: number
}

export const CAPTION_SYSTEM = `You write the caption for a short vertical video that a creator posts on TikTok, Instagram Reels, YouTube Shorts and Facebook for a brand campaign he works on.

How a caption reads:
- It fits this video: it builds on what he actually says in it, in his voice - first person, casual, like a creator talking to his followers, not like a brand.
- Short: one or two lines of text, then the hashtags on their own line.
- Three to six hashtags that fit the video's topic and the campaign's niche, the kind people in that niche search for. Lowercase is fine.
- No quotation marks around the caption. At most one or two emojis, and none is fine.
- Never say or imply it is an ad, sponsored, a paid partnership or a promotion, and never use hashtags like #ad, #sponsored or #paidpartnership. The only exception is a hashtag the campaign's rules require by name.
- If the campaign's rules give wording to use, use it - varied from video to video when the rules ask for variations.
- Don't invent facts, prices, results or claims he doesn't make in the video.

The title is for YouTube Shorts: under 80 characters, no hashtags, a hook taken from the video.`

/** What Claude is asked, for one video. */
export function captionRequest(input: CaptionInput): string {
  const lines = [
    `Campaign: ${input.campaignName}`,
    `The campaign's rules for captions: ${input.rules.trim() || 'none beyond the usual.'}`,
    input.hashtags.length > 0
      ? `Hashtags every post must carry (they will be added if missing): ${input.hashtags.map(normalTag).join(' ')}`
      : '',
    input.headline.trim() ? `The headline written on the video: ${input.headline.trim()}` : '',
    input.about?.trim() ? `What the video is about, as he describes it: ${input.about.trim()}` : '',
    input.stills
      ? `${input.stills === 1 ? 'A still' : `${input.stills} stills`} from the video ${input.stills === 1 ? 'is' : 'are'} attached, in order. Read any text on screen - the hook is usually written there - and write from what the video shows.`
      : '',
    input.transcript.trim() || !input.about?.trim() ? `What he says in the video: ${input.transcript.trim() || '(no words were heard)'}` : '',
  ]
  return lines.filter(Boolean).join('\n')
}

export const CAPTION_SCHEMA = {
  type: 'object',
  properties: {
    caption: { type: 'string', description: 'The caption, hashtags included.' },
    title: { type: 'string', description: 'The YouTube Shorts title.' },
  },
  required: ['caption', 'title'],
  additionalProperties: false,
} as const
