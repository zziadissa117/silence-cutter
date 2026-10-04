// One raw video in, one finished campaign video out, in two steps that can
// happen apart:
//
//   listen - find the pauses, and hear every word (telling the model the
//            names first). The slow, memory-heavy part.
//   make   - cut and brand it for one campaign and angle, in a single render,
//            from what was heard.
//
// Picking a campaign and angle first runs the two back to back. Dropping a
// whole day listens to every video, sorts them, waits for his approval, and
// only then makes each - without listening again.

import type { AngleEffects } from './effects'
import { SilenceCutError } from '../media/errors'
import { isFillerWordDetectionSupported } from '../media/fillerWords'
import { cutSilence, cutSilenceFromFile } from '../media/silenceCut'
import { totalDuration, type SilenceSettings } from '../media/silenceMath'
import { findMentions, firing, listeningPrompt } from './keywords'
import {
  angleProblems,
  campaignProblems,
  videoLook,
  wordsToHear,
  type Angle,
  type AngleMusic,
  type BankPicture,
  type Campaign,
} from './look'
import { manualCues, type ManualPicture } from './manualPictures'
import { cutNoiseOn } from './noiseSetting'
import { captionWords, type CaptionPosition, type CaptionWord } from './captions'
import type { ClipPlace, JoinedClips } from './clips'
import { planCampaignCut, type CampaignPlan } from './plan'
import { renderMontage } from './montageRender'
import { talksIn } from './reaction'
import { renderReaction } from './reactionRender'
import { renderCampaignCut } from './render'
import { firstLineHeadline } from './sort'

export interface CampaignResult {
  blob: Blob
  storedAs: string | null
  originalDurationSec: number
  newDurationSec: number
  cuts: number
  /** Sounds with no speech that were cut and could have been quiet words: worth
   *  a listen (Edit again, Cuts). */
  soundsToCheck?: number
  /** What was heard and cut, when the video was heard inside makeCampaignVideo
   *  - kept so it can be edited again. */
  plan?: CampaignPlan
  fillerWords?: number
  stutters?: number
  /** When the logo came up in the finished video. */
  logoAt: number[]
  /** When any picture came up - the angle's own or the bank's - in order. */
  picturesAt: number[]
  /** The headline the video actually got. */
  headline: string
  /** Words the look listens for that were never heard, so he knows the logo
   *  or a sound did not fire - and why. The bank is not listed: most videos
   *  mention none of it, and that is fine. */
  notHeard: string[]
  /** A little of what the model did hear, shown only when something was
   *  missed, so he can see what it made of the name. */
  heardSample?: string
  /** Set when the look could not be added and this is the plain cut
   *  instead: why the look failed. */
  lookFailed?: string
  /** How many times the phone's decoder gave up partway and was picked up
   *  again from the last frame. */
  recovered?: number
  /** Every word he says in the finished video, for the caption written when
   *  it is posted. Absent for the plain cut. */
  said?: string
  /** A reaction video: how long each part came out, and whether he talked
   *  over the product. */
  reaction?: { reactionSec: number; productSec: number; talking: boolean }
  /** The videos joined on before and after him, and any that were meant to
   *  be but couldn't be read or weren't on the phone. Absent when none. */
  clips?: { beforeSec: number; afterSec: number; leftOut: ClipPlace[] }
  /** A video of clips and music, no talking: how long each clip came out,
   *  the track under it, and why it went without one when it had to. */
  montage?: { seconds: number[]; music: string | null; musicFailed?: string }
  /** A talking video: the name of the track under it, when there is one. */
  music?: string
}

export interface CampaignCallbacks {
  onAnalyseProgress?: (fraction: number) => void
  onModelDownload?: (fraction: number) => void
  onTranscribeProgress?: (fraction: number) => void
  onRenderProgress?: (fraction: number) => void
}

const HEARD_SAMPLE_CHARS = 160

/** Finds the pauses and, when `hear` is set, every word - telling the model
 *  `names` first, so it writes them the way he typed them. */
export async function listen(
  file: Blob,
  settings: SilenceSettings,
  {
    cleanSpeech,
    hear,
    names,
    align = false,
    quietIsFine = false,
    keepWhole = false,
    cutNoise = cutNoiseOn(),
  }: { cleanSpeech: boolean; hear: boolean; names: string[]; align?: boolean; quietIsFine?: boolean; keepWhole?: boolean; cutNoise?: boolean },
  callbacks: CampaignCallbacks = {},
): Promise<CampaignPlan> {
  if (hear && !isFillerWordDetectionSupported()) {
    throw new SilenceCutError(
      "This browser can't run the speech model, so it can't hear what is said. Try Safari or Chrome.",
    )
  }
  // Cutting noise needs the words, so it listens even when nothing else
  // wanted them - where this browser can run the speech model at all.
  const wantNoise = cutNoise && !quietIsFine && !keepWhole && isFillerWordDetectionSupported()
  return planCampaignCut(file, settings, {
    cleanSpeech,
    listen: hear || wantNoise,
    prompt: listeningPrompt(names),
    align,
    quietIsFine,
    keepWhole,
    cutNoise: wantNoise,
    onAnalyseProgress: callbacks.onAnalyseProgress,
    onModelDownload: callbacks.onModelDownload,
    onTranscribeProgress: callbacks.onTranscribeProgress,
  })
}

function refuseBroken(campaign: Campaign, angle: Angle): void {
  const problems = [...campaignProblems(campaign), ...angleProblems(campaign, angle)]
  if (problems.length > 0) {
    throw new SilenceCutError(`${campaign.name || 'This campaign'} · ${angle.name} needs fixing first: ${problems.join(' ')}`)
  }
}

/** The headline a video starts with: the angle's own, or - for an angle that
 *  makes it from the first line - his own first line. */
export function headlineFor(angle: Angle, plan: CampaignPlan, given: string): string {
  return angle.headline.fromFirstLine ? firstLineHeadline(plan.words) : given
}

/** Cuts and brands a video that has already been listened to. */
export async function make(
  file: Blob,
  plan: CampaignPlan,
  campaign: Campaign,
  angle: Angle,
  bank: BankPicture[],
  headlineText: string,
  seed: string,
  onRenderProgress?: (fraction: number) => void,
  /** No zooms - a second go after the phone's decoder gave up. */
  gentle = false,
  /** One word at a time, burned in. Empty for none. */
  captions: CaptionWord[] = [],
  /** Makes the voice louder and clearer. */
  voice = false,
  /** The track under his voice: the angle's own when not given, none when
   *  null. */
  music?: AngleMusic | null,
  /** Videos joined on before and after him. */
  clips: JoinedClips = {},
  /** The effects for an angle that sets none; null for none on this video. */
  defaults: AngleEffects | null = null,
  /** Picture ids left out of this video. */
  skipPictures: readonly string[] = [],
  /** Where the captions sit on the frame. */
  captionPosition: CaptionPosition = 'usual',
  /** Made 9:16 even when the Wide clips setting is Off (he asked for 9:16). */
  forceVertical = false,
  /** Pictures he put on this video by hand, each with its image. */
  manual: { picture: ManualPicture; image: Blob }[] = [],
): Promise<CampaignResult> {
  refuseBroken(campaign, angle)
  const base = videoLook(campaign, angle, bank, defaults, skipPictures)
  // A picture put on by hand is just another picture cue, shown at the moment
  // he picked instead of when words are said.
  const hand = manualCues(manual.map((m) => m.picture), new Map(manual.map((m) => [m.picture.id, m.image])))
  const look = { ...base, pictures: [...base.pictures, ...hand.cues] }
  const track = music === undefined ? (angle.music ?? null) : music

  const notHeard: string[] = []
  const logoMoments = look.logo.image ? firing(findMentions(plan.words, look.logo.words), look.mentions) : []
  if (look.logo.image && logoMoments.length === 0) notHeard.push(...look.logo.words)
  const brandMoments =
    look.effects.brandHit === 'off' ? [] : firing(findMentions(plan.words, look.brandWords), look.mentions)
  if (look.effects.brandHit !== 'off' && brandMoments.length === 0) notHeard.push(...look.brandWords)
  const pictureMoments = look.pictures.map((picture) => {
    const handAt = hand.at.get(picture.id)
    if (handAt !== undefined) return [handAt]
    const moments = firing(findMentions(plan.words, picture.words), look.mentions)
    if (moments.length === 0) notHeard.push(...picture.words)
    return moments
  })
  // Only the bank pictures actually mentioned go to the render - a big bank
  // costs nothing for the pictures a video never uses.
  const bankCues = look.bankPictures
    .map((picture) => ({ image: picture.image, moments: firing(findMentions(plan.words, picture.words), look.mentions) }))
    .filter((cue) => cue.moments.length > 0)
  const anyPicture = [...pictureMoments.flat(), ...bankCues.flatMap((c) => c.moments)].sort((a, b) => a - b)
  const soundMoments = look.sounds.map((sound) => {
    if (sound.trigger.kind === 'picture') return anyPicture
    if (sound.trigger.kind !== 'words') return []
    const moments = firing(findMentions(plan.words, sound.trigger.words), look.mentions)
    if (moments.length === 0) notHeard.push(...sound.trigger.words)
    return moments
  })

  const rendered = await renderCampaignCut(
    file,
    {
      keep: plan.keep,
      look,
      headlineText,
      logoMoments,
      soundMoments,
      brandMoments,
      pictureMoments,
      bankCues,
      seed,
      gentle,
      captions,
      captionPosition,
      forceVertical,
      voice,
      music: track ? { audio: track.audio, level: track.level } : null,
      clips: { before: clips.before, after: clips.after },
    },
    onRenderProgress,
  )
  const joined = { ...rendered.clips, leftOut: [...(clips.missing ?? []), ...rendered.clips.leftOut] }

  const missed = [...new Map(notHeard.map((w) => [w.toLowerCase(), w])).values()]
  const heard = plan.words.map((w) => w.text.trim()).join(' ')
  return {
    blob: rendered.blob,
    storedAs: rendered.storedAs,
    originalDurationSec: plan.duration,
    newDurationSec: totalDuration(plan.keep) + joined.beforeSec + joined.afterSec,
    cuts: plan.silences,
    ...(plan.checks?.some((c) => c.cut && c.kind === 'maybe-word') ? { soundsToCheck: plan.checks.filter((c) => c.cut && c.kind === 'maybe-word').length } : {}),
    ...(plan.cleanSpeech ? { fillerWords: plan.fillerWords, stutters: plan.stutters } : {}),
    ...(joined.beforeSec || joined.afterSec || joined.leftOut.length ? { clips: joined } : {}),
    ...(track ? { music: track.name } : {}),
    logoAt: rendered.logoAt,
    picturesAt: [...rendered.picturesAt.flat(), ...rendered.bankAt].sort((a, b) => a - b),
    headline: headlineText,
    notHeard: missed,
    recovered: rendered.recovered,
    said: captionWords(plan.spoken ?? plan.words, plan.keep)
      .map((w) => w.text.trim())
      .filter(Boolean)
      .join(' '),
    ...(missed.length > 0
      ? { heardSample: heard.length > HEARD_SAMPLE_CHARS ? `${heard.slice(0, HEARD_SAMPLE_CHARS)}…` : heard }
      : {}),
  }
}

/** Both steps for a video whose campaign and angle he picked himself. */
export async function makeCampaignVideo(
  file: Blob,
  campaign: Campaign,
  angle: Angle,
  bank: BankPicture[],
  headlineText: string,
  settings: SilenceSettings,
  cleanSpeech: boolean,
  /** Makes this video's effect variations its own. */
  seed: string,
  callbacks: CampaignCallbacks = {},
  gentle = false,
  voice = false,
  clips: JoinedClips = {},
  /** Nothing is cut; it is only made 9:16 (a wide clip he did not want cut). */
  noCut = false,
  /** The effects for an angle that sets none; null for none. */
  defaults: AngleEffects | null = null,
): Promise<CampaignResult> {
  refuseBroken(campaign, angle)
  const names = wordsToHear(videoLook(campaign, angle, bank))
  const plan = await listen(
    file,
    settings,
    {
      cleanSpeech,
      hear: names.length > 0 || cleanSpeech || Boolean(angle.headline.fromFirstLine),
      // The brand first, so the model knows it before anything else.
      names: [...campaign.brandWords, ...names],
      keepWhole: noCut,
    },
    callbacks,
  )
  const made = await make(file, plan, campaign, angle, bank, headlineFor(angle, plan, headlineText), seed, callbacks.onRenderProgress, gentle, [], voice, undefined, clips, defaults, [], 'usual', noCut)
  return { ...made, plan }
}

/** A reaction video: the reaction clip whole with the headline over it,
 *  then the product clip - with its pauses cut and captions when he talks
 *  over it (the plan is the product clip's, listened to first), whole when
 *  he doesn't. */
export async function makeReaction(
  reaction: Blob,
  product: Blob,
  plan: CampaignPlan | undefined,
  campaign: Campaign,
  angle: Angle,
  headlineText: string,
  onRenderProgress?: (fraction: number) => void,
  captions: CaptionWord[] = [],
  voice = false,
  music?: AngleMusic | null,
  /** What varies per video: its seed, the default effects for an angle with
   *  none (null for none), and where its captions sit. */
  extra: { seed?: string; defaults?: AngleEffects | null; captionPosition?: CaptionPosition } = {},
): Promise<CampaignResult> {
  const talking = plan ? talksIn(plan.words, plan.keep) : false
  const track = music === undefined ? (angle.music ?? null) : music
  const rendered = await renderReaction(
    {
      reaction,
      product,
      productKeep: talking && plan ? plan.keep : null,
      look: videoLook(campaign, angle, [], extra.defaults ?? null),
      headlineText,
      seed: extra.seed,
      captionPosition: extra.captionPosition,
      switchSound: campaign.switchSound === 'none' ? null : (campaign.switchSound ?? 'whoosh'),
      captions: talking ? captions : [],
      voice,
      music: track ? { audio: track.audio, level: track.level } : null,
    },
    onRenderProgress,
  )
  return {
    blob: rendered.blob,
    storedAs: rendered.storedAs,
    originalDurationSec: rendered.reactionSec + (plan?.duration ?? rendered.productSec),
    newDurationSec: rendered.totalSec,
    cuts: talking && plan ? plan.silences : 0,
    logoAt: [],
    picturesAt: [],
    headline: headlineText,
    notHeard: [],
    said:
      talking && plan
        ? captionWords(plan.spoken ?? plan.words, plan.keep)
            .map((w) => w.text.trim())
            .filter(Boolean)
            .join(' ')
        : '',
    reaction: { reactionSec: rendered.reactionSec, productSec: rendered.productSec, talking },
  }
}

/** A video with no talking: the clips one after another, the headline on
 *  the first, the music the only sound. */
export async function makeMontage(
  clips: Blob[],
  campaign: Campaign,
  angle: Angle,
  headlineText: string,
  music: { audio: Blob; name: string } | null,
  onRenderProgress?: (fraction: number) => void,
  extra: { seed?: string; defaults?: AngleEffects | null } = {},
): Promise<CampaignResult> {
  const rendered = await renderMontage(
    { clips, look: videoLook(campaign, angle, [], extra.defaults ?? null), headlineText, music, seed: extra.seed },
    onRenderProgress,
  )
  return {
    blob: rendered.blob,
    storedAs: rendered.storedAs,
    originalDurationSec: rendered.totalSec,
    newDurationSec: rendered.totalSec,
    cuts: 0,
    logoAt: [],
    picturesAt: [],
    headline: headlineText.trim(),
    notHeard: [],
    said: '',
    montage: {
      seconds: rendered.seconds,
      music: music && !rendered.musicFailed ? music.name : null,
      ...(rendered.musicFailed ? { musicFailed: rendered.musicFailed } : {}),
    },
  }
}

/** The way out when the look will not go on: the same cut, plain, made by
 *  the plain cutter's own render - the part that has always worked. He still
 *  has a video to post; the headline and logo can go on in TikTok.
 *
 *  With the day's plan in hand the cut is exactly the one he approved;
 *  without it (a video for a chosen angle) the pauses are found again. */
export async function plainCut(
  file: Blob,
  plan: CampaignPlan | undefined,
  settings: SilenceSettings,
  why: string,
  onProgress?: (fraction: number) => void,
): Promise<CampaignResult> {
  const empty = { logoAt: [], picturesAt: [], headline: '', notHeard: [], lookFailed: why }
  if (plan) {
    const { blob, storedAs } = await cutSilence(file, plan.keep, onProgress)
    return {
      blob,
      storedAs,
      originalDurationSec: plan.duration,
      newDurationSec: totalDuration(plan.keep),
      cuts: plan.silences,
      ...empty,
    }
  }
  const cut = await cutSilenceFromFile(file, onProgress, settings)
  return {
    blob: cut.blob,
    storedAs: cut.storedAs,
    originalDurationSec: cut.originalDurationSec,
    newDurationSec: cut.newDurationSec,
    cuts: cut.cuts,
    ...empty,
  }
}
