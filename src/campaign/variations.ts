// Variations of a video (More -> Variations - his ask, 2026-11-17: "a brand
// asked me for 9 different hooks and 2 different bodies ... put all the hooks
// with each body"). Set up exactly like a batch - its formats, hooks, product
// steps, captions, scripts, pictures, speed - but kept apart from it, and
// every hook is made once with every body: each different video exactly
// once, nothing mixed at random. The videos are kept on the phone, looked
// through in a grid and saved to it; never scheduled, never posted.
//
// A "body" is what follows the hook: one clip of each product step (every
// combination of them), or one product showcase when the format has no steps.

import { formatBank, headlinesToMix, looksToMix, todayHere, usesSteps, withFormats, type BankFile, type BatchBank, type BatchPick } from './batch'
import { liveFormats, missingFor, videoOf, type BatchVideo } from './batchRun'

/** The most variations made from one tap: far more than any brand asks for,
 *  and still a phone's evening of making. */
export const MOST_VARIATIONS = 200

/** Which clips a variation is made of: its format, its hook, its body. */
export function comboKey(formatId: string, hook: string, body: readonly string[]): string {
  return `${formatId}|${hook}|${body.join('+')}`
}

/** Every combination of one clip from each list, in order: the first list's
 *  first clip with every combination of the rest, then its second, ... */
export function everyCombination<T>(lists: readonly (readonly T[])[]): T[][] {
  return lists.reduce<T[][]>((acc, list) => acc.flatMap((head) => list.map((item) => [...head, item])), [[]])
}

/** One variation to make: what goes into it, and its key. */
export interface Variation {
  formatId: string
  formatName: string
  combo: string
  hook: BankFile
  body: BankFile[]
}

/** Every variation the bank can make, format by format: each of his hooks
 *  with each body. Formats paused or missing something make none. */
export function allVariations(bank: BatchBank): Variation[] {
  const b = withFormats(bank)
  const out: Variation[] = []
  for (const format of liveFormats(b)) {
    const sub = formatBank(b, format)
    if (missingFor(sub).length > 0) continue
    const bodies: BankFile[][] = usesSteps(sub) ? everyCombination(sub.steps!.map((s) => s.files)) : sub.products.map((p) => [p])
    for (const hook of sub.reactions) {
      for (const body of bodies) out.push({ formatId: format.id, formatName: format.name, combo: comboKey(format.id, hook.id, body.map((f) => f.id)), hook, body })
    }
  }
  return out
}

/** The variations not made yet (not in `made`), at most MOST_VARIATIONS. */
export function variationsToMake(bank: BatchBank, made: ReadonlySet<string>): Variation[] {
  return allVariations(bank)
    .filter((v) => !made.has(v.combo))
    .slice(0, MOST_VARIATIONS)
}

/** The videos of these variations, as a batch's are made (batchRun.videoOf):
 *  each format's headlines, looks and songs taken in turn - evenly, the same
 *  ones every time for the same variation's place in the list - and nothing
 *  scheduled: its date and time only say when it was asked for. */
export function variationVideos(bank: BatchBank, list: readonly Variation[], { id = `v-${Date.now().toString(36)}`, now = new Date() } = {}): BatchVideo[] {
  const b = withFormats(bank)
  const turn = new Map<string, number>()
  const date = todayHere(now)
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  return list.flatMap((v, i) => {
    const format = (b.formats ?? []).find((f) => f.id === v.formatId)
    if (!format) return []
    const sub = formatBank(b, format)
    const n = turn.get(v.formatId) ?? 0
    turn.set(v.formatId, n + 1)
    const headlines = headlinesToMix(sub)
    const looks = looksToMix(sub)
    const steps = usesSteps(sub)
    const pick: BatchPick = {
      reaction: v.hook.id,
      product: v.body[0].id,
      ...(steps ? { steps: v.body.map((f) => f.id) } : {}),
      headline: headlines.length > 0 ? headlines[n % headlines.length] : '',
      music: sub.music.length > 0 ? sub.music[n % sub.music.length].id : null,
      ...(looks.length > 0 ? { look: looks[n % looks.length].look } : {}),
    }
    const video = videoOf(sub, pick, { date, time }, { id, seed: `${id}-${i}`, size: list.length, ending: false, format: format.id })
    return [{ ...video, batch: { ...video.batch, variation: { combo: v.combo } } }]
  })
}
