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

import { SilenceCutError } from '../media/errors'
import { PRESETS, type Range, type SilenceSettings } from '../media/silenceMath'
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

/** Any of the Cutter's zooms on (effects.ts): punch-ins, the push-in, the brand hit. */
export const hasZooms = (effects: AngleEffects): boolean => effects.cutPunch !== 'off' || effects.hookPush !== 'off' || effects.brandHit !== 'off'

/** A pause between his phrases this long or longer is where an uncut clip's
 *  shot may punch in or out. */
const PHRASE_GAP_SEC = 0.25

/** The whole of a clip in pieces, split in the middle of each pause between
 *  his phrases - nothing taken out. The pieces are what the zooms move
 *  between, as they do between the cuts of a cut clip; where they touch,
 *  the sound runs straight on (cutFades.cutEdges). */
export function phrasePieces(words: readonly { start: number; end: number }[], duration: number): Range[] {
  const pieces: Range[] = []
  let from = 0
  for (let i = 1; i < words.length; i++) {
    if (words[i].start - words[i - 1].end < PHRASE_GAP_SEC) continue
    const at = (words[i - 1].end + words[i].start) / 2
    if (at > from && at < duration) {
      pieces.push({ start: from, end: at })
      from = at
    }
  }
  pieces.push({ start: from, end: duration })
  return pieces
}

/** One clip heard and cut, nothing kept: the clip, his words in it on
 *  its own clock, what he says. Run on the phone (prepareClip) or on the
 *  Cutter server (serverTalk.ts) with the same settings. `seed`: the same
 *  recording always gets the same zooms; `effects`: the zooms, NO_EFFECTS
 *  for none (the drop-in checklist's Zoom unticked).
 *
 *  `asFilmed` (the drop-in checklist's "Cut the clips" unticked - he cut it
 *  himself): only heard, nothing taken out - given back as it is, or, with
 *  zooms, made again whole with them between his phrases (his ask,
 *  2026-11-14: "sometimes we also want editing, meaning zooming in on the
 *  clips"). A clip with no talking in it (a step he only shows) is kept that
 *  way too rather than failing (his ask, 2026-11-14: "moments where I don't
 *  need to talk. I just have to do something visually"). `cut`: anything
 *  was taken out; `remade`: an MP4 made here rather than his own file. */
export async function cutDropped(
  file: Blob,
  {
    settings,
    cleanSpeech,
    voice,
    voices,
    effects = NO_EFFECTS,
    brandWords = [],
    names,
    seed = 'drop-in',
    asFilmed = false,
    onPhase,
  }: DropCut & { names: string[]; seed?: string; asFilmed?: boolean; onPhase?: (phase: DropPhase, fraction: number) => void },
): Promise<{ blob: Blob; words: CaptionWord[]; text: string; cut: boolean; remade: boolean }> {
  const callbacks = { onModelDownload: (p: number) => onPhase?.('model', p), onTranscribeProgress: (p: number) => onPhase?.('listening', p) }
  // The Cutter's own zooms, nothing else: no headline, logo, pictures or
  // captions - the batch video draws those over it.
  const look = { ...videoLook(blankCampaign('drop-in'), blankAngle('drop-in', 'Drop-in')), effects: { ...effects, logoPop: false }, brandWords }
  const render = (keep: Range[], plan: Parameters<typeof wordMoments>[0]) => {
    onPhase?.('cutting', 0)
    const moments = wordMoments(plan, look)
    return renderCampaignCut(
      file,
      { keep, look, headlineText: '', logoMoments: [], soundMoments: [], brandMoments: moments.brand, pictureMoments: [], bankCues: [], seed, captions: [], voice },
      (p) => onPhase?.('cutting', p),
    )
  }
  if (!asFilmed) {
    // No talking found in it: kept as filmed, below.
    const plan = await listen(file, settings, { cleanSpeech, hear: true, names, align: true, ...(voices ? { voices } : {}) }, callbacks).catch((error: unknown) => {
      if (error instanceof SilenceCutError) return null
      throw error
    })
    const heard = plan ? captionWords(plan.spoken ?? plan.words, plan.keep, { rough: !plan.aligned }) : []
    if (plan && plan.keep.length > 0 && heard.length > 0) {
      const made = await render(plan.keep, plan)
      // On the cut's own clock, as its captions are drawn.
      const words = heard.map((w) => ({ text: w.text, start: cutTime(w.start, plan.keep), end: cutTime(w.end, plan.keep) }))
      return { blob: made.blob, words, text: words.map((w) => w.text.trim()).join(' '), cut: true, remade: true }
    }
  }
  // As filmed: heard on its own clock, the way a clip's captions are
  // (talkCaptions.talkWords) - quiet is fine, nothing is cut.
  const plan = await listen(file, settings, { cleanSpeech: false, hear: true, names, align: true, quietIsFine: true, keepWhole: true, cutNoise: false }, callbacks)
  const words = captionWords(plan.spoken ?? plan.words, [{ start: 0, end: plan.duration }], { rough: !plan.aligned })
  const text = words.map((w) => w.text.trim()).join(' ')
  // With his zooms: made again whole, the shot moving between his phrases.
  // The pieces touch, so its clock - and its words' - stays the recording's.
  if (hasZooms(effects) && plan.duration > 0) {
    const made = await render(phrasePieces(words, plan.duration), plan)
    return { blob: made.blob, words, text, cut: false, remade: true }
  }
  return { blob: file, words, text, cut: false, remade: false }
}

/** A video file's type, for a clip kept as he gave it: its own, or from its name. */
export function videoType(name: string, type: string): string {
  if (type.startsWith('video/')) return type
  return /\.mov$/i.test(name) ? 'video/quicktime' : /\.webm$/i.test(name) ? 'video/webm' : 'video/mp4'
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
 *  brand words, so they are heard right. `asFilmed`: only heard, kept as
 *  he gave it (cutDropped). */
export async function prepareClip(
  file: Blob,
  {
    name,
    names,
    cut,
    onPhase,
    from: given,
    asFilmed = false,
  }: { name: string; names: string[]; cut: DropCut; onPhase?: (phase: DropPhase, fraction: number) => void; from?: string; asFilmed?: boolean },
): Promise<DroppedClip> {
  const from = given ?? (await fingerprint(file))
  const made = await cutDropped(file, { ...cut, names, seed: from, asFilmed, onPhase })
  const id = crypto.randomUUID()
  await saveBankFile(id, made.blob)
  const seconds = (await filmingOf(made.blob).catch(() => null))?.seconds
  const kept: BankFile = {
    id,
    name: made.remade ? cutName(name) : name,
    type: made.remade ? 'video/mp4' : videoType(name, made.blob.type),
    size: made.blob.size,
    fp: await fingerprint(made.blob),
    from,
    ...(made.cut ? { edited: true } : { ownCut: true }),
    ...(seconds ? { seconds } : {}),
  }
  return { file: kept, words: made.words, text: made.text }
}
