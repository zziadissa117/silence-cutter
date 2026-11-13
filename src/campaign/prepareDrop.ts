// Many short clips of him dropped into a talking head format at once (his
// ask, 2026-11-13: "I paste in every single video that I take. It's over 45
// different videos of me just starting, saying a phrase, and then ending it
// ... Automatically, the cutter cuts the videos and cuts the awkward
// silences ... puts captions ... and then you assign them to the product
// steps"). Each is heard and cut exactly the way the Cutter cuts his talking
// videos - his own pacing, his voice on his mic, the same zooms - and he
// checks every one after (DropCheck.tsx): where it goes, and its captions.
//
// The "little more room" it first had is gone (his report, 2026-11-13: "it's
// not cutting good enough ... remove the leeway, just cut like the cutter is
// already doing and make sure to use my voice").

import { PRESETS, type SilenceSettings } from '../media/silenceMath'
import type { BankFile } from './batch'
import { captionWords, cutTime, type CaptionWord } from './captions'
import { NO_EFFECTS, type AngleEffects } from './effects'
import { filmingOf } from './filming'
import { fingerprint } from './fingerprint'
import { blankAngle, blankCampaign, videoLook } from './look'
import { wordMoments } from './moments'
import { videoSettings } from './motion/make'
import { listen } from './pipeline'
import { renderCampaignCut } from './render'
import { saveBankFile } from './store'
import { voicesHere, type Voices } from './voiceProfile'

export interface DroppedClip {
  /** The cut clip, kept like any step clip. */
  file: BankFile
  /** His words in it, on the cut clip's own timeline - its captions. */
  words: CaptionWord[]
  /** What he says in it, as one line. */
  text: string
}

export type DropPhase = 'model' | 'listening' | 'cutting'

/** How a clip is cut: his settings and voices, and the zooms. */
export interface DropCut {
  settings: SilenceSettings
  cleanSpeech: boolean
  voice: boolean
  /** His voices, so the cut follows his own pacing on his mic. */
  voices?: Voices
  /** The zooms his talking videos get - punch-ins at the cuts, a push-in, a
   *  hit on the brand's name (effects.ts). None: no zooms. */
  effects?: AngleEffects
  /** The brand's words, for the hit on its name. */
  brandWords?: string[]
}

/** One clip heard and cut, nothing kept: the cut clip, his words in it on
 *  its own clock, what he says. Run on the phone (prepareClip) or on the
 *  Cutter server (serverTalk.ts) with the same settings. `seed`: the same
 *  recording always gets the same zooms. */
export async function cutDropped(
  file: Blob,
  { settings, cleanSpeech, voice, voices, effects = NO_EFFECTS, brandWords = [], names, seed = 'drop-in', onPhase }: DropCut & { names: string[]; seed?: string; onPhase?: (phase: DropPhase, fraction: number) => void },
): Promise<{ blob: Blob; words: CaptionWord[]; text: string }> {
  const plan = await listen(
    file,
    settings,
    { cleanSpeech, hear: true, names, align: true, ...(voices ? { voices } : {}) },
    { onModelDownload: (p) => onPhase?.('model', p), onTranscribeProgress: (p) => onPhase?.('listening', p) },
  )
  const heard = captionWords(plan.spoken ?? plan.words, plan.keep, { rough: !plan.aligned })
  if (plan.keep.length === 0 || heard.length === 0) throw new Error('no talking heard in it')
  onPhase?.('cutting', 0)
  // The Cutter's own zooms, nothing else: no headline, logo, pictures or
  // captions - the batch video draws those over it.
  const look = { ...videoLook(blankCampaign('drop-in'), blankAngle('drop-in', 'Drop-in')), effects: { ...effects, logoPop: false }, brandWords }
  const moments = wordMoments(plan, look)
  const made = await renderCampaignCut(
    file,
    { keep: plan.keep, look, headlineText: '', logoMoments: [], soundMoments: [], brandMoments: moments.brand, pictureMoments: [], bankCues: [], seed, captions: [], voice },
    (p) => onPhase?.('cutting', p),
  )
  // On the cut's own clock, as its captions are drawn.
  const words = heard.map((w) => ({ text: w.text, start: cutTime(w.start, plan.keep), end: cutTime(w.end, plan.keep) }))
  return { blob: made.blob, words, text: words.map((w) => w.text.trim()).join(' ') }
}

/** How a clip is cut, from his own settings and voices on this phone - the
 *  same as his talking videos - with the campaign's zooms. */
export function dropSettings(zoom: { effects?: AngleEffects; brandWords?: string[] } = {}): DropCut {
  const own = videoSettings()
  return { settings: { ...PRESETS[own.preset] }, cleanSpeech: own.cleanSpeech, voice: own.voice, voices: voicesHere(), ...zoom }
}

/** The name a cut clip is kept under. */
export const cutName = (name: string) => name.replace(/\.[^./]+$/, '') + '.mp4'

/** One clip heard, cut and kept on this phone. `names`: the campaign's
 *  brand words, so they are heard right. */
export async function prepareClip(
  file: Blob,
  { name, names, cut, onPhase, from: given }: { name: string; names: string[]; cut: DropCut; onPhase?: (phase: DropPhase, fraction: number) => void; from?: string },
): Promise<DroppedClip> {
  const from = given ?? (await fingerprint(file))
  const made = await cutDropped(file, { ...cut, names, seed: from, onPhase })
  const id = crypto.randomUUID()
  await saveBankFile(id, made.blob)
  const seconds = (await filmingOf(made.blob).catch(() => null))?.seconds
  const kept: BankFile = {
    id,
    name: cutName(name),
    type: 'video/mp4',
    size: made.blob.size,
    fp: await fingerprint(made.blob),
    from,
    edited: true,
    ...(seconds ? { seconds } : {}),
  }
  return { file: kept, words: made.words, text: made.text }
}
