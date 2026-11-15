// A product step's caption script (his ask, 2026-11-15: "put a certain
// caption framework for every single product step ... When I talk in the
// video, Claude inspires himself from that caption framework so that it can
// never have them wrong again" - "I want to make sure that I set the
// framework for every single product step"). He types what he says in the
// step once (BatchStep.script). Every clip of the step then has its heard
// words lined up against it: a word that sounds like the script's takes the
// script's spelling ("GPT" -> "ChatGPT", "chat GPT" -> "ChatGPT"), the
// timing staying the heard one; a clip whose words all line up "matches",
// and can be approved with the others that match in one tap after a look.
// Anything he really said differently is kept as heard and pointed out.
//
// Batch-only (AGENTS.md rule zero): the Cutter's own hearing and caption
// timing are untouched - this only reads the words it heard.

import type { CaptionWord } from './captions'

/** A word compared by its letters and digits alone, lowercase. */
export function norm(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]/gu, '')
}

/** How alike two words are, 0 to 1 (1: the same letters). */
export function alike(a: string, b: string): number {
  if (a === b) return 1
  if (!a || !b) return 0
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]
    prev[0] = i
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j]
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1))
      diag = up
    }
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length)
}

/** A heard word close enough to be the script's word, misheard: most of its
 *  letters, or a good part of it inside the other ("gpt" in "chatgpt").
 *  Two heard words joined (`joined`) must have nearly all the letters:
 *  "chat" + "gpt" is "chatgpt", but "to" + "claude" is never "to". */
function closeEnough(heard: string, script: string, joined = false, brand = false): boolean {
  if (!heard || !script) return false
  if (heard === script) return true
  if (joined) return alike(heard, script) >= 0.85
  // A real word of its own a letter or two away is what he said, not a
  // mishearing: "prompts" for "prompt", "these" for "this", "used" for "use".
  if (otherForm(heard, script)) return false
  // Short words differ by a letter and mean something else ("cat", "chat").
  if (alike(heard, script) >= (Math.max(heard.length, script.length) <= 4 ? 0.85 : 0.75)) return true
  // Part of a name, only for a name - written with a capital or a digit
  // inside it in the script ("GPT" in "ChatGPT", "Tok" in "TikTok"); never
  // an everyday word inside another ("app" in "apple").
  if (!brand) return false
  const [short, long] = heard.length < script.length ? [heard, script] : [script, heard]
  return short.length >= 3 && short.length / long.length >= 0.4 && long.includes(short)
}

/** A name, as the script writes it: a capital or a digit after its first letter. */
const isName = (word: string): boolean => /^.+[\p{Lu}\p{N}]/u.test(word.replace(/[^\p{L}\p{N}]/gu, ''))

/** One is the other with a common ending added - another form of the same
 *  word, which he may really have said. */
function otherForm(a: string, b: string): boolean {
  const [short, long] = a.length < b.length ? [a, b] : [b, a]
  if (!long.startsWith(short.replace(/e$/, ''))) return false
  const rest = long.slice(short.replace(/e$/, '').length)
  return ['s', 'es', 'd', 'ed', 'ing', 'ly', 'er', 'ers', 'se', 'ese'].includes(rest) || (short === 'this' && long === 'these') || (short === 'the' && long === 'they')
}

/** A difference between what was heard and the script, to point out. */
export interface ScriptDiff {
  /** What was heard ('' when a script word wasn't heard at all). */
  heard: string
  /** What the script says there ('' when he said a word the script hasn't). */
  script: string
}

export interface ScriptFit {
  /** The words with the script's spelling where they line up, on the heard
   *  times - the clip's captions. */
  words: CaptionWord[]
  /** Every word lines up with the script, nothing added or missing. */
  matches: boolean
  /** Where it differs from the script. */
  diffs: ScriptDiff[]
  /** Words given the script's spelling ("GPT" -> "ChatGPT"). */
  respelled: number
}

/** The script's words as they are shown: its own spelling and marks. */
export function scriptWords(script: string): string[] {
  return script.split(/\s+/).filter((w) => norm(w))
}

type Step = { cost: number; from: [number, number]; kind: 'same' | 'merge' | 'split' | 'sub' | 'extra' | 'missing' }

/** The heard words lined up against the script (see the top of the file). */
export function fitToScript(heard: readonly CaptionWord[], script: string): ScriptFit {
  const said = scriptWords(script)
  const h = heard.map((w) => norm(w.text))
  const s = said.map(norm)
  if (s.length === 0) return { words: [...heard], matches: false, diffs: [], respelled: 0 }
  // Fewest changes from the heard words to the script's: a word for a word
  // (free when alike, else a substitution), two heard for one of the
  // script's ("chat GPT" for "ChatGPT"), one heard for two, a word only
  // heard, a word only in the script.
  const n = h.length
  const m = s.length
  const best: Step[][] = Array.from({ length: n + 1 }, () => Array.from({ length: m + 1 }, () => ({ cost: Infinity, from: [0, 0] as [number, number], kind: 'same' as const })))
  best[0][0] = { cost: 0, from: [0, 0], kind: 'same' }
  const offer = (i: number, j: number, cost: number, from: [number, number], kind: Step['kind']) => {
    if (cost < best[i][j].cost - 1e-9) best[i][j] = { cost, from, kind }
  }
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= m; j++) {
      const here = best[i][j].cost
      if (!Number.isFinite(here)) continue
      if (i < n && j < m) {
        const close = closeEnough(h[i], s[j], false, isName(said[j]))
        if (h[i] === s[j]) offer(i + 1, j + 1, here, [i, j], 'same')
        else offer(i + 1, j + 1, here + (close ? 0.3 : 1), [i, j], close ? 'same' : 'sub')
      }
      if (i + 1 < n && j < m && closeEnough(h[i] + h[i + 1], s[j], true)) offer(i + 2, j + 1, here + 0.2, [i, j], 'merge')
      if (i < n && j + 1 < m && closeEnough(h[i], s[j] + s[j + 1], true)) offer(i + 1, j + 2, here + 0.2, [i, j], 'split')
      if (i < n) offer(i + 1, j, here + 1, [i, j], 'extra')
      if (j < m) offer(i, j + 1, here + 1, [i, j], 'missing')
    }
  }
  // Walked back from the end, then put in order.
  const pieces: { kind: Step['kind']; hi: number; sj: number }[] = []
  for (let i = n, j = m; i > 0 || j > 0; ) {
    const step = best[i][j]
    pieces.push({ kind: step.kind, hi: step.from[0], sj: step.from[1] })
    ;[i, j] = step.from
  }
  pieces.reverse()
  const words: CaptionWord[] = []
  const diffs: ScriptDiff[] = []
  let respelled = 0
  for (const { kind, hi, sj } of pieces) {
    if (kind === 'same') {
      const shown = said[sj]
      if (norm(heard[hi].text) !== s[sj]) respelled++
      words.push({ ...heard[hi], text: shown })
    } else if (kind === 'merge') {
      const a = heard[hi]
      const b = heard[hi + 1]
      respelled++
      words.push({
        ...a,
        text: said[sj],
        end: b.end,
        ...(a.heard || b.heard ? { heard: { start: (a.heard ?? a).start, end: (b.heard ?? b).end } } : {}),
      })
    } else if (kind === 'split') {
      const w = heard[hi]
      const mid = (w.start + w.end) / 2
      const hw = w.heard ?? { start: w.start, end: w.end }
      const hmid = (hw.start + hw.end) / 2
      respelled++
      words.push({ ...w, text: said[sj], end: mid, ...(w.heard ? { heard: { start: hw.start, end: hmid } } : {}) })
      words.push({ ...w, text: said[sj + 1], start: mid, ...(w.heard ? { heard: { start: hmid, end: hw.end } } : {}) })
    } else if (kind === 'sub') {
      // Something he said differently: kept as heard, pointed out.
      words.push({ ...heard[hi] })
      diffs.push({ heard: heard[hi].text, script: said[sj] })
    } else if (kind === 'extra') {
      words.push({ ...heard[hi] })
      diffs.push({ heard: heard[hi].text, script: '' })
    } else {
      diffs.push({ heard: '', script: said[sj] })
    }
  }
  return { words, matches: diffs.length === 0, diffs, respelled }
}

/** The script of a step as one line, from approved captions (his tap "Use
 *  these as the step's script"). */
export function scriptFrom(words: readonly CaptionWord[]): string {
  return words
    .map((w) => w.text.trim())
    .filter(Boolean)
    .join(' ')
}
