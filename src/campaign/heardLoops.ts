// What the speech model makes up over a clip with little or no talking in
// it: one phrase over and over (his report, 2026-11-15: a batch clip came
// back with 83 captions in French - the server had heard "C'est bon, je vais
// vous dire que je vais vous dire que je vais vous dire que..." on a clip
// where he barely spoke). Whisper does this in English too.
//
// A phrase said three times in a row (a single word, four) is a loop: its
// repeats are not words he said. When the loops are most of what was heard
// and hardly anything else is left, nothing in it was said - no words at all,
// so the clip goes in as filmed, with no captions. With real talking around
// the loop (his report, 2026-11-22: a talking video, 234 of 406 words a loop,
// came out "no speech" and was approved unseen), only the repeats go.

/** A word as said, for comparing: lower case, letters and digits only. */
const said = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

/** The longest phrase a loop is looked for in, in words. */
const LONGEST = 10

/** Of all the words heard, the share made of loops past which none is kept. */
const MOSTLY = 0.5

/** Real words left once the repeats are gone, from which it is a talking
 *  video whatever the loops were. */
export const FEW_LEFT = 15

export function withoutLoops<T extends { text: string }>(words: readonly T[]): { words: T[]; looped: number } {
  const tokens = words.map((w) => said(w.text))
  const drop: boolean[] = Array.from({ length: words.length }, () => false)
  const same = (a: number, b: number, n: number) => {
    for (let k = 0; k < n; k++) if (tokens[a + k] !== tokens[b + k]) return false
    return true
  }
  let looped = 0
  let i = 0
  while (i < words.length) {
    let best: { n: number; times: number } | null = null
    for (let n = 1; n <= LONGEST && i + 2 * n <= words.length; n++) {
      // A phrase of nothing but punctuation is not one.
      if (!tokens.slice(i, i + n).some(Boolean)) continue
      let times = 1
      while (i + (times + 1) * n <= words.length && same(i, i + times * n, n)) times++
      if (times >= (n === 1 ? 4 : 3) && (!best || times * n > best.times * best.n)) best = { n, times }
    }
    if (!best) {
      i++
      continue
    }
    // The phrase once; its repeats were not said.
    for (let k = i + best.n; k < i + best.n * best.times; k++) drop[k] = true
    looped += best.n * best.times
    i += best.n * best.times
  }
  const kept = words.filter((_, k) => !drop[k])
  const left = kept.filter((w) => said(w.text)).length
  if (looped > 0 && looped >= MOSTLY * words.filter((_, k) => tokens[k]).length && left < FEW_LEFT) return { words: [], looped }
  return { words: kept, looped }
}
