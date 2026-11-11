// A talking clip for Trial reels (his ask, 2026-11-11): "a talking head video
// that has performed well ... make 10 different variations of that same clip
// ... the captions are going to be the exact same each time ... per video,
// the headline is going to be different. The music is going to be different."
//
// Made once, when he adds it: heard (pauses and "um"s found, every word), he
// checks the captions once, then the clip is cut once - every copy starts
// from that cut, so the words and captions are the same on all of them.
// The copies themselves are the Trial loop's (trialLoop.ts, TrialTalk).

import { BALANCED_SETTINGS } from '../media/silenceMath'
import { cutSilence } from '../media/silenceCut'
import { captionWords, cutTime, type CaptionWord } from './captions'
import { listen } from './pipeline'
import type { CampaignPlan } from './plan'

/** Heard once: where the pauses and "um"s are, and every word. */
export function hearTalk(file: Blob, names: string[], onProgress: (phase: 'model' | 'listening', p: number) => void): Promise<CampaignPlan> {
  return listen(
    file,
    BALANCED_SETTINGS,
    { cleanSpeech: true, hear: true, names, align: true },
    {
      onModelDownload: (p) => onProgress('model', p),
      onTranscribeProgress: (p) => onProgress('listening', p),
    },
  )
}

/** The captions to check, on the raw clip's own timeline. */
export function wordsToCheck(plan: CampaignPlan): CaptionWord[] {
  return captionWords(plan.spoken ?? plan.words, [{ start: 0, end: plan.duration }], { rough: !plan.aligned })
}

/** His checked captions fitted to the cut, then put on the cut clip's own
 *  timeline - what every copy draws. */
export function wordsOnCut(checked: CaptionWord[], plan: Pick<CampaignPlan, 'keep' | 'aligned'>): CaptionWord[] {
  return captionWords(checked, plan.keep, { rough: !plan.aligned })
    .map((w) => ({
      text: w.text,
      start: cutTime(w.start, plan.keep),
      end: cutTime(w.end, plan.keep),
    }))
    .filter((w) => w.end > w.start)
}

/** What he says, in one line, for Claude's headlines. */
export function spokenText(words: readonly CaptionWord[]): string {
  return words
    .map((w) => w.text.trim())
    .filter(Boolean)
    .join(' ')
}

/** The clip cut once: pauses and "um"s out, nothing drawn on it. */
export async function cutTalk(file: Blob, plan: CampaignPlan, name: string, onProgress: (p: number) => void): Promise<File> {
  const { blob } = await cutSilence(file, plan.keep, onProgress)
  return new File([blob], `${name.replace(/\.[^./]+$/, '')} (cut).mp4`, {
    type: 'video/mp4',
  })
}
