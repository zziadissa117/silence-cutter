// What to check in a video's captions, and what a Claude re-check costs.
//
// "Only show the ones to check": a phrase is flagged when it is likely to be
// wrong or sits next to a sound the cutter was unsure about. Nothing here
// decides a caption is right - an unflagged phrase is just less likely to need
// a look.

export interface Span {
  start: number
  end: number
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

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

/** A word in the phrase that nearly matches a campaign term but is not it:
 *  "pump fund" for "Pump.fun" is the commonest mishearing. Terms shorter than
 *  four letters are skipped (too many false alarms). */
export function nearMiss(text: string, vocabulary: readonly string[]): boolean {
  const words = text.split(/\s+/).map(norm).filter(Boolean)
  // Also pairs of words: a term heard as two.
  const joined = words.slice(0, -1).map((w, i) => w + words[i + 1])
  for (const term of vocabulary) {
    const t = norm(term)
    if (t.length < 4) continue
    const allowed = Math.max(1, Math.floor(t.length * 0.25))
    const close = (c: string) => Math.abs(c.length - t.length) <= allowed && distance(c, t) <= allowed
    // A single word that is the term is right; one that is close is not. Two
    // words that join up to the term are a term that was split in two.
    if (words.some((c) => c !== t && close(c))) return true
    if (joined.some(close)) return true
  }
  return false
}

/** Which phrases to look at: Claude changed them, a word nearly matches a
 *  campaign term, or they sit within `margin` seconds of a sound the cutter
 *  cut or flagged. */
export function flaggedPhrases(
  phrases: readonly { text: string; start: number; end: number }[],
  options: { vocabulary: readonly string[]; changed?: ReadonlySet<number>; risky?: readonly Span[]; margin?: number },
): Set<number> {
  const margin = options.margin ?? 0.5
  const out = new Set<number>()
  phrases.forEach((p, i) => {
    if (options.changed?.has(i)) out.add(i)
    else if (nearMiss(p.text, options.vocabulary)) out.add(i)
    else if ((options.risky ?? []).some((r) => r.start < p.end + margin && r.end > p.start - margin)) out.add(i)
  })
  return out
}

/** Dollars per million tokens for claude-opus-5, the model that does the
 *  re-check (Anthropic's published price, 2026-09-25). */
export const RECHECK_PRICE = { input: 5, output: 25 }

/** A fair estimate of what re-checking these phrases costs, in cents, before
 *  asking: the instructions and the list go in, the list comes back, plus room
 *  for a little thinking. Shown as "about N cents"; the real figure comes back
 *  with the answer. */
export function estimateRecheckCents(phrases: readonly string[], vocabulary: readonly string[] = []): number {
  const chars = phrases.reduce((n, p) => n + p.length + 4, 0) + vocabulary.reduce((n, v) => n + v.length + 2, 0)
  const input = 450 + chars / 3.5
  const output = chars / 3.5 + 150 + 500
  return ((input * RECHECK_PRICE.input + output * RECHECK_PRICE.output) / 1_000_000) * 100
}

/** "about 2¢", "under 1¢", "about 12¢". */
export function centsLabel(cents: number): string {
  if (cents < 1) return 'under 1¢'
  return `about ${Math.round(cents)}¢`
}
