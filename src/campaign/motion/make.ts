// A motion graphics video, from his recording: heard and cut like any talking
// video (pipeline.listen), its words to Claude for the storyboard, then made
// in the same one-pass render as every campaign video (render.ts) with the
// storyboard drawn on - his captions and voice settings as on Videos.
// Nothing of a campaign: no headline, logo, music or effects.

import { PRESETS, type PresetName } from '../../media/silenceMath'
import { captionAt, captionRanges, captionWords, cutTime, defaultCaptionSize, defaultCaptionStyle, drawStyledCaption, drawnWords, CAPTION_LEAD, PHRASE_HOLD_SEC, type CaptionPosition, type CaptionSize, type CaptionStyle, type CaptionWord } from '../captions'
import { NO_EFFECTS } from '../effects'
import { blankAngle, blankCampaign, videoLook } from '../look'
import { listen, type CampaignCallbacks } from '../pipeline'
import type { CampaignPlan } from '../plan'
import { renderCampaignCut } from '../render'
import type { Storyboard } from '../../../supabase/functions/postiz/motion.ts'

/** A setting of the Videos tab, as it keeps it on this phone (CampaignApp
 *  usePref), so a motion video is cut and captioned the way his others are. */
function pref(key: string, initial: string): string {
  try {
    return localStorage.getItem(key) ?? initial
  } catch {
    return initial
  }
}

export function videoSettings(): { preset: PresetName; cleanSpeech: boolean; captions: boolean; bare: boolean; voice: boolean } {
  const preset = pref('campaign.pacing', 'balanced')
  return {
    preset: preset in PRESETS ? (preset as PresetName) : 'balanced',
    cleanSpeech: pref('campaign.cleanSpeech', 'false') === 'true',
    captions: pref('campaign.captions', 'true') === 'true',
    bare: pref('campaign.bareCaptions', 'false') === 'true',
    voice: pref('campaign.voice', 'true') === 'true',
  }
}

/** Finds the pauses and hears every word, timed exactly for the captions. */
export async function hear(file: Blob, callbacks: CampaignCallbacks): Promise<CampaignPlan> {
  const settings = videoSettings()
  return listen(file, PRESETS[settings.preset], { cleanSpeech: settings.cleanSpeech, hear: true, names: [], align: true }, callbacks)
}

/** The words the storyboard's numbers point at: what is said in the cut
 *  video, "um"s left out - the captions' words. */
export function storyWords(plan: CampaignPlan): CaptionWord[] {
  return captionWords(plan.spoken ?? plan.words, plan.keep, { rough: !plan.aligned })
}

/** What Claude is sent: the words and when each is said in the cut video. */
export function forClaude(words: readonly CaptionWord[], plan: CampaignPlan): { words: string[]; times: number[] } {
  return { words: words.map((w) => w.text.trim()), times: words.map((w) => Math.round(cutTime(w.start, plan.keep) * 10) / 10) }
}

/** His caption choices for this one video, made on the Cutter's own caption
 *  screen (CaptionReview): the words as he fixed them (on the recording's
 *  timeline, as heard), or none at all, and where / how big / which style.
 *  Anything not chosen is his Videos default. */
export interface CaptionChoice {
  edited?: CaptionWord[]
  off?: boolean
  position?: CaptionPosition
  size?: CaptionSize
  style?: CaptionStyle
}

/** The captions as they will be burned in: his fixed words fitted to the cut,
 *  or the words heard - none when he turned them off. */
export function shownCaptions(plan: CampaignPlan, choice: CaptionChoice = {}): CaptionWord[] {
  const settings = videoSettings()
  if (choice.off ?? (!settings.captions && !choice.edited)) return []
  const fitted = choice.edited ? captionWords(choice.edited, plan.keep, { rough: !plan.aligned }) : storyWords(plan)
  return drawnWords(fitted, settings.bare)
}

/** The words his caption screen opens on: his fixed ones, or every word
 *  heard, on the whole recording's timeline - as Videos opens it. */
export function captionsToEdit(plan: CampaignPlan, choice: CaptionChoice = {}): CaptionWord[] {
  return choice.edited ?? captionWords(plan.spoken ?? plan.words, [{ start: 0, end: plan.duration }])
}

export function captionLook(choice: CaptionChoice = {}): { position: CaptionPosition; size: CaptionSize; style: CaptionStyle } {
  return { position: choice.position ?? 'usual', size: choice.size ?? defaultCaptionSize(), style: choice.style ?? defaultCaptionStyle() }
}

/** The finished video. The storyboard's word numbers stay on the words as
 *  heard (storyWords), whatever he types into the captions. */
export async function makeMotionVideo(
  file: Blob,
  plan: CampaignPlan,
  board: Storyboard,
  seed: string,
  onProgress?: (fraction: number) => void,
  choice: CaptionChoice = {},
): Promise<{ blob: Blob; storedAs: string | null }> {
  const settings = videoSettings()
  const words = storyWords(plan)
  const caption = captionLook(choice)
  const look = { ...videoLook(blankCampaign('motion'), blankAngle('motion', 'Motion graphics')), effects: { ...NO_EFFECTS } }
  const rendered = await renderCampaignCut(
    file,
    {
      keep: plan.keep,
      look,
      headlineText: '',
      logoMoments: [],
      soundMoments: [],
      brandMoments: [],
      pictureMoments: [],
      bankCues: [],
      seed,
      captions: shownCaptions(plan, choice),
      captionPosition: caption.position,
      captionSize: caption.size,
      captionStyle: caption.style,
      voice: settings.voice,
      motion: { board, words },
    },
    onProgress,
  )
  return { blob: rendered.blob, storedAs: rendered.storedAs }
}

/** The caption at `t` of the cut video, drawn as the render will - for the
 *  plan screen's stills. `shown`: shownCaptions. */
export function drawCaptionAt(
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  width: number,
  height: number,
  shown: CaptionWord[],
  keep: CampaignPlan['keep'],
  t: number,
  choice: CaptionChoice = {},
): void {
  if (shown.length === 0) return
  const { position, size, style } = captionLook(choice)
  const starts = shown.map((w) => cutTime(w.start, keep))
  const index = captionAt(starts, shown, t, style === 'word' ? undefined : PHRASE_HOLD_SEC)
  if (index < 0) return
  drawStyledCaption(ctx as OffscreenCanvasRenderingContext2D, width, height, shown, captionRanges(shown, style), index, t + CAPTION_LEAD - starts[index], false, position, size, style)
}
