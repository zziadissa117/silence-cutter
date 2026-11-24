// The timeline editor, raw (his ask, 2026-11-24: "if I selected raw, then it
// should just open the timeline editor without any edits, any cuts, any
// captions, or any verifications ... there's no reason for it to take a few
// minutes to listen to the video and load"). The video is not listened to:
// how long it is is read from the file, the whole of it is kept, and it opens
// in the editor straight away, for him to edit by hand. Kept on the phone when
// made, not posted.

import { ALL_FORMATS, BlobSource, Input } from 'mediabunny'

import type { Job } from './jobs'
import type { Campaign } from './look'
import type { CampaignPlan } from './plan'
import { recordDay } from './store'

/** A plan for the whole video, nothing heard: what the editor opens on. */
export function rawPlan(duration: number): CampaignPlan {
  return { keep: [{ start: 0, end: duration }], duration, words: [], silences: 0, fillerWords: 0, stutters: 0, cleanSpeech: false }
}

/** How long a video is, from its own tracks - no decoding. */
export async function lengthOf(file: Blob): Promise<number> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
  try {
    return await input.computeDuration()
  } finally {
    input.dispose()
  }
}

/** The job ready for the editor: in the General campaign (nothing to sort it
 *  by), no captions, the whole video kept. */
export async function rawDay(job: Job, file: Blob, campaigns: readonly Campaign[]): Promise<Partial<Job>> {
  const duration = await lengthOf(file)
  if (!(duration > 0)) throw new Error("This video's length couldn't be read.")
  const campaign = campaigns.find((c) => c.general) ?? campaigns[0]
  const angle = campaign?.angles.find((a) => a.general) ?? campaign?.angles[0]
  const plan = rawPlan(duration)
  const guess = { campaignId: campaign?.id ?? '', angleId: angle?.id ?? '', sure: true, why: 'Timeline editor' }
  const day = { plan, guess, approved: false, chosen: true, noCaptions: true, keep: plan.keep, ...(job.day?.marks ? { marks: job.day.marks } : {}) }
  await recordDay(job.id, day, { campaignId: guess.campaignId, angleId: guess.angleId, headlineText: '' })
  return { status: 'sorted', day, campaignId: guess.campaignId, angleId: guess.angleId, headlineText: '', label: 'Timeline editor' }
}
