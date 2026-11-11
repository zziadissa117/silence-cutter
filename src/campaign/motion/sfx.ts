// Sound effects for motion graphics - his ask (2026-11-08): "can we also add
// some sound effects". Worked out from the storyboard by themselves, no
// choosing: a whoosh as the board comes up, a pop as a card or a part comes
// in, a tick for each line, each square and each diamond, a ding as a sum's
// result counts up, a deep hit on a gold word, a camera flash on a white
// flash. Never two closer than MIN_GAP - the stronger one stays - and all
// under his voice.
//
// Made from a few lines of maths, like the look's own sounds (sounds.ts), so
// there is nothing to load and they sound the same on the phone and the
// Cutter server.

import { formatOf, popScene, type Part, type Storyboard } from '../../../supabase/functions/postiz/motion.ts'
import { synthesize } from '../sounds'

export type MotionSound = 'whoosh' | 'pop' | 'ding' | 'tick' | 'hit' | 'shutter' | 'swish'

/** How loud each one sits, in dB of the sound as made: under his voice. */
export const SOUND_DB: Record<MotionSound, number> = {
  whoosh: -13,
  pop: -15,
  ding: -16,
  tick: -17,
  hit: -9,
  shutter: -12,
  swish: -15,
}

/** Which wins when two would play at once. */
const STRENGTH: Record<MotionSound, number> = { hit: 7, shutter: 6, whoosh: 5, ding: 4, swish: 3, pop: 2, tick: 1 }

/** Two sounds never closer than this: the stronger one stays. */
export const MIN_GAP = 0.18

/** A repeatable noise source, so a sound is the same every time. */
function noise(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000 - 0.5
  }
}

/** The samples of one sound at `sampleRate`, one channel. */
export function makeSound(name: MotionSound, sampleRate: number): Float32Array {
  if (name === 'whoosh' || name === 'pop' || name === 'ding') return synthesize(name, sampleRate)
  if (name === 'tick') {
    // A soft UI click: a tiny burst of noise and a high blip, gone in 40 ms.
    const length = Math.round(sampleRate * 0.04)
    const out = new Float32Array(length)
    const next = noise(3)
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate
      out[i] = (0.5 * next() * Math.exp(-t * 400) + 0.45 * Math.sin(2 * Math.PI * 3200 * t) * Math.exp(-t * 120)) * Math.min(1, t / 0.0005)
    }
    return out
  }
  if (name === 'hit') {
    // A deep hit: a low thump falling in pitch, with a crack on top.
    const length = Math.round(sampleRate * 0.7)
    const out = new Float32Array(length)
    const next = noise(11)
    let phase = 0
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate
      const freq = 42 + 70 * Math.exp(-t * 18)
      phase += (2 * Math.PI * freq) / sampleRate
      const body = Math.sin(phase) * Math.exp(-t * 4.5)
      const crack = next() * Math.exp(-t * 60) * 0.6
      out[i] = 0.9 * Math.min(1, t / 0.002) * (body + crack)
    }
    return out
  }
  if (name === 'shutter') {
    // A camera: two quick mechanical clicks and a short breath of air.
    const length = Math.round(sampleRate * 0.16)
    const out = new Float32Array(length)
    const next = noise(5)
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate
      const click = (at: number) => (t >= at ? Math.exp(-(t - at) * 300) : 0)
      out[i] = 0.8 * next() * (click(0) + 0.8 * click(0.07)) + 0.12 * next() * Math.exp(-t * 25)
    }
    return out
  }
  // Swish: a short, bright whoosh.
  const length = Math.round(sampleRate * 0.28)
  const out = new Float32Array(length)
  const next = noise(9)
  let low = 0
  let last = 0
  for (let i = 0; i < length; i++) {
    const x = i / length
    const swell = Math.sin(Math.PI * Math.pow(x, 0.6))
    const cutoff = 1500 + 7000 * swell
    const alpha = 1 - Math.exp((-2 * Math.PI * cutoff) / sampleRate)
    const n = next()
    low += alpha * (n - low)
    // Only the top of it: the air, not the rumble.
    out[i] = 2.2 * swell * swell * (low - last * 0.6)
    last = low
  }
  return out
}

/** One sound at one moment: `at` a word number of the storyboard's words. */
export interface SoundCue {
  sound: MotionSound
  at: number
}

/** When each word starts, on the recording (raw seconds). */
type WordTimes = (i: number) => number

/** Every part's moments, each with its sound. */
function partCues(part: Part, cues: SoundCue[]): void {
  switch (part.kind) {
    case 'title':
    case 'note':
    case 'number':
      cues.push({ sound: 'pop', at: part.at })
      if (part.kind === 'number') cues.push({ sound: 'ding', at: part.at })
      return
    case 'cards':
      for (const card of part.cards) {
        cues.push({ sound: 'pop', at: card.at })
        for (const line of card.lines) cues.push({ sound: 'tick', at: line.at })
      }
      return
    case 'list':
      for (const item of part.items) cues.push({ sound: 'pop', at: item.at })
      return
    case 'icons':
      for (const item of part.items) cues.push({ sound: 'pop', at: item.at })
      return
    case 'pop':
      // A card springing up over his face: a quick swish into its pop.
      cues.push({ sound: 'swish', at: part.at })
      return
    case 'tiles':
      cues.push({ sound: 'pop', at: part.at })
      for (const step of part.steps) cues.push({ sound: 'tick', at: step.at })
      return
    case 'phones':
      for (const item of part.items) cues.push({ sound: 'pop', at: item.at })
      for (const price of part.prices) cues.push({ sound: 'tick', at: price.at })
      return
    case 'math':
      for (const line of part.lines) cues.push({ sound: 'tick', at: line.at })
      if (part.result.text) cues.push({ sound: 'ding', at: part.result.at })
      return
    // The glass look: a swish as a card slides in, its own sound after.
    case 'tag':
    case 'picture':
      cues.push({ sound: 'swish', at: part.at })
      return
    case 'blocks':
      cues.push({ sound: 'swish', at: part.at })
      if (part.after) cues.push({ sound: 'pop', at: part.after.at })
      return
    case 'stat':
      cues.push({ sound: 'swish', at: part.at })
      cues.push({ sound: 'ding', at: part.at + 2 })
      return
    case 'steps':
      cues.push({ sound: 'whoosh', at: part.at })
      for (const item of part.items) cues.push({ sound: 'pop', at: item.at })
      return
  }
}

/** Every sound of a storyboard, as moments on the recording: `start(i)` is
 *  when word i starts. Scenes closer than `glue` seconds keep the board up,
 *  so only the first of them whooshes. Thinned so no two are closer than
 *  MIN_GAP - the stronger one stays. */
export function motionSounds(board: Storyboard, start: WordTimes, glue = 1.2): { sound: MotionSound; at: number }[] {
  const cues: SoundCue[] = []
  const glass = formatOf(board) === 'glass'
  if (board.hook) cues.push({ sound: 'pop', at: board.hook.at })
  if (board.title) cues.push({ sound: 'swish', at: 0 })
  board.scenes.forEach((scene, k) => {
    if (!glass && !popScene(scene)) {
      // The board scene before this one, pop cards between left out.
      const before = board.scenes.slice(0, k).reverse().find((s) => !popScene(s))
      // Only when the board comes up from his face.
      if (!before || start(scene.from) - start(before.to) > glue) cues.push({ sound: 'whoosh', at: scene.from })
    }
    for (const part of scene.parts) partCues(part, cues)
  })
  for (const e of board.emphasis ?? []) if (e.style === 'pill') cues.push({ sound: 'tick', at: e.at })
  if (board.end) cues.push({ sound: 'pop', at: board.end.at })
  // On the recording's clock, the stronger first at any moment.
  const timed = cues
    .map((c) => ({ sound: c.sound, at: start(c.at) }))
    .filter((c) => Number.isFinite(c.at))
    .sort((a, b) => a.at - b.at || STRENGTH[b.sound] - STRENGTH[a.sound])
  const kept: { sound: MotionSound; at: number }[] = []
  for (const cue of timed) {
    const last = kept[kept.length - 1]
    if (last && cue.at - last.at < MIN_GAP) {
      if (STRENGTH[cue.sound] > STRENGTH[last.sound]) kept[kept.length - 1] = cue
      continue
    }
    kept.push(cue)
  }
  return kept
}

/** The same, grouped by sound, each with its moments in order - as render.ts
 *  takes them. */
export function soundsByName(cues: readonly { sound: MotionSound; at: number }[]): { name: MotionSound; moments: number[]; volumeDb: number }[] {
  const byName = new Map<MotionSound, number[]>()
  for (const cue of cues) byName.set(cue.sound, [...(byName.get(cue.sound) ?? []), cue.at])
  return [...byName].map(([name, moments]) => ({ name, moments: moments.sort((a, b) => a - b), volumeDb: SOUND_DB[name] }))
}

/** Which of his sound effects (the music bank's Sound effects) plays each
 *  kind of moment, by the words in its name - "whoosh 3.mp3", "Vine boom".
 *  The Cutter's own made-up sounds are gone from motion graphics: "those are
 *  the sound effects that Claude uses and everyone has. I honestly hate them"
 *  (his words, 2026-11-11). A kind none of his effects is named for has no
 *  sound. */
export const KIND_WORDS: Record<MotionSound, RegExp> = {
  whoosh: /whoo?sh|swoosh|transition|swipe|riser|rise/i,
  swish: /swish|whip|swing|slide|swoosh/i,
  pop: /pop|bubble|blip|pluck|boop/i,
  ding: /ding|bell|chime|notif|ping|cash|coin|success/i,
  tick: /tick|click|tap|type|keyboard|mouse/i,
  hit: /hit|boom|bass|impact|thud|drop|vine|punch|slam/i,
  shutter: /camera|shutter|flash|snap|photo/i,
}

/** His effects for one kind of moment, in the bank's order. */
export function effectsFor(kind: MotionSound, bank: readonly { id: string; name: string }[]): { id: string; name: string }[] {
  return bank.filter((e) => KIND_WORDS[kind].test(e.name))
}

/** The storyboard's moments with his effects: each moment gets one of his
 *  effects of its kind - taking turns when he has several, so the same one
 *  doesn't come back every time - grouped by effect, as render.ts takes them.
 *  Moments with none of his effects are left silent. */
export function bankSounds(
  cues: readonly { sound: MotionSound; at: number }[],
  bank: readonly { id: string; name: string }[],
): { name: MotionSound; effectId: string; effectName: string; moments: number[]; volumeDb: number }[] {
  const turn = new Map<MotionSound, number>()
  const byEffect = new Map<string, { name: MotionSound; effectId: string; effectName: string; moments: number[]; volumeDb: number }>()
  for (const cue of cues) {
    const options = effectsFor(cue.sound, bank)
    if (options.length === 0) continue
    const k = turn.get(cue.sound) ?? 0
    turn.set(cue.sound, k + 1)
    const effect = options[k % options.length]
    const entry = byEffect.get(effect.id) ?? { name: cue.sound, effectId: effect.id, effectName: effect.name, moments: [], volumeDb: SOUND_DB[cue.sound] }
    entry.moments.push(cue.at)
    byEffect.set(effect.id, entry)
  }
  return [...byEffect.values()].map((e) => ({ ...e, moments: e.moments.sort((a, b) => a - b) }))
}
