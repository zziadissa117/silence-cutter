// A video in the campaign page's list, and the small helpers its rows and
// the page share.

import type { Range, SilenceSettings } from '../media/silenceMath'
import type { Angle, Campaign } from './look'
import type { CampaignResult } from './pipeline'
import type { CaptionPosition, CaptionSize, CaptionWord } from './captions'
import type { CampaignPlan } from './plan'
import type { ManualPicture } from './manualPictures'
import type { Guess } from './sort'
import type { JobBatch, JobClips, JobPhase, MontageParts } from './store'

export type Job = {
  id: string
  name: string
  file: File | null
  campaignId: string
  angleId: string
  /** "Vertus · Sydney Sweeney", for the file name and the list. */
  label: string
  headlineText: string
  settings: SilenceSettings
  cleanSpeech: boolean
  /** A day's video goes queued → working (listening) → sorted → approved →
   *  working (making) → done. One added for a chosen angle skips sorting. */
  status: 'queued' | 'held' | 'working' | 'sorted' | 'approved' | 'done' | 'failed' | 'joined'
  phase: JobPhase
  progress: number
  result?: CampaignResult
  url?: string
  error?: string
  lastPhase?: JobPhase
  /** Present for a video dropped in with the day, to be sorted. */
  day?: {
    plan?: CampaignPlan
    guess?: Guess
    approved: boolean
    chosen?: boolean
    captions?: CaptionWord[]
    checked?: boolean
    noCaptions?: boolean
    hookCaptions?: boolean
    keep?: Range[]
    /** The track under this video: an angle's, as "campaignId:angleId", or
     *  "none". Absent means the video's own angle's. */
    music?: string
    /** No default effects on this video (its angle's own still apply). */
    noEffects?: boolean
    /** Picture ids left out of this video alone. */
    skipPictures?: string[]
    overlays?: ManualPicture[]
    /** Where this video's captions sit; absent = the Settings default. */
    captionPosition?: CaptionPosition
    /** How big this video's captions are; absent = the Settings default. */
    captionSize?: CaptionSize
    /** The videos joined on before and after it: a clip's id, or "none".
     *  Absent means the angle's own - see clips.ts. */
    clips?: JobClips
    /** Filmed as separate recordings, joined: the recordings' jobs, in
     *  order, kept hidden so it can be split apart. */
    parts?: string[]
  }
  /** A reaction video: this job's own file is the reaction clip; the
   *  product clip is kept once for all the videos that use it. */
  reaction?: { productId: string; productName: string; productType: string; productFile?: File }
  /** A video of clips and music, no talking: this job's own file is the
   *  first clip; the others, and a song picked for it, are kept under it -
   *  and held here too while the page that added them is open. */
  montage?: MontageParts & { files?: File[]; songFile?: File }
  /** Made from the Batch tab, for this day and time. Shown there, not in
   *  the Videos list, and gone from the phone once it is on its way. */
  batch?: JobBatch
  /** Recordings he joined before anything else, put together first: this
   *  job's own file is the first until then. */
  prejoin?: { clips: { name: string; type: string }[]; files?: File[] }
  /** Already had its one automatic second go after the phone's video
   *  decoder or encoder gave up. */
  retried?: boolean
  /** Made for the next days: posted from tomorrow, not today. */
  later?: boolean
  /** When it was filmed (from the file) and how long it is. */
  filmedAt?: number
  seconds?: number
  /** A wide clip he asked to only make 9:16: nothing is cut. */
  noCut?: boolean
  /** Made again after an edit: which go this is, and the post it replaces. */
  version?: number
  replaces?: string
  /** Part of a joined video: hidden until that is split apart or made. */
  joinedInto?: string
  /** A joined video's file in the phone's private storage, to delete. */
  joinedAs?: string | null
}

export const PHASE_LABEL: Record<JobPhase, string> = {
  reading: 'reading the audio',
  model: 'getting the speech model',
  listening: 'listening for words',
  cutting: 'cutting and adding the look',
  joining: 'putting the parts together',
}

export function formatTime(seconds: number): string {
  const s = Math.round(seconds)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function outputName(originalName: string, label: string): string {
  const base = originalName.replace(/\.[^./]+$/, '') || 'video'
  const tag = label.trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').toLowerCase()
  return `${base}_${tag || 'campaign'}.mp4`
}

export function labelOf(campaign: Campaign, angle: Angle): string {
  return campaign.general ? angle.name : `${campaign.name} · ${angle.name}`
}

export function labelFor(campaigns: Campaign[], job: Job): string {
  const campaign = campaigns.find((c) => c.id === job.campaignId)
  const angle = campaign?.angles.find((a) => a.id === job.angleId)
  return campaign && angle ? labelOf(campaign, angle) : ''
}

export function canShareFiles(files: File[]): boolean {
  if (typeof navigator === 'undefined' || !navigator.canShare) return false
  try {
    return navigator.canShare({ files })
  } catch {
    return false
  }
}

/** Opens the share sheet. False when it could not - the caller offers a
 *  plain download instead. */
export async function share(files: File[]): Promise<boolean> {
  try {
    await navigator.share({ files })
    return true
  } catch (err) {
    return err instanceof Error && err.name === 'AbortError'
  }
}
