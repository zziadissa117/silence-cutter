// A phrase said twice in a row - a retake: "so the best way to... so the best
// way to do it is". His ask (2026-11-05): "find something that can track if I
// repeated the same phrase twice ... flag it. Let me click on it to see, and
// I can delete the first one."
//
// Read from the words still in the video (the captions, through the cuts):
// the same run of at least three words starting again soon after the first
// one - a few words of a false start may sit between them. Cutting the first
// takes out everything from the first try to where the second begins.
// stutterRanges (fillerWords.ts) already cuts one small word said twice;
// this is for whole phrases, which are only flagged - he decides.

export interface RepeatWord {
  text: string
  start: number
  end: number
}

export interface Repeat {
  /** The phrase as said the second time. */
  text: string
  /** Where the first try starts and the second one starts, on the recording. */
  first: number
  second: number
  /** What cutting the first takes out: the first try and anything between. */
  cut: { start: number; end: number }
}

/** At least this many words the same: two ("you know") is how people talk. */
const MIN_WORDS = 3
/** Words of a false start allowed between the two tries. */
const MAX_BETWEEN = 3
/** The second try starts within this long of the first one's end. */
const MAX_GAP_SEC = 8

const norm = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}']+/gu, '')

export function findRepeats(words: readonly RepeatWord[]): Repeat[] {
  const tokens = words.map((w) => norm(w.text))
  const out: Repeat[] = []
  let i = 0
  while (i < tokens.length) {
    if (!tokens[i]) {
      i++
      continue
    }
    let best: { j: number; length: number } | null = null
    for (let j = i + 1; j < tokens.length && j <= i + MAX_BETWEEN + 40; j++) {
      let length = 0
      while (j + length < tokens.length && i + length < j && tokens[i + length] && tokens[i + length] === tokens[j + length]) length++
      if (length < MIN_WORDS) continue
      // The second try begins right after the first, give or take a false start.
      if (j - (i + length) > MAX_BETWEEN) continue
      if (words[j].start - words[i + length - 1].end > MAX_GAP_SEC) continue
      if (!best || length > best.length) best = { j, length }
    }
    if (!best) {
      i++
      continue
    }
    const { j, length } = best
    out.push({
      text: words
        .slice(j, j + length)
        .map((w) => w.text.trim())
        .join(' '),
      first: words[i].start,
      second: words[j].start,
      cut: { start: words[i].start, end: words[j].start },
    })
    i = j
  }
  return out
}
