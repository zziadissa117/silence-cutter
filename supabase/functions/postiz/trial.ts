// Trial reels (his ask, 2026-11-04): a reel of his that went viral, made
// again and again with its text moved or a word or two changed, and posted
// as Instagram Trial Reels - shown to people who don't follow him, never
// shared to his followers. The phone's Trial loop makes the videos
// (src/campaign/trialLoop.ts); here: who may use it, Claude reading the
// viral reel's text from one still, and what Instagram's trial errors mean.
//
// Plain TypeScript, no imports, for Deno and the tests.

/** Who may post Trial reels: the owner's login (and the admin backup, the
 *  same space), and the logins he turned it on for in People - kept in
 *  cutter_config `trial-reels` as a JSON list of space ids, written by the
 *  cutter function's `trial` action (owner only). */
export const TRIAL_CONFIG = 'trial-reels'

export function trialAllowed(spaceId: string, ownerId: string | null, allowed: readonly string[]): boolean {
  return spaceId === ownerId || allowed.includes(spaceId)
}

/** The list kept in cutter_config, whatever was stored. */
export function trialSpaces(value: string | null | undefined): string[] {
  if (!value) return []
  try {
    const list = JSON.parse(value)
    return Array.isArray(list) ? list.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

/** What Instagram said about a trial reel it turned down (Postiz passes its
 *  words on - instagram.provider.ts handleErrors): over its daily trial
 *  limit (code 9, subcode 2207078), or an account that can't post trials at
 *  all (subcode 2207081 - too few followers, not professional, or out of
 *  recommendations). */
export function trialProblem(error: string | null | undefined): 'limit' | 'not-allowed' | null {
  if (!error) return null
  if (/2207078|trial reel publish limit/i.test(error)) return 'limit'
  if (/2207081|doesn't support trial reels|does not support trial reels/i.test(error)) return 'not-allowed'
  return null
}

/** Instagram's daily trial limit, as learned from its first refusal: the
 *  trials that went out on the account in the 24 hours before it. Never
 *  under 1, so the loop keeps going at the least. */
export function learnedLimit(wentOut: number): number {
  return Math.max(1, Math.floor(wentOut))
}

/** What each account taught: its daily trial limit, or that it can't post
 *  trials. Kept on the posting profile (`settings.trial`), read by the phone. */
export interface TrialAccounts {
  limits?: Record<string, { perDay: number; at: string }>
  notAllowed?: Record<string, { at: string }>
}

export function withLimit(trial: TrialAccounts | undefined, accountId: string, perDay: number, at: string): TrialAccounts {
  const before = trial?.limits?.[accountId]?.perDay
  // A second refusal the same day can only lower it.
  const next = before !== undefined ? Math.min(before, perDay) : perDay
  return { ...trial, limits: { ...trial?.limits, [accountId]: { perDay: next, at } } }
}

export function withNotAllowed(trial: TrialAccounts | undefined, accountId: string, at: string): TrialAccounts {
  return { ...trial, notAllowed: { ...trial?.notAllowed, [accountId]: { at } } }
}

/** A trial that went out: the account can post trials after all. */
export function withAllowed(trial: TrialAccounts | undefined, accountId: string): TrialAccounts {
  if (!trial?.notAllowed?.[accountId]) return trial ?? {}
  const { [accountId]: _gone, ...rest } = trial.notAllowed
  return { ...trial, notAllowed: rest }
}

// --- Claude reads the viral reel ------------------------------------------------

/** How many rewordings Claude writes of the viral text. */
export const REWORDINGS = 12

export const TRIAL_READ_SYSTEM = `You look at one still from a short vertical video (an Instagram Reel or TikTok) that went viral. Words are written over the video - the hook. Read them exactly and describe how they look and where they sit, so the same words can be put back on a clean copy of the video looking the same.

- text: the words on the video exactly as written, with their line breaks as \\n, their capitals, punctuation and emoji. Leave out anything that is the app's own interface (usernames, buttons, captions under the video, like counts, the progress bar) - only the words that are part of the video itself. Empty when there are none.
- style: "box" when the words sit in white (or light) rounded boxes, TikTok's classic; "snap" when they are on one see-through dark band across the whole width, Snapchat's caption; "outline" for anything else - letters with an outline or a shadow, or plain letters.
- outlineColor: for "outline", the colour of the outline or shadow around the letters as #rrggbb (#000000 when there is none or you can't tell).
- size: "small", "medium" or "large" - how big the letters are against the frame (large: a line of a few words fills most of the width).
- x, y: where the middle of the block of words is, as fractions of the video's width and height (0,0 top left, 1,1 bottom right). Measure against the video itself, not the screen around it if this is a screen recording.
- rewordings: ${REWORDINGS} versions of the text, each changing only one or two words - a synonym, a slightly different way to say the same thing - so it reads the same, keeps the same meaning, tone, length, line breaks, capitals and emoji, and would hook just as well. Never change names, numbers or the brand. Each one different from the text and from the others.`

export const TRIAL_READ_SCHEMA = {
  type: 'object',
  properties: {
    text: { type: 'string' },
    style: { type: 'string', enum: ['box', 'outline', 'snap'] },
    outlineColor: { type: 'string' },
    size: { type: 'string', enum: ['small', 'medium', 'large'] },
    x: { type: 'number' },
    y: { type: 'number' },
    rewordings: { type: 'array', items: { type: 'string' } },
  },
  required: ['text', 'style', 'outlineColor', 'size', 'x', 'y', 'rewordings'],
  additionalProperties: false,
} as const

export interface TrialRead {
  text: string
  style: 'box' | 'outline' | 'snap'
  outlineColor: string
  size: 'small' | 'medium' | 'large'
  /** The middle of the words, as fractions of the frame. */
  x: number
  y: number
  rewordings: string[]
}

const clamp = (n: unknown, low: number, high: number, fallback: number) => {
  const v = Number(n)
  return Number.isFinite(v) ? Math.min(high, Math.max(low, v)) : fallback
}

/** What Claude said, made safe to use: a text and its look, its rewordings
 *  different from it and from each other. Null when there is nothing to use. */
export function cleanRead(value: unknown): TrialRead | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  const text = typeof v.text === 'string' ? v.text.trim().slice(0, 300) : ''
  const style = v.style === 'box' || v.style === 'snap' ? v.style : 'outline'
  const outlineColor = typeof v.outlineColor === 'string' && /^#[0-9a-f]{6}$/i.test(v.outlineColor) ? v.outlineColor.toLowerCase() : '#000000'
  const size = v.size === 'small' || v.size === 'large' ? v.size : 'medium'
  const key = (t: string) => t.toLowerCase().replace(/\s+/g, ' ').trim()
  const seen = new Set([key(text)])
  const rewordings: string[] = []
  for (const r of Array.isArray(v.rewordings) ? v.rewordings : []) {
    if (typeof r !== 'string') continue
    const t = r.trim().slice(0, 300)
    if (!t || seen.has(key(t))) continue
    seen.add(key(t))
    rewordings.push(t)
    if (rewordings.length >= REWORDINGS) break
  }
  return { text, style, outlineColor, size, x: clamp(v.x, 0.05, 0.95, 0.5), y: clamp(v.y, 0.05, 0.95, 0.3), rewordings: text ? rewordings : [] }
}

/** What he typed in place of reading (or Claude found no words): the same
 *  shape, with the text as given. */
export function readFromHook(hook: string): TrialRead {
  return { text: hook.trim().slice(0, 300), style: 'outline', outlineColor: '#000000', size: 'medium', x: 0.5, y: 0.3, rewordings: [] }
}
