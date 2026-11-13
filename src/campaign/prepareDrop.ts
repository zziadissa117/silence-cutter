// Many short clips of him dropped into a talking head format at once (his
// ask, 2026-11-13: "I paste in every single video that I take. It's over 45
// different videos of me just starting, saying a phrase, and then ending it
// ... Automatically, the cutter cuts the videos and cuts the awkward
// silences ... puts captions ... and then you assign them to the product
// steps"). Each is heard, cut the way the Cutter cuts his talking videos with
// a little more room ("exactly like the cutter is cutting now, but with a
// little bit more leeway"), kept as a step clip with its words (so it is never
// heard again), and sent to the step whose name it says (stepMatch.ts). He
// checks them on one list after (DropIn.tsx).

import { PRESETS, type SilenceSettings } from '../media/silenceMath'
import type { BankFile } from './batch'
import { captionWords, cutTime, type CaptionWord } from './captions'
import { NO_EFFECTS } from './effects'
import { filmingOf } from './filming'
import { fingerprint } from './fingerprint'
import { blankAngle, blankCampaign, videoLook } from './look'
import { videoSettings } from './motion/make'
import { listen } from './pipeline'
import { renderCampaignCut } from './render'
import { saveBankFile } from './store'
import { rememberWords } from './talkCaptions'

/** The little more room than his usual cut: a pause has to be this much
 *  longer before it is cut, and this much more is kept around each word. */
export const LEEWAY = { silenceSec: 0.2, paddingSec: 0.06 } as const

/** His own pacing's cut, with the drop-in's extra room. */
export function withLeeway(settings: SilenceSettings): SilenceSettings {
  return { ...settings, minSilenceSec: settings.minSilenceSec + LEEWAY.silenceSec, paddingSec: settings.paddingSec + LEEWAY.paddingSec }
}

export interface DroppedClip {
  /** The cut clip, kept like any step clip. */
  file: BankFile
  /** His words in it, on the cut clip's own timeline - its captions. */
  words: CaptionWord[]
  /** What he says in it, as one line. */
  text: string
}

export type DropPhase = 'model' | 'listening' | 'cutting'

/** One clip heard and cut, nothing kept: the cut clip, his words in it on
 *  its own clock, what he says. Run on the phone (prepareClip) or on the
 *  Cutter server (serverTalk.ts) with the same settings. */
export async function cutDropped(
  file: Blob,
  { settings, cleanSpeech, voice, names, onPhase }: { settings: SilenceSettings; cleanSpeech: boolean; voice: boolean; names: string[]; onPhase?: (phase: DropPhase, fraction: number) => void },
): Promise<{ blob: Blob; words: CaptionWord[]; text: string }> {
  const plan = await listen(
    file,
    settings,
    { cleanSpeech, hear: true, names, align: true },
    { onModelDownload: (p) => onPhase?.('model', p), onTranscribeProgress: (p) => onPhase?.('listening', p) },
  )
  const heard = captionWords(plan.spoken ?? plan.words, plan.keep, { rough: !plan.aligned })
  if (plan.keep.length === 0 || heard.length === 0) throw new Error('no talking heard in it')
  onPhase?.('cutting', 0)
  const look = { ...videoLook(blankCampaign('drop-in'), blankAngle('drop-in', 'Drop-in')), effects: NO_EFFECTS }
  const made = await renderCampaignCut(
    file,
    { keep: plan.keep, look, headlineText: '', logoMoments: [], soundMoments: [], brandMoments: [], pictureMoments: [], bankCues: [], seed: 'drop-in', captions: [], voice },
    (p) => onPhase?.('cutting', p),
  )
  // On the cut's own clock, as its captions are drawn.
  const words = heard.map((w) => ({ text: w.text, start: cutTime(w.start, plan.keep), end: cutTime(w.end, plan.keep) }))
  return { blob: made.blob, words, text: words.map((w) => w.text.trim()).join(' ') }
}

/** The settings a drop-in cuts with, from his own on this phone. */
export function dropSettings(): { settings: SilenceSettings; cleanSpeech: boolean; voice: boolean } {
  const own = videoSettings()
  return { settings: withLeeway(PRESETS[own.preset]), cleanSpeech: own.cleanSpeech, voice: own.voice }
}

/** The name a cut clip is kept under. */
export const cutName = (name: string) => name.replace(/\.[^./]+$/, '') + '.mp4'

/** One clip heard, cut and kept on this phone. `names`: the campaign's
 *  brand words, so they are heard right. */
export async function prepareClip(
  file: File,
  { names, onPhase, from: given }: { names: string[]; onPhase?: (phase: DropPhase, fraction: number) => void; from?: string },
): Promise<DroppedClip> {
  const from = given ?? (await fingerprint(file))
  const cut = await cutDropped(file, { ...dropSettings(), names, onPhase })
  const id = crypto.randomUUID()
  await saveBankFile(id, cut.blob)
  const seconds = (await filmingOf(cut.blob).catch(() => null))?.seconds
  const kept: BankFile = { id, name: cutName(file.name), type: 'video/mp4', size: cut.blob.size, fp: await fingerprint(cut.blob), from, ...(seconds ? { seconds } : {}) }
  rememberWords(kept, cut.words)
  return { file: kept, words: cut.words, text: cut.text }
}
