// A video with no talking in it is a reaction (his ask, 2026-11-06: "If you
// don't detect any speech, if there's literally zero speech, then you're
// going to put it under the reaction section ... those will not be silenced
// or cut at all. No need to put captions."). One sentence heard anywhere and
// it is a talking video, as always.
//
// Its clips are where he flipped the camera or paused while recording in the
// Cutter (Recorder.clipStarts). He chooses whether the headline stays the
// whole video or only the first clip, and can put words on each clip after
// it - drawn like words he types in the edit screen (manualPictures text).

import type { ManualPicture } from './manualPictures'
import type { HeadlineStyle } from './look'
import { TEXT_BASE_PCT } from './manualPictures'

/** Fewer words than this heard is no talking: the speech model makes up a
 *  word or two ("you", "[Music]") over sound with nobody speaking. */
export const NO_SPEECH_WORDS = 3

/** What the speech model writes over sound with nobody talking. */
const MADE_UP = new Set(['you', 'thank', 'thanks', 'bye', 'for', 'watching', 'subscribe', 'music', 'applause', 'laughter', 'okay', 'oh'])

/** Whether a take has no talking in it: (almost) nothing heard, or only what
 *  the model makes up over other sound - its usual words, or one phrase
 *  looping ("you're not going to be a good one" over and over, heard over a
 *  plain tone, 2026-11-06), which nobody says in a real take. */
export function noSpeechIn(words: readonly { text: string }[]): boolean {
  const said = words
    .filter((w) => /[\p{L}\p{N}]/u.test(w.text) && !/^\s*[[(].*[\])]\s*$/.test(w.text))
    .map((w) => w.text.toLowerCase().replace(/[^\p{L}\p{N}']+/gu, ''))
    .filter(Boolean)
  const real = said.filter((w) => !MADE_UP.has(w))
  if (real.length < NO_SPEECH_WORDS) return true
  // One phrase over and over: few different words for how many there are.
  return said.length >= 12 && new Set(said).size / said.length < 0.3
}

/** The song for a reaction that has none: one of his music bank's songs
 *  (not a sound effect), the same one for the same video every time. */
export function songForReaction<S extends { id: string; sfx?: true }>(songs: readonly S[], key: string): S | null {
  const list = songs.filter((s) => s.sfx !== true)
  if (list.length === 0) return null
  let h = 0
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return list[h % list.length]
}

export interface Clip {
  start: number
  end: number
}

/** The video's clips, from where each new one starts. */
export function clipsOf(starts: readonly number[] | undefined, duration: number): Clip[] {
  const cuts = [...new Set(starts ?? [])].filter((t) => t > 0 && t < duration).sort((a, b) => a - b)
  const edges = [0, ...cuts, duration]
  return edges.slice(0, -1).map((start, i) => ({ start, end: edges[i + 1] }))
}

/** How long the headline stays: the whole video, or only the first clip. */
export function headlineSeconds(whole: boolean, clips: readonly Clip[], ownSeconds: number): number {
  if (whole) return Math.max(ownSeconds, clips[clips.length - 1]?.end ?? ownSeconds)
  return clips.length > 1 ? clips[0].end : ownSeconds
}

/** The words he typed for clips 2, 3 and on, as words on the video: each up
 *  for its whole clip, where the headline sits, in its look. */
export function clipTexts(texts: readonly string[] | undefined, clips: readonly Clip[], style: HeadlineStyle, center = { x: 0.5, y: 0.2 }): ManualPicture[] {
  const out: ManualPicture[] = []
  ;(texts ?? []).forEach((text, i) => {
    const clip = clips[i + 1]
    if (!clip || !text.trim()) return
    out.push({
      id: `clip-text-${i + 1}`,
      source: { kind: 'text', text: text.trim(), style },
      at: clip.start,
      seconds: Math.max(0.5, clip.end - clip.start),
      position: 'top',
      widthPct: TEXT_BASE_PCT,
      center,
    })
  })
  return out
}
