// Split screen batches (his friend's ask, 2026-11-28, from their soccer reel):
// the video in two halves, one above the other.
//
//   Hook   top: his reaction - watching, then jumping when the goal goes in -
//               his own voice kept and turned well up.
//          bottom: a match clip; each has its goal at the same moment, with a
//               cha-ching already in its sound. At the goal "+$586.68 US"
//               pops up in tilted green over him, a different amount on
//               every video ($500 to $7,000 unless he sets another range).
//          The title (the batch's headline) over the top half.
//   Body   top: him at the computer (a few clips, any one).
//          bottom: the product playthrough, its own sound (typing...) kept.
//          "Step 1. Find a soccer match", ... written on the line between
//          the halves, each from the moment he set in the product.
//   Music  the whole way, the song's beat drop on the goal.
//
// Any reaction goes with any match clip, any computer clip and any product -
// a clip comes round again in other videos, never the same whole video twice
// (batch.combos, the format's clips as steps). Made by splitRender.ts.

import type { BankFile, BatchStep } from './batch'

/** Which half a clip of the split format fills, besides the defaults - a clip
 *  of him is the hook's reaction, a product clip the playthrough. */
export type SplitRole = 'under' | 'desk'

/** A step line written between the halves: from `at` seconds into the
 *  product playthrough, until the next one. */
export interface SplitLine {
  text: string
  at: number
}

export interface MoneyRange {
  min: number
  max: number
}

export const DEFAULT_MONEY: MoneyRange = { min: 500, max: 7000 }

/** What a split video needs beyond its clips: the lines and its amount. */
export interface SplitLook {
  lines: SplitLine[]
  /** "+$586.68 US". */
  amount: string
}

/** The format's clips as the mixing reads them: three steps, one clip of each
 *  in every video. */
export const SPLIT_STEPS = {
  under: { id: 'split-under', name: 'Under your reaction' },
  desk: { id: 'split-desk', name: 'You at the computer' },
  product: { id: 'split-product', name: 'The product' },
} as const

export function splitSteps(reactions: readonly BankFile[], products: readonly BankFile[]): BatchStep[] {
  return [
    { ...SPLIT_STEPS.under, files: products.filter((f) => f.role === 'under') },
    { ...SPLIT_STEPS.desk, files: reactions.filter((f) => f.role === 'desk') },
    { ...SPLIT_STEPS.product, files: products.filter((f) => f.role !== 'under') },
  ]
}

/** The hook's reactions: his clips that aren't of him at the computer. */
export const hookReactions = (reactions: readonly BankFile[]) => reactions.filter((f) => f.role !== 'desk')

/** The same seed, the same numbers. */
function seeded(seed: string): () => number {
  let hash = 2166136261
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  let state = hash >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** "+$586.68 US": cents and all, so it reads like a real payout - the same
 *  for a video's id every time (a remake says the same). */
export function moneyLine(seed: string, range: MoneyRange = DEFAULT_MONEY): string {
  const low = Math.max(1, Math.min(range.min, range.max))
  const high = Math.max(low, Math.max(range.min, range.max))
  const cents = Math.round((low + seeded(seed)() * (high - low)) * 100)
  const dollars = Math.floor(cents / 100).toLocaleString('en-US')
  return `+$${dollars}.${String(cents % 100).padStart(2, '0')} US`
}

/** The line showing at `t` seconds into the product, if any. */
export function lineAt(lines: readonly SplitLine[], t: number): string | null {
  let shown: string | null = null
  for (const line of [...lines].sort((a, b) => a.at - b.at)) if (line.at <= t + 1e-6 && line.text.trim()) shown = line.text.trim()
  return shown
}

/** Lines typed one per line, each given a start: the ones kept from before by
 *  their words, new ones spread through what is left of `length`. */
export function linesFrom(text: string, before: readonly SplitLine[], length: number): SplitLine[] {
  const words = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const known = new Map(before.map((l) => [l.text.trim(), l.at]))
  const out: SplitLine[] = []
  for (const [i, w] of words.entries()) {
    const kept = known.get(w)
    if (kept !== undefined) out.push({ text: w, at: kept })
    else {
      const prev = out.at(-1)?.at ?? 0
      const even = length > 0 ? (length * i) / words.length : prev
      out.push({ text: w, at: Math.max(i === 0 ? 0 : prev + 0.5, even) })
    }
  }
  return out
}

/** Where the goal is in a match clip: the sharpest rise in loudness - the
 *  cha-ching and the crowd. `levels` are short windows' loudness (RMS), `step`
 *  seconds apart. Null when nothing stands out. */
export function goalIn(levels: readonly number[], step: number): number | null {
  if (levels.length < 8) return null
  const before = Math.max(2, Math.round(0.4 / step))
  let best = -1
  let bestRise = 0
  const loudest = Math.max(...levels)
  if (!(loudest > 0)) return null
  for (let i = before; i < levels.length; i++) {
    let sum = 0
    for (let k = i - before; k < i; k++) sum += levels[k]
    const rise = levels[i] - sum / before
    if (rise > bestRise && levels[i] > loudest * 0.4) {
      bestRise = rise
      best = i
    }
  }
  return best >= 0 && bestRise > loudest * 0.15 ? best * step : null
}
