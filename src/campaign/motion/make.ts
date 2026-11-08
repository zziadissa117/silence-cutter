// A motion graphics video, from his recording: heard and cut like any talking
// video (pipeline.listen), its words to Claude for the storyboard, then made
// in the same one-pass render as every campaign video (render.ts) with the
// storyboard drawn on - his captions and voice settings as on Videos.
// Nothing of a campaign: no headline, logo, music or effects.

import { PRESETS, type PresetName } from '../../media/silenceMath'
import { captionAt, captionRanges, captionScale, captionWords, cutTime, defaultCaptionSize, defaultCaptionStyle, drawStyledCaption, drawnWords, CAPTION_LEAD, PHRASE_HOLD_SEC, type CaptionPosition, type CaptionSize, type CaptionStyle, type CaptionWord } from '../captions'
import { NO_EFFECTS } from '../effects'
import { blankAngle, blankCampaign, videoLook } from '../look'
import { listen, type CampaignCallbacks } from '../pipeline'
import type { CampaignPlan } from '../plan'
import { renderCampaignCut } from '../render'
import { formatOf, type EmphasisStyle, type Storyboard } from '../../../supabase/functions/postiz/motion.ts'
import { captionPositionAt, type Timing } from './draw'
import { CAPTION_CENTER, kineticPhrases, type Kinetic } from './glass'
import { motionSounds, soundsByName } from './sfx'

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

/** What Claude is sent to plan from: the words as heard - the storyboard's
 *  numbers point at them - each with the wording he approved on the caption
 *  check, so the graphics spell names and numbers the way he fixed them. */
export function claudeWords(plan: CampaignPlan, choice: CaptionChoice | undefined): { words: string[]; times: number[] } {
  const heard = storyWords(plan)
  const sent = forClaude(heard, plan)
  const fixed = choice?.edited ? captionWords(choice.edited, plan.keep, { rough: !plan.aligned }) : null
  if (!fixed || fixed.length === 0) return sent
  return {
    ...sent,
    words: heard.map((w, i) => {
      let best = 0
      for (let j = 1; j < fixed.length; j++) if (Math.abs(fixed[j].start - w.start) < Math.abs(fixed[best].start - w.start)) best = j
      return Math.abs(fixed[best].start - w.start) < 0.35 ? fixed[best].text.trim() : sent.words[i]
    }),
  }
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

/** The storyboard's sound effects as render.ts takes them: none when he
 *  turned them off for this video. */
export function soundsFor(plan: CampaignPlan, board: Storyboard, on = true): ReturnType<typeof soundsByName> {
  if (!on) return []
  const heard = storyWords(plan)
  return soundsByName(motionSounds(board, (i) => heard[i]?.start ?? Infinity))
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

/** The glass look's captions: as they will show (his fixes in), split into
 *  phrases, and the words Claude picked to stand out - matched from
 *  the words as heard by when they are said, so his retyping never moves
 *  them. Empty with captions off. */
export function kineticFor(
  plan: CampaignPlan,
  choice: CaptionChoice | undefined,
  board: Storyboard,
): { words: CaptionWord[]; phrases: [number, number][]; styles: (EmphasisStyle | null)[]; centerY: number; scale: number } {
  const words = shownCaptions(plan, choice)
  const heard = storyWords(plan)
  const styles: (EmphasisStyle | null)[] = words.map(() => null)
  for (const e of board.emphasis ?? []) {
    const at = heard[e.at]?.start
    if (at === undefined) continue
    let best = -1
    for (let i = 0; i < words.length; i++) if (best < 0 || Math.abs(words[i].start - at) < Math.abs(words[best].start - at)) best = i
    if (best >= 0 && Math.abs(words[best].start - at) < 0.35) styles[best] = e.style
  }
  // Where and how big he put the captions on the caption screen.
  const look = captionLook(choice)
  return { words, phrases: kineticPhrases(words), styles, centerY: CAPTION_CENTER[look.position], scale: captionScale(look.size) }
}

/** The block as draw.ts takes it, for a still before it is made. */
export function kineticStill(made: ReturnType<typeof kineticFor>, timing: Timing): Kinetic {
  return { words: made.words, phrases: made.phrases, timing, styleOf: (i) => made.styles[i] ?? null, centerY: made.centerY, scale: made.scale }
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
  /** Sound effects on (the default) or off for this video. */
  sounds = true,
): Promise<{ blob: Blob; storedAs: string | null }> {
  const settings = videoSettings()
  const words = storyWords(plan)
  const caption = captionLook(choice)
  // The glass look draws its own captions, in its bar; and, like his
  // example, the shot moves a little closer or back out at the cuts.
  const ownCaptions = formatOf(board) === 'glass'
  const look = { ...videoLook(blankCampaign('motion'), blankAngle('motion', 'Motion graphics')), effects: { ...NO_EFFECTS, ...(ownCaptions ? { cutPunch: 'subtle' as const } : {}) } }
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
      // In the glass look the bar under his face is the caption.
      captions: ownCaptions ? [] : shownCaptions(plan, choice),
      captionPosition: caption.position,
      captionSize: caption.size,
      captionStyle: caption.style,
      voice: settings.voice,
      motion: { board, words, sounds: soundsFor(plan, board, sounds), ...(ownCaptions ? { kinetic: kineticFor(plan, choice, board) } : {}) },
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
  /** The graphics, so a caption set high drops under the board while it is up. */
  board?: { storyboard: Storyboard; timing: Timing },
): void {
  if (shown.length === 0) return
  const look = captionLook(choice)
  const { size, style } = look
  const position = board ? captionPositionAt(board.storyboard, board.timing, t, look.position) : look.position
  const starts = shown.map((w) => cutTime(w.start, keep))
  const index = captionAt(starts, shown, t, style === 'word' ? undefined : PHRASE_HOLD_SEC)
  if (index < 0) return
  drawStyledCaption(ctx as OffscreenCanvasRenderingContext2D, width, height, shown, captionRanges(shown, style), index, t + CAPTION_LEAD - starts[index], false, position, size, style)
}
