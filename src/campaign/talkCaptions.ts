// A talking head batch's captions (his pick, 2026-11-06: "keep whole +
// captions"): what he says in each talking clip, heard once - the first time
// a video is made from it - and kept on this phone (or the server), so every
// other video from that clip reuses the words. The clip is never cut: every
// word stays on its own timeline (montageRender draws them over the clip).

import type { BankFile } from './batch'
import { captionWords, type CaptionWord } from './captions'
import { listen } from './pipeline'
import type { SilenceSettings } from '../media/silenceMath'

const KEY = 'batch.talkWords:'
/** Words heard before this are heard again (the way they're timed changed). */
const VERSION = 1

/** The key a clip's words are kept under: what is in it, so the same take
 *  added again is not heard again. */
export function talkKey(clip: Pick<BankFile, 'id' | 'fp'>): string {
  return `${KEY}${clip.fp ?? clip.id}`
}

export function keptWords(clip: Pick<BankFile, 'id' | 'fp'>): CaptionWord[] | null {
  try {
    const raw = localStorage.getItem(talkKey(clip))
    if (!raw) return null
    const kept = JSON.parse(raw) as { v?: number; words?: CaptionWord[] }
    return kept.v === VERSION && Array.isArray(kept.words) ? kept.words : null
  } catch {
    return null
  }
}

function keepWords(clip: Pick<BankFile, 'id' | 'fp'>, words: CaptionWord[]): void {
  try {
    localStorage.setItem(talkKey(clip), JSON.stringify({ v: VERSION, words }))
  } catch {
    // Heard again next time.
  }
}

/** The words of a talking clip, timed on the clip's own timeline, heard now
 *  if they never were. */
export async function talkWords(
  clip: BankFile,
  file: Blob,
  { settings, names, onModel, onListen }: { settings: SilenceSettings; names: string[]; onModel?: (p: number) => void; onListen?: (p: number) => void },
): Promise<CaptionWord[]> {
  const kept = keptWords(clip)
  if (kept) return kept
  const plan = await listen(
    file,
    settings,
    { cleanSpeech: false, hear: true, names, align: true, quietIsFine: true, keepWhole: true, cutNoise: false },
    { onModelDownload: onModel, onTranscribeProgress: onListen },
  )
  const words = captionWords(plan.spoken ?? plan.words, [{ start: 0, end: plan.duration }], { rough: !plan.aligned })
  keepWords(clip, words)
  return words
}
