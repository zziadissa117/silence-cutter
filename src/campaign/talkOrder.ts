// A talking video done on the Cutter server (his ask, 2026-11-04: "paste in
// all my talking heads ... it takes 5 minutes ... if the videos could be
// edited on the server ... and then they get them back to me so I can just
// check the captions"): what the phone asks of the server, and what comes
// back. The phone decides everything, as it does when it makes a video
// itself; the server only does the two slow parts - listening, and making -
// several videos at once (serverTalk.ts), then sends the made video to
// Postiz exactly as the phone would. Shared by both sides; plain data only.

import type { CaptionPosition, CaptionSize, CaptionStyle, CaptionWord } from './captions'
import type { AngleEffects } from './effects'
import type { CampaignPosting, HeadlinePlace, HeadlineStyle, PopCue } from './look'
import type { ManualPicture } from './manualPictures'
import type { CampaignPlan } from './plan'
import type { PopPosition } from './popVideo'
import type { SilenceSettings } from '../media/silenceMath'

/** Listen to it: the words, the cuts. */
export interface ListenOrder {
  id: string
  /** The recording, sent to the server first (its /files). */
  fileId: string
  settings: SilenceSettings
  cleanSpeech: boolean
  /** Names the speech model is told about (brands, pictures). */
  names: string[]
  /** Time the captions with the letter model. */
  align: boolean
  keepWhole: boolean
}

/** Make it, with everything he decided, and send it. */
export interface MakeOrder {
  id: string
  fileId: string
  plan: CampaignPlan
  campaignId: string
  angleId: string
  headlineStyle?: HeadlineStyle
  headlinePlace: HeadlinePlace | null
  /** How long the headline stays, when not the angle's (a reaction's: the
   *  whole video or its first clip - noTalk.ts). */
  headlineSeconds?: number
  headlineText: string
  captions: CaptionWord[]
  voice: boolean
  /** As the video's own pick: absent the angle's, "none", "bank:<song>",
   *  or "<campaign>:<angle>". */
  music?: string
  clips: {
    before?: string
    after?: string
    cues?: { phrase: string; fileId: string }[]
    missing?: ('before' | 'after')[]
    cuesMissing?: number
    muted?: ('before' | 'after')[]
  }
  defaults: AngleEffects | null
  skipPictures: string[]
  captionPosition: CaptionPosition
  noCut: boolean
  /** Pictures put on by hand: one from the picture bank is read from the
   *  server's own copy of the bank (fileId absent); one from his phone was sent. */
  manual: { picture: ManualPicture; fileId?: string }[]
  captionSize: CaptionSize
  captionStyle: CaptionStyle
  pops: { videos: PopCue[]; files: Record<string, string>; sizePct: number; position: PopPosition }
  byHand: { texts: ManualPicture[]; videos: { picture: ManualPicture; fileId: string }[] }
  /** How the made video goes to Postiz: the same key the phone would send it
   *  with, so it is one post whoever sends it. */
  send: {
    key: string
    profileId: string
    campaign: { id: string; name: string; posting: CampaignPosting }
    transcript: string
    fileName: string
  }
}

export type TalkState = 'waiting' | 'listening' | 'listened' | 'making' | 'made' | 'failed'

/** How a video is doing on the server, as the phone reads it. */
export interface TalkSummary {
  id: string
  kind: 'listen' | 'make'
  state: TalkState
  progress: number
  error: string | null
  at: string
  made?: { headline: string; seconds: number }
}

/** File ids on the server: [A-Za-z0-9_-], at most 80 (server/main.mjs safeId). */
export const talkFileId = (kind: 't' | 'clip' | 'ov' | 'vb', ...parts: string[]): string =>
  `${kind}-${parts.join('-')}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80)

/** The bank videos worth sending for a video: only those it says the words
 *  of - the others would never come up. */
export function popsSaid(videos: readonly PopCue[], words: readonly { text: string }[]): PopCue[] {
  const said = ` ${words.map((w) => w.text.toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, ' ')).join(' ')} `.replace(/\s+/g, ' ')
  return videos.filter((v) => v.words.some((w) => w.trim() && said.includes(` ${w.toLowerCase().trim()} `)))
}

/** Whether the server should take the videos waiting to be listened to:
 *  three or more at once, and a server that is up and new enough. Fewer stay
 *  on the phone - uploading them would take about as long as doing them here
 *  (his rule, 2026-11-04: "if it's only under 3 videos, then just make it on
 *  the phone"). */
export const SERVER_FROM = 3
export function toServer({ waiting, onServer, serverUp }: { waiting: number; onServer: number; serverUp: boolean }): boolean {
  return serverUp && (waiting + onServer >= SERVER_FROM || onServer > 0)
}
