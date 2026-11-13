// Which product step a dropped-in clip belongs to, from what he says in it
// (his ask, 2026-11-13: "I say, 'Nope, do this instead.' I have 10 videos
// where I say it ... send all of those videos to that one product step").
// He names each step with what he says in it; a clip goes to the step whose
// name it says the most of - and to one he moved clips into before, by those
// clips' words too (BatchStep.heard), so it learns his wording.

import type { BatchStep } from './batch'

/** The words of a phrase, for comparing: lower case, no punctuation, and
 *  without a "Step 2:" in front. */
export function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/^\s*step\s*\d+\s*[:.\-–—)]?\s*/, '')
    .replace(/[’']/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
}

/** Small words that say little about which step it is. */
const LITTLE = new Set(['a', 'an', 'the', 'and', 'or', 'to', 'of', 'in', 'on', 'it', 'is', 'i', 'you', 'so', 'just', 'like', 'um', 'uh', 'le', 'la', 'les', 'de', 'et', 'un', 'une'])

/** How much of `phrase` is said in `said`, 0 to 1: its words found, the
 *  telling ones counting three times the small ones. */
export function saidOf(phrase: string[], said: ReadonlySet<string>): number {
  if (phrase.length === 0) return 0
  let found = 0
  let total = 0
  for (const w of phrase) {
    const weight = LITTLE.has(w) ? 1 : 3
    total += weight
    if (said.has(w)) found += weight
  }
  return found / total
}

export interface StepMatch {
  /** The step it goes to; null when nothing fits. */
  stepId: string | null
  /** Clearly that step - not shown as one to check. With no step: clearly
   *  none (a hook, in a format that takes hooks). */
  sure: boolean
}

/** Below this, it says next to nothing of any step: clearly none. */
const NOTHING = 0.15

/** Sure from this much of a step's words said... */
const SURE = 0.6
/** ...and this much more than the next step's. */
const AHEAD = 0.15
/** Below this it fits no step at all. */
const SOMETHING = 0.3

/** The step a clip goes to, from the words he says in it. */
export function matchStep(text: string, steps: readonly Pick<BatchStep, 'id' | 'name' | 'heard'>[]): StepMatch {
  const said = new Set(wordsOf(text))
  const scored = steps
    .map((step) => ({
      id: step.id,
      score: Math.max(saidOf(wordsOf(step.name), said), ...(step.heard ?? []).map((h) => saidOf(wordsOf(h), said) * 0.95)),
    }))
    .sort((a, b) => b.score - a.score)
  const [best, next] = scored
  if (!best || best.score < SOMETHING) return { stepId: null, sure: !best || best.score < NOTHING }
  return { stepId: best.id, sure: best.score >= SURE && best.score - (next?.score ?? 0) >= AHEAD }
}

/** The most phrases a step remembers. */
export const HEARD_MAX = 12

/** A step's remembered phrases with `text` added - newest first, no repeats. */
export function learned(heard: readonly string[] | undefined, text: string): string[] {
  const clean = text.trim()
  if (!clean) return [...(heard ?? [])]
  return [clean, ...(heard ?? []).filter((h) => h !== clean)].slice(0, HEARD_MAX)
}
