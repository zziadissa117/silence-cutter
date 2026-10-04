// Campaign videos: drop in the day's raw videos, approve where each goes, get
// back each one cut AND branded - the angle's headline up front, the logo
// when he says the brand, the angle's sounds - ready to open in TikTok, where
// he adds captions and music and posts.
//
// Four tabs, so the day's work is never buried under the setting up:
// Videos (add, approve, send), Campaigns (brands and their angles), Pictures
// (the bank) and Settings. The planner's tab bar, so it is second nature.
//
// Its own page, its own queue, its own storage. The plain cutter is not
// touched by any of this; see ModeNav.tsx for why the two are separate pages.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { forgetCut } from '../media/outputSink'
import { SilenceCutError, isSilenceCutSupported } from '../media/silenceCut'
import { type Range, PRESETS, type PresetName } from '../media/silenceMath'
import { pageLeaving } from '../leaving'
import { within } from '../media/within'
import { ModeNav } from '../ModeNav'
import { lostPick, pickArrived, pickSaved, whenPickGoesWrong } from '../pickWatch'
import { report } from '../report'
import { UpdateBanner } from '../UpdateBanner'
import { VideoPicker } from '../VideoPicker'
import { BankView } from './BankView'
import { BatchView, type BatchVideo } from './BatchView'
import type { BankFile } from './batch'
import { CampaignsView } from './CampaignsView'
import { CloudError, currentSession, signOut, syncNow, type Session, type SyncState } from './cloud'
import { AngleEditor, CampaignEditor } from './Editors'
import { ChevronRight, UploadIcon } from './icons'
import { JobRow } from './JobRow'
import { CaptionReview } from './CaptionReview'
import { CutsEditor } from './CutsEditor'
import { HookQuestion } from './HookQuestion'
import { captionWords, captionedIndices, defaultCaptionPosition, drawnWords, type CaptionPosition, type CaptionWord } from './captions'
import {
  CLIP_PLACES,
  addClip,
  angleKey,
  clipFile,
  clipFor,
  listClips,
  loadAngleClips,
  saveAngleClips,
  tidyClips,
  type AngleClips,
  type ClipInfo,
  type ClipPlace,
  type JoinedClips,
} from './clips'
import { ClipsField } from './ClipsField'
import { ClipsMaker, type Montage } from './ClipsMaker'
import { JoinPicker } from './JoinPicker'
import { filmingOf, joinSuggestions, type Filming } from './filming'
import { joinRecordings } from './joinRender'
import { joinPlans, type CampaignPlan } from './plan'
import { checkPhone } from './phoneCheck'
import { PHASE_LABEL, canShareFiles, labelFor, labelOf, outputName, share, type Job } from './jobs'
import {
  withGeneralAngle,
  videoLook,
  wordsToHear,
  LIMITS,
  NO_POSTING,
  blankCampaign,
  isReaction,
  copyAngle,
  generalCampaign,
  type Angle,
  type AngleMusic,
  type BankPicture,
  type Campaign,
  type CampaignPosting,
} from './look'
import { forgetSend, queueSend, sending, startSending, watchSending } from './outbox'
import { headlineFor, listen, make, makeCampaignVideo, makeMontage, makeReaction, plainCut, type CampaignResult } from './pipeline'
import { PostingEditor } from './PostingEditor'
import { PostingSetup } from './PostingSetup'
import {
  disconnect as disconnectPosting,
  lastPosts,
  attachAccounts,
  attachSummary,
  listPosts,
  placeFor,
  postAction,
  postingHere,
  recheckCaptions,
  refreshProfile,
  saveCampaignPlace,
  sendsFrom,
  setSendHere,
  timeLabel,
  type LocalPosting,
} from './posting'
import { PostsView } from './PostsView'
import { pushState, refreshPush, turnOnPush, type PushState } from './push'
import { BatchEdit } from './BatchEdit'
import type { ManualPicture } from './manualPictures'
import { WideAsk } from './WideAsk'
import { defaultEffects } from './defaultEffects'
import { picturesHeard, type PictureChoice } from './skipPictures'
import { talksIn } from './reaction'
import { SettingsView } from './SettingsView'
import { SignIn } from './SignIn'
import { dayWords, sortVideo } from './sort'
import {
  MAX_ATTEMPTS,
  claimAttempt,
  deleteCampaign,
  EDIT_WINDOW_MS,
  editableJobs,
  expireMade,
  forgetJob,
  jobOfPostKey,
  keepJobVideo,
  markMade,
  peekMadeBatch,
  postKeyOf,
  reopenBatchJob,
  reopenJob,
  loadBank,
  loadBatchBank,
  loadOverlayFile,
  saveOverlayFile,
  deleteOverlayFile,
  loadCampaigns,
  loadBankFile,
  loadJobFile,
  loadMontageFile,
  loadPendingJobs,
  loadProductFile,
  persistJob,
  persistJobRow,
  persistMontage,
  persistJoined,
  persistProduct,
  recordDay,
  recordFailure,
  recordPhase,
  resetAttempts,
  saveCampaign,
  spaceOnDevice,
  retireBankFiles,
  finishPrejoin,
  splitJoined,
  sweepRetiredBankFiles,
  whenChangedLocally,
  type JobClips,
  type JobPhase,
} from './store'
import { TabBar, type Tab } from './TabBar'
import { keepScreenOn } from './wakeLock'

const LAST_KEY = 'campaign.last'

/** How long a video may go without any progress before it counts as
 *  stuck. Well past the slowest real step on a phone - a long window of
 *  listening, or finishing a big file. */
const STALL_MS = 90_000

/** The campaign and angle last used, so the page opens on them. */
function remembered(): { campaignId?: string; angleId?: string } {
  try {
    return JSON.parse(localStorage.getItem(LAST_KEY) ?? '{}') as { campaignId?: string; angleId?: string }
  } catch {
    return {}
  }
}

function remember(campaignId: string, angleId: string | null): void {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify({ campaignId, angleId }))
  } catch {
    // Private mode or storage blocked: it just won't be preselected.
  }
}

const MODE_KEY = 'campaign.mode'
type Mode = 'one' | 'day' | 'clips' | 'join'

/** Sorting the day is where it starts; picking the campaign by hand is the
 *  exception, remembered only when he chose it. */
function rememberedMode(): Mode {
  try {
    const stored = localStorage.getItem(MODE_KEY)
    return stored === 'one' || stored === 'clips' || stored === 'join' ? stored : 'day'
  } catch {
    return 'day'
  }
}

const POST_LATER_KEY = 'campaign.postLater'

/** "Next days" is for today only: tomorrow it is back to posting the day's
 *  videos that day, so it can't be left on by mistake. */
function postLaterToday(): boolean {
  try {
    return localStorage.getItem(POST_LATER_KEY) === new Date().toLocaleDateString('en-CA')
  } catch {
    return false
  }
}

function keepPostLater(on: boolean): void {
  try {
    if (on) localStorage.setItem(POST_LATER_KEY, new Date().toLocaleDateString('en-CA'))
    else localStorage.removeItem(POST_LATER_KEY)
  } catch {
    // Just won't be remembered.
  }
}

/** A setting kept on this phone between visits. */
function usePref<T extends string | boolean>(key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key)
      if (stored === null) return initial
      return (typeof initial === 'boolean' ? stored === 'true' : stored) as T
    } catch {
      return initial
    }
  })
  const set = (next: T) => {
    setValue(next)
    try {
      localStorage.setItem(key, String(next))
    } catch {
      // Just won't be remembered.
    }
  }
  return [value, set]
}

/** "3 to approve · 2 sending", or that nothing waits. */
function postsLine(toApprove: number, sendingCount: number, unsent: number): string {
  const parts: string[] = []
  if (unsent > 0) parts.push(`${unsent} finished video${unsent === 1 ? '' : 's'} not sent - no accounts picked for ${unsent === 1 ? 'its' : 'their'} campaign`)
  if (toApprove > 0) parts.push(`${toApprove} to approve`)
  if (sendingCount > 0) parts.push(`${sendingCount} sending`)
  return parts.length > 0 ? parts.join(' · ') : 'Nothing waiting for you'
}

/** The General campaign last, after his own. */
function ordered(campaigns: Campaign[]): Campaign[] {
  return [...campaigns.filter((c) => !c.general), ...campaigns.filter((c) => c.general)]
}

type Editing =
  | { kind: 'campaign'; campaign: Campaign; isNew: boolean }
  | { kind: 'angle'; campaign: Campaign; angle: Angle; isNew: boolean; copiedFrom?: string }
  | { kind: 'posting'; campaign: Campaign }

const VIDEO_PATTERN = /\.(mov|mp4|m4v|mkv|avi|webm|mts|3gp)$/i

function videoFilesFrom(list: Iterable<File>): File[] {
  return Array.from(list).filter((f) => f.type.startsWith('video/') || VIDEO_PATTERN.test(f.name))
}

let nextId = 0

/** These videos' ids, and every recording joined into them. */
function withParts(ids: string[], jobs: Job[]): Set<string> {
  const out = new Set<string>()
  const add = (id: string) => {
    if (out.has(id)) return
    out.add(id)
    for (const part of jobs.find((j) => j.id === id)?.day?.parts ?? []) add(part)
  }
  ids.forEach(add)
  return out
}

/** The first few words heard in a recording, to tell recordings apart. */
function firstWords(job: Job): string {
  const words = (job.day?.plan?.words ?? []).map((w) => w.text.trim()).filter(Boolean)
  return words.length > 0 ? `${words.slice(0, 6).join(' ')}${words.length > 6 ? '…' : ''}` : 'no words heard'
}

export function CampaignApp() {
  const [supported, setSupported] = useState<boolean | null>(null)
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null)
  const [campaignId, setCampaignId] = useState<string | null>(null)
  const [angleId, setAngleId] = useState<string | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [headlineText, setHeadlineText] = useState('')
  // The product clip for the reaction videos being added: picked once, used
  // for every reaction clip added after it until he picks another.
  const [product, setProduct] = useState<{ id: string; file: File } | null>(null)
  const [storedPreset, setPreset] = usePref<string>('campaign.pacing', 'balanced')
  const preset: PresetName = storedPreset in PRESETS ? (storedPreset as PresetName) : 'balanced'
  const [cleanSpeech, setCleanSpeech] = usePref<boolean>('campaign.cleanSpeech', false)
  const [captionsOn, setCaptionsOn] = usePref<boolean>('campaign.captions', true)
  const captionsRef = useRef(captionsOn)
  captionsRef.current = captionsOn
  const [bareCaptions, setBareCaptions] = usePref<boolean>('campaign.bareCaptions', false)
  const bareRef = useRef(bareCaptions)
  bareRef.current = bareCaptions
  const [voiceOn, setVoiceOn] = usePref<boolean>('campaign.voice', true)
  const voiceRef = useRef(voiceOn)
  voiceRef.current = voiceOn
  /** How long a video's headline is up. The hook reads on its own, so no
   *  captions until it has gone; 0 when there is no headline. */
  const hookFor = (job: Job): number => {
    if (job.reaction) return 0
    const angle = campaignsRef.current.find((c) => c.id === job.campaignId)?.angles.find((a) => a.id === job.angleId)
    return angle && job.headlineText.trim() ? angle.headline.seconds : 0
  }

  /** The track under a video: the one picked for it, or its angle's. */
  const musicFor = (job: Job): AngleMusic | null | undefined => {
    const picked = job.day?.music
    if (picked === 'none') return null
    if (!picked) return undefined
    const [campaignId, angleId] = picked.split(':')
    return campaignsRef.current.find((c) => c.id === campaignId)?.angles.find((a) => a.id === angleId)?.music ?? undefined
  }

  /** The videos joined on before and after a video: its own picks, else its
   *  angle's - read from the phone as it is made, so a pick made a moment
   *  ago counts. One no longer on the phone is noted, not failed. */
  const clipsFor = async (job: Job): Promise<JoinedClips> => {
    const angle = (await loadAngleClips().catch(() => ({}) as Record<string, AngleClips>))[angleKey(job.campaignId, job.angleId)] ?? {}
    const joined: JoinedClips = {}
    const missing: ClipPlace[] = []
    for (const place of CLIP_PLACES) {
      const id = clipFor(job.day?.clips?.[place], angle[place])
      if (!id) continue
      const file = await clipFile(id).catch(() => null)
      if (file) joined[place] = file
      else missing.push(place)
    }
    return missing.length > 0 ? { ...joined, missing } : joined
  }

  /** A reaction video's product clip: in hand, or read back from the phone. */
  const productOf = async (job: Job): Promise<File> => {
    const parts = job.reaction!
    const file = parts.productFile ?? (await loadProductFile(parts).catch(() => null))
    if (!file) throw new SilenceCutError("This video's product clip is no longer on this phone. Remove it and add it again.")
    return file
  }

  /** A file from a batch's bank, or why the video can't be made without it. */
  const bankFileOf = async (file: BankFile): Promise<File> => {
    const found = await loadBankFile(file).catch(() => null)
    if (!found) throw new SilenceCutError(`${file.name} was taken out of the batch's bank, or is no longer on this phone. Skip this video.`)
    return found
  }

  /** A clips-and-music video's clips after the first: in hand, or read
   *  back from the phone - a batch's product from its bank. */
  const montageClips = async (job: Job): Promise<File[]> => {
    const parts = job.montage!
    if (parts.bank) return [await bankFileOf(parts.bank.product)]
    const files: File[] = []
    for (const [i, clip] of parts.clips.entries()) {
      const file = parts.files?.[i] ?? (await loadMontageFile(job.id, i + 1, clip.name, clip.type).catch(() => null))
      if (!file) throw new SilenceCutError(`Clip ${i + 2} of this video is no longer on this phone. Remove it and make it again.`)
      files.push(file)
    }
    return files
  }

  /** The track under a clips-and-music video: a song he picked for it, an
   *  angle's, or none. */
  const montageMusic = async (job: Job): Promise<{ audio: Blob; name: string } | null> => {
    const parts = job.montage!
    if (parts.bank) return parts.bank.music ? { audio: await bankFileOf(parts.bank.music), name: parts.bank.music.name } : null
    if (parts.music === 'none') return null
    if (parts.music === 'song') {
      const song =
        parts.songFile ??
        (parts.song ? await loadMontageFile(job.id, 'song', parts.song.name, parts.song.type).catch(() => null) : null)
      if (!song) throw new SilenceCutError("This video's song is no longer on this phone. Remove it and make it again.")
      return { audio: song, name: song.name }
    }
    const [campaignId, angleId] = parts.music ? parts.music.split(':') : [job.campaignId, job.angleId]
    const track = campaignsRef.current.find((c) => c.id === campaignId)?.angles.find((a) => a.id === angleId)?.music
    return track ? { audio: track.audio, name: track.name } : null
  }

  /** Whether a video has talking to check and cut: every talking-head one,
   *  and a reaction only when he talks over the product. */
  const talkingIn = (job: Job): boolean =>
    !job.montage && (!job.reaction || Boolean(job.day?.plan && talksIn(job.day.plan.words, job.day.plan.keep)))

  /** A video's plan with its cuts as he fixed them, if he did. */
  const planFor = (job: Job): CampaignPlan | undefined => {
    const plan = job.day?.plan
    return plan && job.day?.keep ? { ...plan, keep: job.day.keep } : plan
  }

  /** Every word still in the video once it is cut: the ones he checked, or
   *  all heard - put through the cut again, so fixing the cuts after
   *  checking the captions takes out the words that went with them. */
  const captionWordsFor = (job: Job, plan: CampaignPlan): CaptionWord[] =>
    captionWords(job.day?.captions ?? plan.spoken ?? plan.words, plan.keep)

  /** The captions burned into a video: every word he checked (or, if he
   *  never opened them, every word heard) said after the headline - or none,
   *  when he chose to make it without. */
  const captionsFor = (job: Job, plan: CampaignPlan): CaptionWord[] => {
    if (job.day?.noCaptions) return []
    const all = captionWordsFor(job, plan)
    if (job.day?.hookCaptions) return all
    return captionedIndices(all, plan.keep, hookFor(job)).map((i) => all[i])
  }

  /** Sends a finished video to Postiz, when this phone posts its campaign.
   *  The plain cut never goes by itself - it is missing the look - but can
   *  be sent from its row. */
  /** An edited video replaces the post it was made again from, when that has
   *  not gone out: the old post is rejected (taken out of Postiz if it was
   *  already scheduled) before the new one is sent. One already posted can't
   *  be taken back, so the new one goes out as a post of its own - said. */
  const retireOld = async (job: Job): Promise<void> => {
    if (!job.replaces) return
    try {
      const posts = await listPosts().catch(() => lastPosts())
      const old = posts.find((p) => p.key === job.replaces)
      if (!old || old.status === 'rejected') return
      const wentOut = old.status === 'posted' || (old.status === 'scheduled' && old.postAt !== null && new Date(old.postAt).getTime() <= Date.now())
      if (wentOut) {
        setNotice('The first version was already posted, so the edited one goes out as a new post.')
        return
      }
      await postAction('reject', old.id)
      await forgetSend(old.key).catch(() => {})
    } catch (error) {
      setNotice(`The edited video was sent, but the old post could not be removed - reject it in Posts. (${error instanceof Error ? error.message : String(error)})`)
    }
  }

  const sendToPostiz = (job: Job, campaign: Campaign, result: CampaignResult, byHand = false): void => {
    const local = postingHere()
    if (!local || (!byHand && (result.lookFailed || !sendsFrom(campaign, local)))) return
    const plan = planFor(job)
    const transcript = plan
      ? captionWordsFor(job, plan)
          .map((w) => w.text.trim())
          .filter(Boolean)
          .join(' ')
      : (result.said ?? '')
    const retired = retireOld(job)
    const queued = retired.then(() => queueSend(
      {
        key: postKeyOf(job.id, job.version),
        profileId: local.profile.id,
        campaign: { id: campaign.id, name: campaign.name, posting: campaign.posting ?? NO_POSTING },
        meta: {
          transcript,
          headline: result.headline,
          duration: result.newDurationSec,
          fileName: job.name,
          later: job.later === true,
          ...(job.batch ? { batch: job.batch } : {}),
        },
      },
      result.blob,
    )).catch((error: unknown) => {
      report({ page: 'campaign', kind: 'failed', phase: 'posting', message: `Could not keep a copy to send: ${error instanceof Error ? error.message : String(error)}` })
    })
    copying.current.set(job.id, queued)
    void queued.finally(() => copying.current.delete(job.id))
  }

  // The videos whose captions are being checked, one after another; the
  // first is the one on screen.
  const [reviewing, setReviewing] = useState<string[] | null>(null)
  // The video whose cuts are being fixed by hand - over the list, or over
  // the caption check it was opened from.
  const [cutting, setCutting] = useState<{ id: string } | null>(null)
  // Videos about to be checked, waiting on whether the hook gets captions.
  const [askingHook, setAskingHook] = useState<string[] | null>(null)
  // Dropped videos that are not 9:16, waiting for: cut them too, or only 9:16?
  const [askWide, setAskWide] = useState<{ order: { file: File; filming: Filming }[]; names: string[] } | null>(null)
  // A made batch video being fixed: its headline and track.
  const [batchEditing, setBatchEditing] = useState<{
    id: string
    postKey: string
    name: string
    headline: string
    music: BankFile | null
    options: BankFile[]
    posted: boolean
  } | null>(null)
  // Posting to Postiz: this phone's setup, the Posts screen, the keys.
  const [posting, setPosting] = useState<LocalPosting | null>(postingHere)
  // Videos added while this is on are for the next days: they take their
  // campaign's times from tomorrow instead of all going out today.
  const [postLater, setPostLaterState] = useState(postLaterToday)
  const setPostLater = (on: boolean) => {
    keepPostLater(on)
    setPostLaterState(on)
  }
  const laterNow = postLater && posting !== null
  const [showPosts, setShowPosts] = useState(() => window.location.hash === '#posts')
  const [settingUpPosting, setSettingUpPosting] = useState(false)
  const [push, setPush] = useState<PushState>('off')
  const [toApprove, setToApprove] = useState(() => lastPosts().filter((p) => p.status === 'waiting').length)
  const [outgoing, setOutgoing] = useState(sending)
  // Finished videos still being copied for Postiz: their cut stays until
  // the copy is made, whatever is cleared meanwhile.
  const copying = useRef(new Map<string, Promise<unknown>>())
  const [tab, setTab] = useState<Tab>('videos')
  const [openCampaignId, setOpenCampaignId] = useState<string | null>(null)
  const [jobs, setJobs] = useState<Job[]>([])
  const jobsRef = useRef(jobs)
  jobsRef.current = jobs
  const [bank, setBank] = useState<BankPicture[]>([])
  // Videos joined on before and after his own, kept on this phone: every
  // clip there is, and which ones each angle uses. See clips.ts.
  const [clipList, setClipList] = useState<ClipInfo[]>([])
  const [angleClips, setAngleClips] = useState<Record<string, AngleClips>>({})
  const [session, setSession] = useState<Session | null>(currentSession)
  const [showSignIn, setShowSignIn] = useState(false)
  const [syncState, setSyncState] = useState<SyncState>(() => (currentSession() ? { kind: 'syncing' } : { kind: 'signed-out' }))
  const [mode, setModeState] = useState<Mode>(rememberedMode)
  const setMode = (next: Mode) => {
    setModeState(next)
    try {
      localStorage.setItem(MODE_KEY, next)
    } catch {
      // Just won't be remembered.
    }
  }
  const [notice, setNotice] = useState<string | null>(null)

  // Made videos whose recording is still on the phone, so they can be edited
  // and made again: job id -> when made. They go EDIT_WINDOW_MS after.
  const [editable, setEditable] = useState<Record<string, number>>({})
  const sweepBankRef = useRef<() => void>(() => {})
  const refreshEditable = useCallback(async () => {
    if ((await expireMade().catch(() => 0)) > 0) sweepBankRef.current()
    setEditable(await editableJobs().catch(() => ({})))
  }, [])
  useEffect(() => {
    void refreshEditable()
    const timer = window.setInterval(() => void refreshEditable(), 5 * 60 * 1000)
    return () => window.clearInterval(timer)
  }, [refreshEditable])
  const [phoneProblem, setPhoneProblem] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible')
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  }, [])
  const processing = useRef(false)
  const persisting = useRef(new Map<string, Promise<unknown>>())
  // Read by the queue when a video's turn comes, so an edit to an angle
  // reaches every video of it that has not started yet.
  const campaignsRef = useRef<Campaign[]>([])
  campaignsRef.current = campaigns ?? []
  const bankRef = useRef<BankPicture[]>([])
  bankRef.current = bank

  const campaign = useMemo(() => campaigns?.find((c) => c.id === campaignId) ?? null, [campaigns, campaignId])
  const angle = useMemo(
    () => campaign?.angles.find((a) => a.id === angleId) ?? campaign?.angles[0] ?? null,
    [campaign, angleId],
  )

  /** Makes this campaign and angle the ones videos are added for. */
  const select = useCallback((next: Campaign | null, nextAngle?: Angle | null) => {
    const chosen = nextAngle ?? next?.angles[0] ?? null
    setCampaignId(next?.id ?? null)
    setAngleId(chosen?.id ?? null)
    setHeadlineText(chosen?.headline.text ?? '')
    if (next) remember(next.id, chosen?.id ?? null)
  }, [])

  /** Reads campaigns and the bank again - after the shared login brought
   *  changes - keeping what is selected when it still exists. */
  const reload = useCallback(async () => {
    const [stored, loadedBank] = await Promise.all([loadCampaigns(), loadBank()])
    const loaded = ordered(stored.some((c) => c.general) ? stored : [...stored, generalCampaign()])
    setCampaigns(loaded)
    setBank(loadedBank)
    setCampaignId((id) => (loaded.some((c) => c.id === id) ? id : (loaded[0]?.id ?? null)))
  }, [])

  const runSync = useCallback(() => {
    if (!currentSession()) return
    setSyncState({ kind: 'syncing' })
    syncNow()
      .then(async (changed) => {
        if (changed) await reload()
        setSyncState({ kind: 'synced', at: Date.now() })
      })
      .catch((err: unknown) => {
        if (err instanceof CloudError && err.message === 'signed-out') {
          setSession(null)
          setSyncState({ kind: 'signed-out' })
        } else setSyncState({ kind: 'waiting', reason: err instanceof Error ? err.message : String(err) })
      })
  }, [reload])

  // Changes go out a moment after they are made; the other phone's come in
  // on opening, on coming back to the app, and when the signal returns.
  useEffect(() => {
    let timer = 0
    whenChangedLocally(() => {
      window.clearTimeout(timer)
      timer = window.setTimeout(runSync, 1500)
    })
    const onVisible = () => document.visibilityState === 'visible' && runSync()
    window.addEventListener('online', runSync)
    document.addEventListener('visibilitychange', onVisible)
    runSync()
    return () => {
      window.clearTimeout(timer)
      whenChangedLocally(() => {})
      window.removeEventListener('online', runSync)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [runSync])

  // Posting: finished videos keep going up whenever the page is open; the
  // profile and the notification address are brought up to date on
  // opening; the Posts screen opens from a notification.
  useEffect(() => startSending(), [])
  useEffect(() => watchSending(() => setOutgoing(sending())), [])
  useEffect(() => {
    void pushState().then(setPush)
    if (!postingHere()) return
    void refreshProfile()
      .then(() => setPosting(postingHere()))
      .catch(() => setPosting(postingHere()))
    void refreshPush()
  }, [])
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if ((event.data as { type?: string } | null)?.type === 'open') setShowPosts(true)
    }
    navigator.serviceWorker?.addEventListener('message', onMessage)
    return () => navigator.serviceWorker?.removeEventListener('message', onMessage)
  }, [])
  // How many posts wait for him, for the line on the Videos screen.
  const countPosts = useCallback(() => {
    if (!postingHere()) return
    void listPosts()
      .then((posts) => setToApprove(posts.filter((p) => p.status === 'waiting').length))
      .catch(() => {})
  }, [])
  const sentNow = outgoing.filter((o) => o.entry.state === 'sent').length
  useEffect(() => {
    countPosts()
    const onVisible = () => document.visibilityState === 'visible' && countPosts()
    const timer = window.setInterval(() => document.visibilityState === 'visible' && countPosts(), 60_000)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [countPosts, showPosts, sentNow])

  useEffect(() => {
    let cancelled = false
    void isSilenceCutSupported().then((ok) => {
      if (!cancelled) setSupported(ok)
    })
    void loadBank()
      .then((loaded) => !cancelled && setBank(loaded))
      .catch(() => {})
    void loadCampaigns().then(async (stored) => {
      // General is always there, for videos with no campaign in them.
      let loaded = stored
      if (!stored.some((c) => c.general)) {
        const general = await saveCampaign(generalCampaign()).catch(() => generalCampaign())
        loaded = [...stored, general]
      }
      loaded = ordered(loaded)
      if (cancelled) return
      setCampaigns(loaded)
      const last = remembered()
      const chosen = loaded.find((c) => c.id === last.campaignId) ?? loaded[0] ?? null
      select(chosen, chosen?.angles.find((a) => a.id === last.angleId))
    })
    return () => {
      cancelled = true
    }
  }, [select])

  useEffect(() => {
    void listClips().then(setClipList).catch(() => {})
    void loadAngleClips().then(setAngleClips).catch(() => {})
  }, [])
  // Once a visit, the clips nothing uses any more are let go - once the
  // campaigns are known, so no angle's clips are mistaken for unused.
  const tidied = useRef(false)
  useEffect(() => {
    if (tidied.current || !campaigns || campaigns.length === 0) return
    tidied.current = true
    void tidyClips(campaigns.flatMap((c) => c.angles.map((a) => angleKey(c.id, a.id))))
      .then(async () => {
        setClipList(await listClips())
        setAngleClips(await loadAngleClips())
      })
      .catch(() => {})
  }, [campaigns])

  /** A clip picked for one video: a clip's id, "none", or "" for its
   *  angle's own again. */
  const setClip = (id: string, place: ClipPlace, choice: string) => {
    const job = jobsRef.current.find((j) => j.id === id)
    if (!job?.day) return
    const clips: JobClips = { ...job.day.clips }
    if (choice) clips[place] = choice
    else delete clips[place]
    const day = { ...job.day, clips: clips.before || clips.after ? clips : undefined }
    setJobs((js) => js.map((j) => (j.id === id ? { ...j, day } : j)))
    void recordDay(id, day, { campaignId: job.campaignId, angleId: job.angleId, headlineText: job.headlineText })
  }

  /** Keeps a clip from the phone, to join onto videos. */
  const newClip = async (file: File): Promise<ClipInfo> => {
    const clip = await addClip(file)
    setClipList(await listClips().catch(() => [clip]))
    return clip
  }

  /** A video's Add list - talking-head videos only; a reaction has its own
   *  two parts. Defined before the rows that call it while rendering. */
  const clipsField = (job: Job, compact = false) =>
    job.reaction || !job.day ? undefined : (
      <ClipsField
        picks={job.day.clips ?? {}}
        angle={angleClips[angleKey(job.campaignId, job.angleId)] ?? {}}
        all={clipList}
        compact={compact}
        onPick={(place, choice) => setClip(job.id, place, choice)}
        onNew={async (place, file) => {
          const clip = await newClip(file)
          setClip(job.id, place, clip.id)
        }}
      />
    )

  /** A recording that can be joined with another: listened to, waiting
   *  for him, and not a reaction (those have two parts of their own). */
  const joinable = (j: Job) => j.status === 'sorted' && !j.reaction && Boolean(j.day?.plan)

  /** One video filmed as two recordings: the second goes after the first.
   *  The two rows become one, put together in the queue like any work, and
   *  the recordings are kept, hidden, until it is made - so it can be split
   *  apart again. */
  const joinVideos = (firstId: string, secondId: string) => {
    const a = jobsRef.current.find((j) => j.id === firstId)
    const b = jobsRef.current.find((j) => j.id === secondId)
    if (!a || !b || a === b || !joinable(a) || !joinable(b)) return
    const id = `${Date.now()}-${nextId++}`
    const day: NonNullable<Job['day']> = {
      approved: false,
      ...(a.day!.chosen ? { chosen: true } : {}),
      ...(a.day!.guess ? { guess: { ...a.day!.guess, sure: true } } : {}),
      ...(a.day!.music ? { music: a.day!.music } : {}),
      ...(a.day!.clips ? { clips: a.day!.clips } : {}),
      parts: [a.id, b.id],
    }
    const joined: Job = {
      id,
      name: `${a.name} + ${b.name}`,
      file: null,
      campaignId: a.campaignId,
      angleId: a.angleId,
      label: a.label,
      headlineText: a.headlineText,
      settings: a.settings,
      cleanSpeech: a.cleanSpeech,
      status: 'queued',
      phase: 'joining',
      progress: 0,
      day,
      ...(a.later || b.later ? { later: true } : {}),
    }
    setJobs((current) =>
      current.flatMap((j) => {
        const hidden = j.id === a.id || j.id === b.id ? { ...j, status: 'joined' as const, joinedInto: id } : j
        return j.id === a.id ? [joined, hidden] : [hidden]
      }),
    )
    persisting.current.set(
      id,
      persistJoined({
        id,
        fileName: joined.name,
        fileType: 'video/mp4',
        campaignId: joined.campaignId,
        angleId: joined.angleId,
        headlineText: joined.headlineText,
        settings: joined.settings,
        cleanSpeech: joined.cleanSpeech,
        day,
        ...(joined.later ? { later: true } : {}),
      }).catch(() => {}),
    )
  }

  /** Takes a joined video apart: its recordings come back where they were. */
  const splitVideo = (id: string, why?: string) => {
    const joined = jobsRef.current.find((j) => j.id === id)
    const parts = joined?.day?.parts
    if (!joined || !parts) return
    setJobs((js) =>
      js
        .filter((j) => j.id !== id)
        .map((j) => (parts.includes(j.id) ? { ...j, status: j.day?.plan ? ('sorted' as const) : ('queued' as const), joinedInto: undefined } : j)),
    )
    if (joined.joinedAs) void forgetCut(joined.joinedAs)
    void (persisting.current.get(id) ?? Promise.resolve()).then(() => splitJoined(id))
    if (why) setNotice(why)
  }

  /** Puts a joined video's recordings together into one file and moves what
   *  was heard in each to its place in it. If it can't, the recordings come
   *  back as they were: a join never costs a video. */
  /** Recordings he joined before anything else, put together into one video
   *  that then goes on like any he drops in: heard, sorted, checked. A
   *  failure keeps the recordings, so Try again joins them again. */
  const joinFirst = async (
    next: Job,
    setPhase: (phase: JobPhase, progress: number) => void,
    watched: <T>(work: Promise<T>) => Promise<T>,
    interrupted: () => boolean,
  ): Promise<void> => {
    const parts = next.prejoin!
    try {
      const first = next.file ?? (await loadJobFile(next.id))
      if (!first) throw new SilenceCutError('The first recording is no longer on this phone. Remove this video and join them again.')
      const rest: File[] = []
      for (const [i, clip] of parts.clips.entries()) {
        const file = parts.files?.[i] ?? (await loadMontageFile(next.id, i + 1, clip.name, clip.type).catch(() => null))
        if (!file) throw new SilenceCutError(`Recording ${i + 2} is no longer on this phone. Remove this video and join them again.`)
        rest.push(file)
      }
      setPhase('joining', 0)
      const joined = await watched(joinRecordings([first, ...rest], (f) => setPhase('joining', f)))
      const file = new File([joined.blob], next.name, { type: 'video/mp4' })
      persisting.current.set(next.id, finishPrejoin(next.id, file))
      setJobs((js) =>
        js.map((j) =>
          j.id === next.id
            ? { ...j, file, prejoin: undefined, status: 'queued' as const, progress: 0, joinedAs: joined.storedAs, seconds: joined.duration }
            : j,
        ),
      )
      await resetAttempts(next.id)
    } catch (error) {
      if (pageLeaving()) return
      const why = error instanceof Error ? error.message : String(error)
      if (!(error instanceof SilenceCutError) && interrupted()) {
        // Taken away while the app was in the background: again on return.
        setJobs((js) => js.map((j) => (j.id === next.id ? { ...j, status: 'queued' as const, progress: 0 } : j)))
        await resetAttempts(next.id)
        return
      }
      const message = error instanceof SilenceCutError ? why : `The recordings couldn't be put together (${why}). Try again.`
      setJobs((js) => js.map((j) => (j.id === next.id ? { ...j, status: 'failed' as const, error: message } : j)))
      await recordFailure(next.id, message)
      report({ page: 'campaign', kind: 'failed', phase: 'joining', message: `Joining first failed: ${why}` })
    }
  }

  const joinParts = async (
    next: Job,
    setPhase: (phase: JobPhase, progress: number) => void,
    watched: <T>(work: Promise<T>) => Promise<T>,
    interrupted: () => boolean,
  ): Promise<void> => {
    const parts = (next.day?.parts ?? []).map((id) => jobsRef.current.find((j) => j.id === id))
    try {
      if (parts.some((p) => !p?.day?.plan)) throw new SilenceCutError('One of its recordings is no longer in the list.')
      const files = await Promise.all(parts.map(async (p) => p!.file ?? (await loadJobFile(p!.id))))
      if (files.some((f) => !f)) throw new SilenceCutError('One of its recordings is no longer on this phone.')
      setPhase('joining', 0)
      const joined = await watched(joinRecordings(files as File[], (f) => setPhase('joining', f)))
      const file = new File([joined.blob], next.name, { type: 'video/mp4' })
      persisting.current.set(next.id, keepJobVideo(next.id, file))
      const plan = joinPlans(
        parts.map((p) => planFor(p!)!),
        joined.offsets,
        joined.duration,
      )
      const day = { ...next.day!, plan }
      setJobs((js) =>
        js.map((j) => (j.id === next.id ? { ...j, status: 'sorted' as const, file, day, progress: 0, joinedAs: joined.storedAs } : j)),
      )
      await resetAttempts(next.id)
      await recordDay(next.id, day)
    } catch (error) {
      if (pageLeaving()) return
      const why = error instanceof Error ? error.message : String(error)
      if (!(error instanceof SilenceCutError) && interrupted()) {
        // Taken away while the app was in the background: again on return.
        setJobs((js) => js.map((j) => (j.id === next.id ? { ...j, status: 'queued' as const, progress: 0 } : j)))
        await resetAttempts(next.id)
        return
      }
      report({ page: 'campaign', kind: 'failed', phase: 'joining', message: `Joining failed: ${why}` })
      splitVideo(next.id, `${next.name} couldn't be put together (${why}). The recordings are back as they were.`)
    }
  }

  // A video picked just before the page restarted never arrived; say so
  // rather than showing an empty list as if nothing happened.
  useEffect(() => {
    const lost = lostPick('campaign')
    if (lost) setNotice(lost)
    whenPickGoesWrong(setNotice)
  }, [])

  useEffect(() => {
    let cancelled = false
    void loadPendingJobs().then((pending) => {
      sweepBank()
      if (cancelled) return
      // After an update, check the phone - only when nothing is waiting to
      // be made, so the check never competes with a real video.
      if (pending.length === 0) {
        void checkPhone().then((problem) => !cancelled && setPhoneProblem(problem))
        return
      }
      const restored: Job[] = pending.map((p) => ({
        id: p.id,
        name: p.fileName,
        file: null,
        campaignId: p.campaignId,
        angleId: p.angleId,
        label: '',
        headlineText: p.headlineText,
        settings: p.settings,
        cleanSpeech: p.cleanSpeech,
        status: p.joinedInto
          ? ('joined' as const)
          : p.failed
          ? ('failed' as const)
          : p.attempts >= MAX_ATTEMPTS
            ? ('held' as const)
            : p.day?.plan
              ? p.day.approved
                ? ('approved' as const)
                : ('sorted' as const)
              : ('queued' as const),
        phase: 'cutting' as const,
        progress: 0,
        lastPhase: p.lastPhase,
        ...(p.failed ? { error: p.failed } : {}),
        ...(p.day ? { day: p.day } : {}),
        ...(p.later ? { later: true } : {}),
        ...(p.noCut ? { noCut: true } : {}),
        ...(p.version ? { version: p.version } : {}),
        ...(p.replaces ? { replaces: p.replaces } : {}),
        ...(p.joinedInto ? { joinedInto: p.joinedInto } : {}),
        ...(p.filmedAt !== undefined ? { filmedAt: p.filmedAt, seconds: p.seconds } : {}),
        ...(p.reaction ? { reaction: p.reaction } : {}),
        ...(p.montage ? { montage: p.montage } : {}),
        ...(p.batch ? { batch: p.batch } : {}),
        ...(p.prejoin ? { prejoin: p.prejoin } : {}),
      }))
      setJobs((current) => [...restored, ...current])
      const held = restored.filter((j) => j.status === 'held').length
      setNotice(
        held > 0
          ? `${held} video${held === 1 ? '' : 's'} stopped this page more than once, so ${held === 1 ? 'it has' : 'they have'} been left alone. Start it by hand, or remove it.`
          : `Picked up ${restored.length} video${restored.length === 1 ? '' : 's'} that hadn't finished.`,
      )
    })
    return () => {
      cancelled = true
    }
  }, [])

  // One at a time, as in the plain cutter: two renders at once on a phone
  // makes both slower and gets the tab killed for memory. Videos he has
  // approved go first - he is waiting on those - then videos for a chosen
  // angle, then the day's videos still to be listened to.
  useEffect(() => {
    // Nothing starts in the background: iOS takes the video decoder away
    // from a hidden page, so it would only fail.
    if (processing.current || campaigns === null || !visible) return
    // While he checks captions, only listening goes on - that is sound
    // alone. Making a video would have the page's decoder and the player on
    // screen fighting over the phone's video hardware.
    const next = reviewing
      ? jobs.find((j) => j.status === 'queued' && j.day && !j.day.parts && !j.prejoin)
      : (jobs.find((j) => j.status === 'approved') ??
        jobs.find((j) => j.status === 'queued' && !j.day) ??
        jobs.find((j) => j.status === 'queued' && j.day))
    if (!next) return
    processing.current = true

    const patch = (fields: Partial<Job>) => setJobs((js) => js.map((j) => (j.id === next.id ? { ...j, ...fields } : j)))
    // Written by setPhase from inside the work, so not narrowed here.
    let phase = 'reading' as JobPhase
    // A video that stops moving with no error at all - the phone's encoder
    // or decoder going quiet - would otherwise sit at the same percent for
    // ever. After a stretch with no progress it is given up on and takes
    // the same way out as any failure: another go, the plain cut, Try again.
    let lastMoved = Date.now()
    const watched = <T,>(work: Promise<T>): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        lastMoved = Date.now()
        const timer = window.setInterval(() => {
          // Hidden, the work waits on purpose; that is not stalling.
          if (document.visibilityState !== 'visible') lastMoved = Date.now()
          else if (Date.now() - lastMoved > STALL_MS) {
            window.clearInterval(timer)
            reject(new Error(`The phone stopped ${PHASE_LABEL[phase]} - nothing moved for ${STALL_MS / 1000} seconds`))
          }
        }, 5000)
        work.then(
          (value) => {
            window.clearInterval(timer)
            resolve(value)
          },
          (error: unknown) => {
            window.clearInterval(timer)
            reject(error)
          },
        )
      })
    const setPhase = (entered: JobPhase, progress: number) => {
      phase = entered
      lastMoved = Date.now()
      patch({ status: 'working', phase, progress })
      if (progress === 0) void recordPhase(next.id, phase)
    }
    const listening = next.day && next.status === 'queued'
    // Sending a finished video to TikTok puts this page in the background,
    // and iOS then takes its video decoder away: the video being made fails
    // with "Decoder failure". That is not the video's fault, so a video that
    // was hidden at any point goes back in line and starts again on return.
    let interrupted = document.visibilityState !== 'visible'
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') interrupted = true
    }
    document.addEventListener('visibilitychange', onVisibility)
    // The video in hand, for falling back to the plain cut and for reports.
    let kept: File | null = null

    void (async () => {
      try {
        // A stuck save never holds a video up: it is made from the copy in
        // hand either way.
        await within(persisting.current.get(next.id) ?? Promise.resolve(), 60_000, undefined)
        persisting.current.delete(next.id)
        const allowed = await claimAttempt(next.id)
        if (!allowed) {
          patch({ status: 'held', error: 'This one stopped the page twice, so it has been left alone.' })
          return
        }
        if (next.prejoin) {
          await joinFirst(next, setPhase, watched, () => interrupted)
          return
        }
        if (next.day?.parts && !next.day.plan) {
          await joinParts(next, setPhase, watched, () => interrupted)
          return
        }
        // A batch video's first clip is its reaction, read from the bank.
        const file = next.file ?? (next.montage?.bank ? await bankFileOf(next.montage.bank.reaction) : await loadJobFile(next.id))
        if (!file && next.day?.parts) {
          // Its joined file didn't keep: put the parts together again.
          const day = { ...next.day, plan: undefined, captions: undefined, checked: undefined, keep: undefined }
          patch({ status: 'queued', day, progress: 0 })
          await recordDay(next.id, day)
          return
        }
        if (!file) {
          patch({ status: 'failed', error: 'That video is no longer available on this device.' })
          await forgetJob(next.id)
          return
        }
        kept = file

        if (listening) {
          // Heard once, with every campaign's names told to the model, and
          // kept - the video itself too - until he approves where it goes.
          // A reaction video's own clip is him reacting; what is listened to
          // is the product clip - whether he talks over it, and what he says.
          // Reaction campaigns are never sorted into: they are chosen.
          const campaigns = campaignsRef.current.filter((c) => !isReaction(c) || c.id === next.campaignId)
          const heard = next.reaction ? await productOf(next) : file
          setPhase('reading', 0)
          const plan = await watched(listen(
            heard,
            next.settings,
            {
              cleanSpeech: next.cleanSpeech,
              hear: true,
              names: next.reaction
                ? (campaigns.find((c) => c.id === next.campaignId)?.brandWords ?? [])
                : dayWords(campaigns.filter((c) => !isReaction(c)), bankRef.current),
              align: captionsRef.current,
              quietIsFine: Boolean(next.reaction),
              keepWhole: next.noCut === true,
            },
            {
              onAnalyseProgress: (p) => setPhase('reading', p),
              onModelDownload: (p) => setPhase('model', p),
              onTranscribeProgress: (p) => setPhase('listening', p),
            },
          ))
          // A video he added for a campaign himself stays there: it was
          // listened to for its captions, not to be sorted.
          const guess = next.day?.chosen
            ? { campaignId: next.campaignId, angleId: next.angleId, sure: true, why: 'Chosen by you' }
            : sortVideo(plan.words, campaigns.filter((c) => !isReaction(c)))
          const campaign = campaigns.find((c) => c.id === guess.campaignId)
          const angle = campaign?.angles.find((a) => a.id === guess.angleId)
          // A reaction's headline is the hook he typed, never a line he says.
          const headlineText = next.reaction
            ? next.headlineText
            : angle
              ? headlineFor(angle, plan, next.day?.chosen && next.headlineText ? next.headlineText : angle.headline.text)
              : ''
          const day = { plan, guess, approved: false, ...(next.day?.chosen ? { chosen: true } : {}) }
          patch({
            status: 'sorted',
            day,
            campaignId: guess.campaignId,
            angleId: guess.angleId,
            headlineText,
            label: campaign && angle ? labelOf(campaign, angle) : '',
          })
          await resetAttempts(next.id)
          await recordDay(next.id, day, { campaignId: guess.campaignId, angleId: guess.angleId, headlineText })
          return
        }

        const jobCampaign = campaignsRef.current.find((c) => c.id === next.campaignId)
        const jobAngle = jobCampaign?.angles.find((a) => a.id === next.angleId)
        if (!jobCampaign || !jobAngle) {
          patch({
            status: 'failed',
            error: `The ${jobCampaign ? 'angle' : 'campaign'} this video was added for has been deleted.`,
          })
          await forgetJob(next.id)
          return
        }
        patch({ label: labelOf(jobCampaign, jobAngle) })
        // The kept copy of the video stays until it is made, so a failure
        // can always be tried again - even after a restart. What is made is
        // 1080p, well under the size of a 4K original.
        const { free } = await spaceOnDevice()
        const needed = file.size * 0.8
        if (free !== null && free < needed) {
          throw new SilenceCutError(
            `This video needs about ${Math.ceil(needed / 1e6)} MB of space and this phone will only give the app ${Math.floor(free / 1e6)} MB. Clear some space, or cut it in two halves.`,
          )
        }

        const plan = planFor(next)
        let result: CampaignResult
        if (next.montage) {
          const rest = await montageClips(next)
          const track = await montageMusic(next)
          setPhase('cutting', 0)
          result = await watched(
            makeMontage([file, ...rest], jobCampaign, jobAngle, next.headlineText, track, (p) => setPhase('cutting', p), {
              seed: next.id,
              defaults: next.day?.noEffects ? null : defaultEffects(),
            }),
          )
        } else if (next.reaction) {
          const productFile = await productOf(next)
          setPhase('cutting', 0)
          result = await watched(
            makeReaction(
              file,
              productFile,
              plan,
              jobCampaign,
              jobAngle,
              next.headlineText,
              (p) => setPhase('cutting', p),
              captionsRef.current && plan ? drawnWords(captionsFor(next, plan), bareRef.current) : [],
              voiceRef.current,
              musicFor(next),
              {
                seed: next.id,
                defaults: next.day?.noEffects ? null : defaultEffects(),
                captionPosition: next.day?.captionPosition ?? defaultCaptionPosition(),
              },
            ),
          )
        } else if (plan) {
          setPhase('cutting', 0)
          result = await watched(
            make(
              file,
            plan,
            jobCampaign,
            jobAngle,
            bankRef.current,
            next.headlineText,
            next.id,
            (p) => setPhase('cutting', p),
            next.retried === true,
              captionsRef.current ? drawnWords(captionsFor(next, plan), bareRef.current) : [],
              voiceRef.current,
              musicFor(next),
              await clipsFor(next),
              next.day?.noEffects ? null : defaultEffects(),
              next.day?.skipPictures ?? [],
              next.day?.captionPosition ?? defaultCaptionPosition(),
              next.noCut === true,
              await manualPicturesFor(next),
            ),
          )
        } else {
          setPhase('reading', 0)
          result = await watched(
            makeCampaignVideo(
              file,
            jobCampaign,
            jobAngle,
            bankRef.current,
            next.headlineText,
            next.settings,
            next.cleanSpeech,
            next.id,
            {
              onAnalyseProgress: (p) => setPhase('reading', p),
              onModelDownload: (p) => setPhase('model', p),
              onTranscribeProgress: (p) => setPhase('listening', p),
              onRenderProgress: (p) => setPhase('cutting', p),
            },
            next.retried === true,
              voiceRef.current,
              await clipsFor(next),
              next.noCut === true,
              next.day?.noEffects ? null : defaultEffects(),
            ),
          )
        }
        // Saved by a fresh decoder partway - worth knowing, though it worked.
        if (result.recovered) {
          report({
            page: 'campaign',
            kind: 'retried',
            phase: 'cutting',
            message: `Decoder gave up ${result.recovered} time(s) mid-video; carried on from the last frame and finished${next.retried ? ' (gentle second go)' : ''}`,
            video: file,
          })
        }
        patch({ status: 'done', result, url: next.batch ? undefined : URL.createObjectURL(result.blob) })
        sendToPostiz(next, jobCampaign, result)
        // A talking video keeps its recording and edits for a couple of hours,
        // so a caption, a cut or the music can be fixed and it made again.
        const keepTalking = (plan ?? result.plan) && !next.reaction && !next.montage && !next.batch && !next.prejoin && !next.day?.parts
        // A batch video's footage is the bank's, kept while a job row names it,
        // so keeping the (small) row keeps the footage for the edit window.
        const keepBatch = Boolean(next.batch && next.montage?.bank)
        if (keepTalking || keepBatch) {
          // Heard inside the making: keep what was heard so it can be edited again.
          if (!plan && result.plan) {
            const day = { plan: result.plan, approved: true, chosen: true }
            await recordDay(next.id, day)
          }
          await markMade(next.id)
          void refreshEditable()
        } else await forgetJob(next.id)
        if (next.batch) {
          // Footage let go of once the last video from it is made.
          sweepBank()
          // On its way to Postiz, with its own copy: it leaves the phone's
          // list, and its made file goes.
          const copy = copying.current.get(next.id)
          if (copy) {
            const cut = result.storedAs
            void copy.finally(() => {
              if (cut) void forgetCut(cut)
              setJobs((js) => js.filter((j) => j.id !== next.id))
            })
          }
        }
      } catch (err) {
        // Cut short by the page going away: it comes back on the next load.
        if (pageLeaving()) return
        const known = err instanceof SilenceCutError
        const why = err instanceof Error ? err.message : String(err)
        if (!known && interrupted) {
          patch({ status: next.status, progress: 0 })
          await resetAttempts(next.id)
          report({ page: 'campaign', kind: 'interrupted', phase, message: why, video: kept })
          return
        }
        // Anything unexpected gets one more go by itself before it counts:
        // the phone's decoder giving up can be a passing thing - memory
        // still being handed back after listening.
        if (!known && !next.retried) {
          patch({ status: next.status, progress: 0, retried: true })
          report({ page: 'campaign', kind: 'retried', phase, message: why, video: kept })
          return
        }
        // Still failing while the look was going on: he gets the plain cut
        // rather than nothing, and can post it.
        let plainWhy = ''
        if (!known && phase === 'cutting' && kept && !next.reaction && !next.montage) {
          try {
            const result = await watched(plainCut(kept, planFor(next), next.settings, why, (p) => setPhase('cutting', p)))
            patch({ status: 'done', result, url: URL.createObjectURL(result.blob) })
            report({ page: 'campaign', kind: 'fallback', phase, message: why, video: kept })
            await forgetJob(next.id)
            return
          } catch (plainError) {
            if (pageLeaving()) return
            plainWhy = ` The plain cut failed too (${plainError instanceof Error ? plainError.message : String(plainError)}).`
          }
        }
        const message = known
          ? err.message
          : `Something went wrong while ${PHASE_LABEL[phase]} (${why}).${plainWhy} Version ${__APP_VERSION__}.`
        // Kept, video and all, so Try again works - even after a restart.
        patch({ status: 'failed', error: message })
        await recordFailure(next.id, message)
        report({ page: 'campaign', kind: 'failed', phase, message, video: kept })
      } finally {
        document.removeEventListener('visibilitychange', onVisibility)
        processing.current = false
        setJobs((js) => [...js])
      }
    })()
  }, [jobs, campaigns, visible, reviewing])

  // The screen stays on while there is work to do, so auto-lock cannot stop
  // a day's videos halfway.
  const working = jobs.some((j) => j.status === 'working' || j.status === 'queued' || j.status === 'approved')
  useEffect(() => {
    keepScreenOn(working)
    return () => keepScreenOn(false)
  }, [working])

  /** Moves a sorted video to another campaign and angle, starting its
   *  headline again from that angle. */
  const chooseFor = (id: string, campaignId: string, angleId: string) => {
    const job = jobs.find((j) => j.id === id)
    const campaign = campaigns?.find((c) => c.id === campaignId)
    const angle = campaign?.angles.find((a) => a.id === angleId)
    if (!job?.day?.plan || !campaign || !angle) return
    const headlineText = headlineFor(angle, job.day.plan, angle.headline.text)
    setJobs((js) =>
      js.map((j) => (j.id === id ? { ...j, campaignId, angleId, headlineText, label: labelOf(campaign, angle) } : j)),
    )
    void recordDay(id, job.day, { campaignId, angleId, headlineText })
  }

  const setHeadline = (id: string, headlineText: string) =>
    setJobs((js) => js.map((j) => (j.id === id ? { ...j, headlineText } : j)))

  const saveHeadline = (id: string) => {
    const job = jobs.find((j) => j.id === id)
    if (job?.day) void recordDay(id, job.day, { headlineText: job.headlineText })
  }

  const approve = (ids: string[]) => {
    setJobs((js) =>
      js.map((j) => (ids.includes(j.id) && j.status === 'sorted' && j.day ? { ...j, status: 'approved', day: { ...j.day, approved: true } } : j)),
    )
    for (const id of ids) {
      const job = jobs.find((j) => j.id === id)
      if (job?.day && job.status === 'sorted') {
        void recordDay(id, { ...job.day, approved: true }, { campaignId: job.campaignId, angleId: job.angleId, headlineText: job.headlineText })
      }
    }
  }

  /** Makes a batch video again with the headline and track he changed; its
   *  post is replaced when it is sent. */
  const makeBatchAgain = async (edit: NonNullable<typeof batchEditing>, fields: { headline: string; music: BankFile | null }) => {
    const row = await reopenBatchJob(edit.id, edit.postKey, { headlineText: fields.headline, music: fields.music })
    setBatchEditing(null)
    if (!row?.montage || !row.batch) {
      setNotice(`The footage is only kept for ${EDIT_WINDOW_MS / 3_600_000} hours after a video is made, and this one's is gone.`)
      void refreshEditable()
      return
    }
    const campaign = campaignsRef.current.find((c) => c.id === row.campaignId)
    const angle = campaign?.angles.find((a) => a.id === row.angleId)
    const job: Job = {
      id: row.id,
      name: row.fileName,
      file: null,
      campaignId: row.campaignId,
      angleId: row.angleId,
      label: campaign && angle ? labelOf(campaign, angle) : '',
      headlineText: row.headlineText,
      settings: row.settings,
      cleanSpeech: false,
      status: 'queued',
      phase: 'cutting',
      progress: 0,
      montage: row.montage,
      batch: row.batch,
      version: row.version,
      replaces: row.replaces,
    }
    setJobs((js) => [...js.filter((j) => j.id !== job.id), job])
    void refreshEditable()
    setNotice('Making it again. Its old post is replaced when this one is sent.')
  }

  /** Opens a made video's cuts, captions and music again, from the post it
   *  went out as. Making it again replaces that post if it hasn't gone out. */
  const editAgain = async (postKey: string) => {
    const batchRow = await peekMadeBatch(jobOfPostKey(postKey))
    if (batchRow?.montage?.bank) {
      const bank = await loadBatchBank(batchRow.campaignId).catch(() => null)
      const current = batchRow.montage.bank.music
      const options = [...(bank?.music ?? [])]
      if (current && !options.some((o) => o.id === current.id)) options.unshift(current)
      const old = lastPosts().find((p) => p.key === postKey)
      setShowPosts(false)
      setBatchEditing({ id: batchRow.id, postKey, name: batchRow.fileName, headline: batchRow.headlineText, music: current, options, posted: old?.status === 'posted' })
      return
    }
    const reopened = await reopenJob(jobOfPostKey(postKey), postKey)
    if (!reopened) {
      setNotice(`The original recording is only kept for ${EDIT_WINDOW_MS / 3_600_000} hours after a video is made, and this one's is gone.`)
      void refreshEditable()
      return
    }
    const restored: Job = {
      id: reopened.id,
      name: reopened.fileName,
      file: null,
      campaignId: reopened.campaignId,
      angleId: reopened.angleId,
      label: '',
      headlineText: reopened.headlineText,
      settings: reopened.settings,
      cleanSpeech: reopened.cleanSpeech,
      status: 'sorted',
      phase: 'cutting',
      progress: 0,
      ...(reopened.day ? { day: reopened.day } : {}),
      ...(reopened.later ? { later: true } : {}),
      ...(reopened.noCut ? { noCut: true } : {}),
      version: reopened.version,
      replaces: reopened.replaces,
    }
    const campaign = campaignsRef.current.find((c) => c.id === restored.campaignId)
    const angle = campaign?.angles.find((a) => a.id === restored.angleId)
    if (campaign && angle) restored.label = labelOf(campaign, angle)
    setJobs((js) => [restored, ...js.filter((j) => j.id !== restored.id)])
    void refreshEditable()
    setShowPosts(false)
    setTab('videos')
    setReviewing([restored.id])
  }

  /** Adds the picked videos to the list. `cutWide`: a wide clip (not 9:16)
   *  is cut like the rest; false means he asked to only make it 9:16. A clip
   *  that is already 9:16 is always cut. */
  const commitAdd = (order: { file: File; filming: Filming }[], cutWide: boolean) => {
        const files = order.map((o) => o.file)
        const settings = { ...PRESETS[preset] }
        const day = mode === 'day'
        // With captions on, a video for a campaign he picked is listened to
        // first too, so he can check its captions before it is made.
        const check = !day && captionsOn
        const added: Job[] = files.map((file) => ({
          id: `${Date.now()}-${nextId++}`,
          name: file.name,
          file,
          campaignId: day ? '' : campaign!.id,
          angleId: day ? '' : angle!.id,
          label: day ? '' : labelOf(campaign!, angle!),
          headlineText: day ? '' : headlineText,
          settings,
          cleanSpeech,
          status: 'queued',
          phase: 'cutting',
          progress: 0,
          ...(day ? { day: { approved: false } } : check ? { day: { approved: false, chosen: true } } : {}),
          ...(laterNow ? { later: true } : {}),
          ...order[files.indexOf(file)].filming,
          // A wide clip he asked to only make 9:16; a 9:16 one is always cut.
          ...(!cutWide && order[files.indexOf(file)].filming.vertical === false ? { noCut: true } : {}),
        }))
        setJobs((current) => [...current, ...added])
        setNotice(null)
        const saving: Promise<unknown>[] = []
        for (const job of added) {
          const saved = persistJob({
            id: job.id,
            fileBlob: job.file!,
            fileName: job.name,
            fileType: job.file!.type,
            campaignId: job.campaignId,
            angleId: job.angleId,
            headlineText: job.headlineText,
            settings: job.settings,
            cleanSpeech: job.cleanSpeech,
            ...(job.day ? { day: job.day } : {}),
            ...(job.later ? { later: true } : {}),
            ...(job.noCut ? { noCut: true } : {}),
            ...(job.filmedAt !== undefined ? { filmedAt: job.filmedAt } : {}),
            ...(job.seconds !== undefined ? { seconds: job.seconds } : {}),
          }).catch(() => {})
          persisting.current.set(job.id, saved)
          saving.push(saved)
        }
        void Promise.all(saving).finally(pickSaved)
  }
  const commitRef = useRef(commitAdd)
  commitRef.current = commitAdd

  const addFiles = useCallback(
    (incoming: Iterable<File> | null, fromPicker = false) => {
      if (!incoming || (mode === 'one' && (!campaign || !angle))) {
        pickSaved()
        return
      }
      // The picker only offers videos, so everything it hands over is kept:
      // a file it names oddly then fails on its row, where he can see it,
      // instead of vanishing.
      const picked = fromPicker ? Array.from(incoming) : videoFilesFrom(incoming)
      if (picked.length === 0) return
      void (async () => {
        // When each was filmed, from the file: the batch goes into the list in
        // filming order, and recordings filmed moments apart are offered to be
        // joined. A file that won't say keeps the picker's order for all.
        const filming = await Promise.all(picked.map(filmingOf))
        const order = picked.map((file, i) => ({ file, filming: filming[i] }))
        if (order.every((o) => o.filming.filmedAt !== undefined)) order.sort((a, b) => a.filming.filmedAt! - b.filming.filmedAt!)
        const wide = order.filter((o) => o.filming.vertical === false)
        // A clip that is not 9:16: ask whether to cut it too. Already-9:16
        // clips are never asked about and are always cut.
        if (wide.length > 0) {
          setAskWide({ order, names: wide.map((o) => o.file.name) })
          return
        }
        commitRef.current(order, true)
      })()
    },
    [angle, campaign, captionsOn, cleanSpeech, headlineText, mode, preset, laterNow],
  )

  useEffect(() => {
    let depth = 0
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth++
      setDragging(true)
    }
    const onOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault()
    }
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragging(false)
    }
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth = 0
      setDragging(false)
      if (e.dataTransfer?.files && !editing) addFiles(e.dataTransfer.files)
    }
    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragover', onOver)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [addFiles, editing])

  /** Tries a held or failed video again, from where it had got to: a day's
   *  video he already approved is made again, not listened to again. */
  const startHeld = useCallback((id: string) => {
    void resetAttempts(id).finally(() => {
      setJobs((js) =>
        js.map((j) =>
          j.id === id
            ? {
                ...j,
                status: j.day?.plan ? (j.day.approved ? 'approved' : 'sorted') : 'queued',
                error: undefined,
                retried: false,
              }
            : j,
        ),
      )
    })
  }, [])

  const removeJob = useCallback((id: string) => {
    setJobs((js) => {
      const going = js.find((j) => j.id === id)
      if (going?.url) URL.revokeObjectURL(going.url)
      if (going?.result?.storedAs) {
        const cut = going.result.storedAs
        void (copying.current.get(id) ?? Promise.resolve()).finally(() => forgetCut(cut))
      }
      if (going?.joinedAs) void forgetCut(going.joinedAs)
      const gone = withParts([id], js)
      return js.filter((j) => !gone.has(j.id))
    })
    void (persisting.current.get(id) ?? Promise.resolve())
      .then(() => forgetJob(id))
      .then(() => sweepBank())
  }, [])

  const clearFinished = useCallback(() => {
    setJobs((current) => {
      for (const j of current) {
        if ((j.status === 'done' || j.status === 'failed') && j.url) URL.revokeObjectURL(j.url)
        if (j.status === 'done' && j.result?.storedAs) {
          const cut = j.result.storedAs
          void (copying.current.get(j.id) ?? Promise.resolve()).finally(() => forgetCut(cut))
        }
        // A failed video is kept for Try again until it is cleared.
        if (j.status === 'failed') void forgetJob(j.id)
        if ((j.status === 'done' || j.status === 'failed') && j.joinedAs) void forgetCut(j.joinedAs)
      }
      const gone = withParts(
        current.filter((j) => j.status === 'done' || j.status === 'failed').map((j) => j.id),
        current,
      )
      return current.filter((j) => !gone.has(j.id))
    })
  }, [])

  /** Stores a campaign and puts it in the list, newest first. */
  const store = async (edited: Campaign): Promise<Campaign> => {
    const saved = await saveCampaign(withGeneralAngle(edited))
    setCampaigns((cs) => ordered([saved, ...(cs ?? []).filter((c) => c.id !== saved.id)]))
    return saved
  }

  const saveCampaignEdit = async (edited: Campaign, isNew: boolean) => {
    const saved = await store(edited)
    if (isNew) {
      // Usable at once: its videos go to its General angle until he adds
      // angles of his own. Its page opens, where the General angle's look,
      // new angles and its posting are.
      select(saved, saved.angles.find((a) => a.general) ?? saved.angles[0])
      setEditing(null)
      setTab('campaigns')
      setOpenCampaignId(saved.id)
    } else {
      select(saved, saved.angles.find((a) => a.id === angleId))
      setEditing(null)
    }
  }

  const saveAngleEdit = async (owner: Campaign, edited: Angle, clips?: AngleClips) => {
    if (clips) setAngleClips(await saveAngleClips(angleKey(owner.id, edited.id), clips))
    const exists = owner.angles.some((a) => a.id === edited.id)
    const angles = exists ? owner.angles.map((a) => (a.id === edited.id ? edited : a)) : [...owner.angles, edited]
    const saved = await store({ ...owner, angles })
    select(saved, edited)
    setEditing(null)
  }

  /** The brand's rules go with the campaign, to both phones; his own
   *  accounts and times go to his profile. */
  const savePosting = async (owner: Campaign, rules: CampaignPosting, place: { accounts: string[]; times: string[] } | null, catchUp: string[] = []) => {
    if (place) {
      await saveCampaignPlace(owner.id, place)
      setPosting(postingHere())
      // Videos already made were fixed to the accounts the campaign had; the
      // ones he just added are caught up when he asked for it. A failure here
      // is said, not swallowed - the new accounts are saved either way, and
      // saving again retries it.
      if (catchUp.length > 0) {
        await attachAccounts(owner.id, catchUp)
          .then((result) => setNotice(attachSummary(result)))
          .catch((error: unknown) =>
            setNotice(`The new account is saved, but the videos already made could not be updated: ${error instanceof Error ? error.message : String(error)} Save posting again to retry.`),
          )
      }
    }
    const saved = await store({ ...owner, posting: rules })
    select(saved, saved.angles.find((a) => a.id === angleId))
    setEditing(null)
  }

  /** "2 accounts · 6 PM, 8 PM · you approve" - how a campaign posts, from
   *  this phone. */
  const postingLine = (owner: Campaign): string => {
    const rules = owner.posting ?? NO_POSTING
    const approval = rules.approval === 'direct' ? 'straight away' : rules.approval === 'brand' ? 'brand approves' : 'you approve'
    if (!posting) return owner.posting ? `Not set up on this phone · ${approval}` : 'Not set up - finished videos stay on the phone'
    const place = placeFor(posting.profile, owner.id)
    if (place.accounts.length === 0) return 'No accounts picked - its videos are not sent'
    const times = place.times.length > 0 ? place.times.map(timeLabel).join(', ') : 'as soon as ready'
    return `${place.accounts.length} account${place.accounts.length === 1 ? '' : 's'} · ${times} · ${approval}`
  }

  const removeCampaign = async (id: string) => {
    await deleteCampaign(id)
    const rest = ordered((campaigns ?? []).filter((c) => c.id !== id))
    setCampaigns(rest)
    setEditing(null)
    select(rest[0] ?? null)
  }

  const removeAngle = async (owner: Campaign, id: string) => {
    setAngleClips(await saveAngleClips(angleKey(owner.id, id), {}).catch(() => angleClips))
    const saved = await store({ ...owner, angles: owner.angles.filter((a) => a.id !== id) })
    select(saved)
    setEditing(null)
  }

  const newAngle = (owner: Campaign, from: Angle) => {
    const angle = copyAngle(from, crypto.randomUUID(), `Angle ${owner.angles.filter((a) => !a.general).length + 1}`)
    setEditing({ kind: 'angle', campaign: owner, angle, isNew: true, copiedFrom: from.name })
  }

  const finished = useMemo(() => jobs.filter((j) => j.status === 'done' && j.result && !j.batch), [jobs])
  // "Approve all" never covers a video marked Needs you - those wait for him
  // to look.
  const sorted = jobs.filter((j) => j.status === 'sorted' && j.day?.guess?.sure !== false)
  // Batch videos are followed on the Batch tab.
  const listed = useMemo(() => jobs.filter((j) => j.status !== 'joined' && !j.batch), [jobs])
  const batchJobs = useMemo(() => jobs.filter((j) => j.batch), [jobs])
  const [dismissedJoins, setDismissedJoins] = useState<Set<string>>(() => new Set())
  // Recordings filmed one right after the other, offered to be joined.
  const joinPairs = useMemo(
    () => new Map(joinSuggestions(jobs.filter(joinable).map((j) => ({ id: j.id, filmedAt: j.filmedAt, seconds: j.seconds })), dismissedJoins)),
    [jobs, dismissedJoins], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const summary = useMemo(() => {
    if (listed.length === 0) return ''
    const parts: string[] = []
    const unsure = jobs.filter((j) => j.status === 'sorted' && j.day?.guess?.sure === false).length
    const toApprove = jobs.filter((j) => j.status === 'sorted').length - unsure
    const failed = jobs.filter((j) => j.status === 'failed' || j.status === 'held').length
    if (unsure > 0) parts.push(`${unsure} need${unsure === 1 ? 's' : ''} you`)
    if (toApprove > 0) parts.push(`${toApprove} to approve`)
    parts.push(`${finished.length} of ${listed.length} ready`)
    if (failed > 0) parts.push(`${failed} failed`)
    return parts.join(' · ')
  }, [finished, jobs, listed])
  const shareAll = useMemo(
    () => finished.map((j) => new File([j.result!.blob], outputName(j.name, j.label), { type: 'video/mp4' })),
    [finished],
  )
  const canShareAll = useMemo(() => shareAll.length > 1 && canShareFiles(shareAll), [shareAll])
  const [shareAllFailed, setShareAllFailed] = useState(false)

  const busy = jobs.some((j) => j.status === 'working')
  const workToLose = async () => {
    if (busy) return 'A video is being made right now. Leaving stops it; it starts again when you come back. Leave anyway?'
    if (finished.length > 0) return "Leaving clears the finished videos on this page. Send them first if you haven't. Leave anyway?"
    return null
  }

  const ownCampaigns = (campaigns ?? []).filter((c) => !c.general)
  const startNewCampaign = () => setEditing({ kind: 'campaign', campaign: blankCampaign(crypto.randomUUID()), isNew: true })

  /** Each reaction clip becomes a video with the product clip picked for
   *  them, listened to first - the product clip - for any talking. */
  const addReactions = (picked: File[]) => {
    if (!campaign || !angle || !product) {
      pickSaved()
      return
    }
    const settings = { ...PRESETS[preset] }
    const parts = { productId: product.id, productName: product.file.name, productType: product.file.type }
    const added: Job[] = picked.map((file) => ({
      id: `${Date.now()}-${nextId++}`,
      name: file.name,
      file,
      campaignId: campaign.id,
      angleId: angle.id,
      label: labelOf(campaign, angle),
      headlineText,
      settings,
      cleanSpeech,
      status: 'queued',
      phase: 'cutting',
      progress: 0,
      day: { approved: false, chosen: true },
      reaction: { ...parts, productFile: product.file },
      ...(laterNow ? { later: true } : {}),
    }))
    setJobs((current) => [...current, ...added])
    setNotice(null)
    const productSaved = persistProduct(product.id, product.file)
    const saving = added.map((job) => {
      const saved = productSaved
        .then(() =>
          persistJob({
            id: job.id,
            fileBlob: job.file!,
            fileName: job.name,
            fileType: job.file!.type,
            campaignId: job.campaignId,
            angleId: job.angleId,
            headlineText: job.headlineText,
            settings: job.settings,
            cleanSpeech: job.cleanSpeech,
            day: job.day,
            reaction: parts,
            ...(job.later ? { later: true } : {}),
          }),
        )
        .catch(() => {})
      persisting.current.set(job.id, saved)
      return saved
    })
    void Promise.all(saving).finally(pickSaved)
  }

  /** The bank files the videos on the page are still to be made from. */
  const jobsNow = useRef<Job[]>([])
  jobsNow.current = jobs
  /** Deletes the footage a spent bank let go of, once nothing needs it. */
  const sweepBank = () => {
    sweepBankRef.current = sweepBank
    const inUse = jobsNow.current.flatMap((j) => (j.montage?.bank && j.status !== 'done' ? [j.montage.bank.reaction.id, j.montage.bank.product.id] : []))
    void sweepRetiredBankFiles(inUse)
  }

  /** A batch from the Batch tab: each video is a clips-and-music video of
   *  a reaction and a product from the bank, made in turn, then sent up to
   *  wait for his approval at its day and time. */
  const addBatch = (owner: Campaign, ownerAngle: Angle, videos: BatchVideo[], retire: string[] = []) => {
    const settings = { ...PRESETS[preset] }
    const added: Job[] = videos.map((v) => ({
      id: `${Date.now()}-${nextId++}`,
      name: `${v.reaction.name.replace(/\.[^./]+$/, '')} + ${v.product.name.replace(/\.[^./]+$/, '')}.mp4`,
      file: null,
      campaignId: owner.id,
      angleId: ownerAngle.id,
      label: labelOf(owner, ownerAngle),
      headlineText: v.headline,
      settings,
      cleanSpeech: false,
      status: 'queued',
      phase: 'cutting',
      progress: 0,
      montage: { bank: { reaction: v.reaction, product: v.product, music: v.music }, clips: [], music: 'bank' },
      batch: v.batch,
    }))
    setJobs((current) => [...current, ...added])
    for (const job of added) {
      const saved = persistJobRow({
        id: job.id,
        fileName: job.name,
        fileType: 'video/mp4',
        campaignId: job.campaignId,
        angleId: job.angleId,
        headlineText: job.headlineText,
        settings,
        cleanSpeech: false,
        montage: { bank: job.montage!.bank, clips: [], music: 'bank' },
        batch: job.batch,
      })
      persisting.current.set(job.id, saved)
    }
    // A spent bank's footage: deleted once these videos, saved first, no
    // longer need it.
    if (retire.length > 0) {
      void Promise.all(added.map((j) => persisting.current.get(j.id)))
        .then(() => retireBankFiles(retire))
        .then(() => sweepBank())
    }
  }

  /** Recordings he joined before adding: one video, put together first,
   *  then heard and sorted like any other he drops in. */
  const addJoined = (files: File[]) => {
    if (files.length < 2) return
    const [first, ...rest] = files
    const settings = { ...PRESETS[preset] }
    const clips = rest.map((f) => ({ name: f.name, type: f.type }))
    const job: Job = {
      id: `${Date.now()}-${nextId++}`,
      name: files.map((f) => f.name).join(' + '),
      file: first,
      campaignId: '',
      angleId: '',
      label: '',
      headlineText: '',
      settings,
      cleanSpeech,
      status: 'queued',
      phase: 'joining',
      progress: 0,
      day: { approved: false },
      prejoin: { clips, files: rest },
      ...(laterNow ? { later: true } : {}),
    }
    setJobs((current) => [...current, job])
    setNotice(null)
    const saved = persistJob({
      id: job.id,
      fileBlob: first,
      fileName: job.name,
      fileType: first.type,
      campaignId: '',
      angleId: '',
      headlineText: '',
      settings,
      cleanSpeech,
      day: job.day,
      prejoin: { clips },
      ...(job.later ? { later: true } : {}),
    })
      .then(() => persistMontage(job.id, rest, null))
      .catch(() => {})
    persisting.current.set(job.id, saved)
  }

  /** A clips-and-music video he put together: nothing to listen to or
   *  approve, so it is made in turn straight away. */
  const addMontage = ({ files, music, song }: Montage) => {
    if (!campaign || !angle || files.length === 0) return
    const [first, ...rest] = files
    const parts = {
      clips: rest.map((f) => ({ name: f.name, type: f.type })),
      music,
      ...(song ? { song: { name: song.name, type: song.type } } : {}),
    }
    const settings = { ...PRESETS[preset] }
    const job: Job = {
      id: `${Date.now()}-${nextId++}`,
      name: first.name,
      file: first,
      campaignId: campaign.id,
      angleId: angle.id,
      label: labelOf(campaign, angle),
      headlineText,
      settings,
      cleanSpeech: false,
      status: 'queued',
      phase: 'cutting',
      progress: 0,
      montage: { ...parts, files: rest, ...(song ? { songFile: song } : {}) },
      ...(laterNow ? { later: true } : {}),
    }
    setJobs((current) => [...current, job])
    setNotice(null)
    const saved = persistJob({
      id: job.id,
      fileBlob: first,
      fileName: first.name,
      fileType: first.type,
      campaignId: job.campaignId,
      angleId: job.angleId,
      headlineText,
      settings,
      cleanSpeech: false,
      montage: parts,
      ...(job.later ? { later: true } : {}),
    })
      .then(() => persistMontage(job.id, rest, song))
      .catch(() => {})
    persisting.current.set(job.id, saved)
  }

  const onReactionsPicked = (picked: File[]) => {
    const problem = pickArrived(picked)
    if (problem) setNotice(problem)
    else addReactions(picked)
  }

  const onProductPicked = (picked: File[]) => {
    const problem = pickArrived(picked)
    if (problem) {
      setNotice(problem)
      return
    }
    setProduct({ id: crypto.randomUUID(), file: picked[0] })
    pickSaved()
  }

  const onPicked = (picked: File[]) => {
    const problem = pickArrived(picked)
    if (problem) setNotice(problem)
    else addFiles(picked, true)
  }

  const dropZone = (label: string, hint: string, onFiles: (files: File[]) => void = onPicked) =>
    listed.length > 0 && !dragging ? (
      // With a list to look at, adding more is one button, not half the
      // screen.
      <VideoPicker className="btn add-more" label={label} onFiles={onFiles}>
        <UploadIcon /> {label === "Add today's videos" ? 'Add more videos' : label}
      </VideoPicker>
    ) : (
      <VideoPicker className={dragging ? 'drop over' : 'drop'} label={label} onFiles={onFiles}>
        <span className="icon">
          <UploadIcon />
        </span>
        <span className="big">{dragging ? 'Drop them anywhere' : label}</span>
        <span className="hint">{hint}</span>
      </VideoPicker>
    )

  /** Finished videos that went nowhere because their campaign has no
   *  accounts picked on this phone - said, not left to be wondered about. */
  const unsent = posting
    ? jobs.filter((j) => {
        const owner = campaigns?.find((c) => c.id === j.campaignId)
        return j.status === 'done' && j.result && owner && placeFor(posting.profile, owner.id).accounts.length === 0
      })
    : []

  /** "Send to Postiz" on a finished video that didn't go by itself - the
   *  plain cut, or one made before posting was set up. */
  const postByHand = (job: Job): (() => void) | undefined => {
    const owner = campaigns?.find((c) => c.id === job.campaignId)
    if (job.status !== 'done' || !job.result || !posting || !owner) return undefined
    if (placeFor(posting.profile, owner.id).accounts.length === 0) return undefined
    if (outgoing.some((o) => o.entry.key === job.id)) return undefined
    return () => sendToPostiz(job, owner, job.result!, true)
  }

  const videos = (
    <section className="screen">
      <div className="screen-head">
        <h1>Videos</h1>
        <button type="button" className={`status-link${syncState.kind === 'waiting' ? ' warn-text' : ''}`} onClick={() => setTab('settings')}>
          {session ? (syncState.kind === 'waiting' ? 'Not synced' : syncState.kind === 'syncing' ? 'Syncing…' : 'Shared') : 'Not shared'}
        </button>
      </div>

      {phoneProblem ? (
        <div className="notice">
          <span className="warn-text">{phoneProblem}</span>
          <button type="button" className="linkbtn" onClick={() => setPhoneProblem(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      {notice ? (
        <div className="notice">
          <span>{notice}</span>
          <button type="button" className="linkbtn" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      {posting ? (
        <button type="button" className="callout posts-link" onClick={() => setShowPosts(true)}>
          <span>
            <span className="label">Posts</span>
            <span className={`hint${unsent.length > 0 ? ' warn-text' : toApprove > 0 ? ' now-text' : ''}`} style={{ display: 'block' }}>
              {postsLine(toApprove, outgoing.filter((o) => o.entry.state === 'sending').length, unsent.length)}
            </span>
          </span>
          <ChevronRight />
        </button>
      ) : null}
      {posting ? (
        <div className="post-later">
          <div className="seg full" role="radiogroup" aria-label="When the videos you add now post">
            {[
              { later: false, label: 'Post today' },
              { later: true, label: 'For the next days' },
            ].map((o) => (
              <button
                key={o.label}
                type="button"
                role="radio"
                aria-checked={postLater === o.later}
                className={postLater === o.later ? 'active' : ''}
                onClick={() => setPostLater(o.later)}
              >
                {o.label}
              </button>
            ))}
          </div>
          {postLater ? (
            <div className="hint">Videos you add now take their campaign's times from tomorrow. Back to Post today tomorrow.</div>
          ) : null}
        </div>
      ) : null}

      {ownCampaigns.length === 0 ? (
        <div className="callout">
          <div>
            <div className="label">Set up your first campaign</div>
            <div className="hint">Until then, videos go to General.</div>
          </div>
          <button
            type="button"
            className="btn small primary"
            onClick={() => {
              setTab('campaigns')
              startNewCampaign()
            }}
          >
            Set up
          </button>
        </div>
      ) : null}

      {mode === 'join' ? (
        <JoinPicker onJoin={addJoined} onBack={() => setMode('day')} onNotice={setNotice} />
      ) : mode === 'clips' && campaign && angle ? (
        <ClipsMaker
          campaigns={campaigns ?? []}
          campaign={campaign}
          angle={angle}
          headline={headlineText}
          onSelect={select}
          onHeadline={setHeadlineText}
          onMake={addMontage}
          onBack={() => setMode('day')}
          onNotice={setNotice}
        />
      ) : mode === 'day' || !campaign || !angle ? (
        <>
          {dropZone("Add today's videos", "Each is sorted into its campaign - you approve before anything's made")}
          {campaign && angle ? (
            <div className="under-drop-links">
              <button type="button" className="linkbtn" onClick={() => setMode('one')}>
                {(campaigns ?? []).some(isReaction) ? 'Choose the campaign myself - for reaction videos too' : 'Choose the campaign myself'}
              </button>
              <button type="button" className="linkbtn" onClick={() => setMode('clips')}>
                No talking? Clips + music
              </button>
              <button type="button" className="linkbtn" onClick={() => setMode('join')}>
                Join recordings first
              </button>
            </div>
          ) : null}
        </>
      ) : (
        <div className="chooser">
          <div className="chooser-head">
            <span className="label">Videos for</span>
            <button type="button" className="linkbtn" onClick={() => setMode('day')}>
              Sort them for me
            </button>
          </div>
          <select aria-label="Campaign" value={campaign.id} onChange={(e) => select(campaigns?.find((c) => c.id === e.target.value) ?? null)}>
            {(campaigns ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {campaign.angles.length > 1 ? (
            <div className="seg chips" role="radiogroup" aria-label="Angle">
              {campaign.angles.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  role="radio"
                  aria-checked={a.id === angle.id}
                  className={a.id === angle.id ? 'active' : ''}
                  onClick={() => select(campaign, a)}
                >
                  {a.name}
                </button>
              ))}
            </div>
          ) : null}
          {angle.headline.fromFirstLine && !isReaction(campaign) ? null : (
            <input
              type="text"
              aria-label="Headline for these videos"
              value={headlineText}
              maxLength={LIMITS.headlineChars}
              placeholder={isReaction(campaign) ? 'Headline on the reaction (none)' : 'Headline for these videos (none)'}
              onChange={(e) => setHeadlineText(e.target.value)}
            />
          )}
          {isReaction(campaign) ? (
            <>
              <div className="product-row">
                <span className="product-text">
                  <span className="label">Product clip</span>
                  <span className="hint">{product ? product.file.name : 'Shown after each reaction'}</span>
                </span>
                <VideoPicker className={product ? 'btn small' : 'btn small primary'} label="Choose the product clip" onFiles={onProductPicked}>
                  {product ? 'Change' : 'Choose'}
                </VideoPicker>
              </div>
              {product ? (
                dropZone(`Add reaction clips for ${labelOf(campaign, angle)}`, 'Each one becomes a video: your reaction, then the product clip', onReactionsPicked)
              ) : (
                <p className="hint">Choose the product clip first, then add your reaction clips.</p>
              )}
            </>
          ) : (
            dropZone(`Add videos for ${labelOf(campaign, angle)}`, 'Made straight away, one at a time')
          )}
        </div>
      )}

      {listed.length > 0 ? (
        <>
          <div className="summary">
            <span className="hint">{summary}</span>
            <div className="summary-actions">
              {sorted.length > 1 ? (
                captionsOn ? (
                  <button type="button" className="btn small primary" onClick={() => startCheck(sorted.map((j) => j.id))}>
                    Check {sorted.length}
                  </button>
                ) : (
                  <button type="button" className="btn small primary" onClick={() => approve(sorted.map((j) => j.id))}>
                    Approve {sorted.length} sorted
                  </button>
                )
              ) : null}
              {canShareAll && !shareAllFailed ? (
                <button
                  type="button"
                  className="btn small primary"
                  onClick={() => void share(shareAll).then((ok) => !ok && setShareAllFailed(true))}
                >
                  Send all {shareAll.length}
                </button>
              ) : null}
            </div>
          </div>
          <ul className="vlist">
            {listed.map((job) => (
              <JobRow
                key={job.id}
                job={job}
                label={job.label || labelFor(campaigns ?? [], job)}
                campaigns={campaigns ?? []}
                onApprove={() => approve([job.id])}
                onCheck={captionsOn && talkingIn(job) ? () => startCheck([job.id]) : undefined}
                onCuts={talkingIn(job) ? () => setCutting({ id: job.id }) : undefined}
                onMusic={(choice) => setMusic(job.id, choice)}
                onNoEffects={(off) => setNoEffects(job.id, off)}
                pictures={picturesFor(job)}
                onSkipPicture={(pictureId, skip) => setSkipPicture(job.id, pictureId, skip)}
                clips={clipsField(job)}
                joinWith={
                  joinable(job)
                    ? listed.filter((o) => o.id !== job.id && joinable(o)).map((o) => ({ id: o.id, label: `${o.name} · "${firstWords(o)}"` }))
                    : undefined
                }
                onJoin={(otherId) => joinVideos(job.id, otherId)}
                suggestJoin={
                  joinPairs.has(job.id)
                    ? {
                        name: jobs.find((j) => j.id === joinPairs.get(job.id))?.name ?? '',
                        onJoin: () => joinVideos(job.id, joinPairs.get(job.id)!),
                        onDismiss: () => setDismissedJoins((d) => new Set(d).add(`${job.id}|${joinPairs.get(job.id)}`)),
                      }
                    : undefined
                }
                parts={
                  job.day?.parts && job.status === 'sorted'
                    ? { names: job.day.parts.map((id) => jobs.find((j) => j.id === id)?.name ?? ''), onSplit: () => splitVideo(job.id) }
                    : undefined
                }
                onChoose={(campaignId, angleId) => chooseFor(job.id, campaignId, angleId)}
                onHeadline={(text) => setHeadline(job.id, text)}
                onHeadlineDone={() => saveHeadline(job.id)}
                onRetry={() => startHeld(job.id)}
                onRemove={() => removeJob(job.id)}
                onPost={postByHand(job)}
                postingNote={
                  unsent.includes(job)
                    ? 'Not sent to Postiz: no accounts are picked for this campaign. Pick them in Campaigns, then Posting - then this video gets a Send to Postiz button.'
                    : undefined
                }
              />
            ))}
          </ul>
          {jobs.some((j) => j.status === 'done' || j.status === 'failed') ? (
            <button type="button" className="linkbtn" onClick={clearFinished}>
              Clear finished
            </button>
          ) : null}
        </>
      ) : (
        <p className="empty">Nothing yet. The day's videos show up here.</p>
      )}
    </section>
  )

  const reviewJob = reviewing ? jobs.find((j) => j.id === reviewing[0] && j.day?.plan) : undefined
  const cutsJob = cutting ? jobs.find((j) => j.id === cutting.id && j.day?.plan) : undefined
  // The recording on screen - for checking captions or fixing cuts - read
  // from storage once per video opened.
  const openJob = cutsJob ?? reviewJob
  const [reviewFile, setReviewFile] = useState<{ id: string; file: Blob | null; missing: boolean } | null>(null)
  useEffect(() => {
    if (!openJob) return
    if (openJob.file && !openJob.reaction) {
      setReviewFile({ id: openJob.id, file: openJob.file, missing: false })
      return
    }
    let cancelled = false
    // A reaction's words and cuts are the product clip's.
    void (openJob.reaction ? productOf(openJob) : loadJobFile(openJob.id))
      .catch(() => null)
      .then((file) => !cancelled && setReviewFile({ id: openJob.id, file, missing: !file }))
    return () => {
      cancelled = true
    }
    // The file is read once per video opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openJob?.id])

  /** The track picked for one video, or its angle's again for "". */
  const setMusic = (id: string, choice: string) => {
    const job = jobs.find((j) => j.id === id)
    if (!job?.day) return
    const day = { ...job.day, music: choice || undefined }
    setJobs((js) => js.map((j) => (j.id === id ? { ...j, day } : j)))
    void recordDay(id, day, { campaignId: job.campaignId, angleId: job.angleId, headlineText: job.headlineText })
  }

  /** Where a picture he puts on starts: the angle's picture-bank spot. */
  function angleBankDefaults(job: Job) {
    const campaign = campaignsRef.current.find((c) => c.id === job.campaignId)
    const angle = campaign?.angles.find((a) => a.id === job.angleId)
    return angle ? { position: angle.bank.position, widthPct: angle.bank.widthPct, seconds: angle.bank.seconds } : undefined
  }

  /** The pictures he put on this video by hand, with their images: a bank
   *  picture from the bank, one from his phone from storage. A picture whose
   *  image is gone is left off - and he is told, not left wondering. */
  async function manualPicturesFor(job: Job): Promise<{ picture: ManualPicture; image: Blob }[]> {
    const found: { picture: ManualPicture; image: Blob }[] = []
    let lost = 0
    for (const picture of job.day?.overlays ?? []) {
      let image: Blob | null | undefined = null
      if (picture.source.kind === 'bank') {
        const id = picture.source.pictureId
        image = bankRef.current.find((b) => b.id === id)?.image
      } else image = await loadOverlayFile(job.id, picture.id, picture.source.type).catch(() => null)
      if (image) found.push({ picture, image })
      else lost++
    }
    if (lost > 0) setNotice(`${lost} picture${lost === 1 ? '' : 's'} you put on this video could not be found, so ${lost === 1 ? 'it was' : 'they were'} left off.`)
    return found
  }

  /** The names this video's campaign uses - brand words, the words that bring
   *  up its logo and pictures - for spotting and fixing a name heard wrong. */
  function vocabularyFor(job: Job): string[] {
    const campaign = campaignsRef.current.find((c) => c.id === job.campaignId)
    const angle = campaign?.angles.find((a) => a.id === job.angleId)
    if (!campaign || !angle) return []
    return [...new Set([...campaign.brandWords, ...wordsToHear(videoLook(campaign, angle, bankRef.current))])]
  }

  /** The pictures a sorted video will show, for leaving any of them out. */
  function picturesFor(job: Job): PictureChoice[] {
    const plan = job.day?.plan
    const campaign = campaignsRef.current.find((c) => c.id === job.campaignId)
    const angle = campaign?.angles.find((a) => a.id === job.angleId)
    return plan && angle ? picturesHeard(angle, bankRef.current, plan.words) : []
  }

  const setSkipPicture = (id: string, pictureId: string, skip: boolean) => {
    const job = jobs.find((j) => j.id === id)
    if (!job?.day) return
    const now = job.day.skipPictures ?? []
    const next = skip ? [...new Set([...now, pictureId])] : now.filter((p) => p !== pictureId)
    const day = { ...job.day, skipPictures: next.length > 0 ? next : undefined }
    setJobs((js) => js.map((j) => (j.id === id ? { ...j, day } : j)))
    void recordDay(id, day, { campaignId: job.campaignId, angleId: job.angleId, headlineText: job.headlineText })
  }

  /** Moves this video's captions (top, middle, usual, bottom). */
  const setCaptionPosition = (id: string, captionPosition: CaptionPosition) => {
    const job = jobs.find((j) => j.id === id)
    if (!job?.day) return
    const day = { ...job.day, captionPosition }
    setJobs((js) => js.map((j) => (j.id === id ? { ...j, day } : j)))
    void recordDay(id, day, { campaignId: job.campaignId, angleId: job.angleId, headlineText: job.headlineText })
  }

  const setNoEffects = (id: string, noEffects: boolean) => {
    const job = jobs.find((j) => j.id === id)
    if (!job?.day) return
    const day = { ...job.day, noEffects: noEffects || undefined }
    setJobs((js) => js.map((j) => (j.id === id ? { ...j, day } : j)))
    void recordDay(id, day, { campaignId: job.campaignId, angleId: job.angleId, headlineText: job.headlineText })
  }

  /** The kept parts as he fixed them, or none when they are the plan's own. */
  const keepCuts = (id: string, keep: Range[], overlays: ManualPicture[] = [], files: Map<string, Blob> = new Map()) => {
    const job = jobs.find((j) => j.id === id)
    if (!job?.day?.plan) return
    const same = JSON.stringify(keep) === JSON.stringify(job.day.plan.keep)
    // Pictures picked from the phone are kept under this video; ones he took
    // off are let go.
    const kept = new Set(overlays.map((o) => o.id))
    for (const [pictureId, blob] of files) if (kept.has(pictureId)) void saveOverlayFile(id, pictureId, blob).catch(() => {})
    for (const old of job.day.overlays ?? []) if (old.source.kind === 'phone' && !kept.has(old.id)) void deleteOverlayFile(id, old.id).catch(() => {})
    const day = { ...job.day, keep: same ? undefined : keep, overlays: overlays.length > 0 ? overlays : undefined }
    setJobs((js) => js.map((j) => (j.id === id ? { ...j, day } : j)))
    void recordDay(id, day, { campaignId: job.campaignId, angleId: job.angleId, headlineText: job.headlineText })
  }

  /** Keeps the captions as he left them, approved or not - and, approved,
   *  whether the video gets them at all. */
  const keepCaptions = (id: string, words: CaptionWord[], approved: false | 'with' | 'without') => {
    const job = jobs.find((j) => j.id === id)
    if (!job?.day) return
    const day = {
      ...job.day,
      captions: words,
      ...(approved ? { checked: true, approved: true, noCaptions: approved === 'without' } : {}),
    }
    setJobs((js) => js.map((j) => (j.id === id ? { ...j, day, ...(approved ? { status: 'approved' as const } : {}) } : j)))
    void recordDay(id, day, { campaignId: job.campaignId, angleId: job.angleId, headlineText: job.headlineText })
  }

  // Every word of the video is kept, fixed or not; only those captioned -
  // the ones said after the headline has gone - are put in front of him.
  // Those are the last of them, so what he typed simply follows the rest,
  // however many words it now has.
  const review = (() => {
    const plan = reviewJob ? planFor(reviewJob) : undefined
    if (!reviewJob || !plan) return null
    const all = captionWordsFor(reviewJob, plan)
    const shown = reviewJob.day?.hookCaptions ? all.map((_, i) => i) : captionedIndices(all, plan.keep, hookFor(reviewJob))
    const hidden = all.filter((_, i) => !shown.includes(i))
    const merge = (edited: CaptionWord[]) => [...hidden, ...edited]
    return { all, shown, merge }
  })()

  /** Checks these videos' captions - first asking whether the hook gets
   *  captions, when any of them has a headline to have a hook under. */
  const startCheck = (ids: string[]) => {
    if (ids.some((id) => jobs.some((j) => j.id === id && hookFor(j) > 0))) setAskingHook(ids)
    else setReviewing(ids)
  }

  /** Keeps the hook answer on each video, then goes on to check them. */
  const answerHook = (ids: string[], hookCaptions: boolean) => {
    for (const job of jobs) {
      if (!ids.includes(job.id) || !job.day) continue
      const day = { ...job.day, hookCaptions }
      void recordDay(job.id, day, { campaignId: job.campaignId, angleId: job.angleId, headlineText: job.headlineText })
    }
    setJobs((js) => js.map((j) => (ids.includes(j.id) && j.day ? { ...j, day: { ...j.day, hookCaptions } } : j)))
    setAskingHook(null)
    setReviewing(ids)
  }

  /** On to the next video still waiting to be checked, or back to the list. */
  const nextReview = () =>
    setReviewing((queue) => {
      const rest = (queue ?? []).slice(1).filter((id) => jobs.some((j) => j.id === id && j.status === 'sorted'))
      return rest.length > 0 ? rest : null
    })

  const screen =
    supported === false ? (
      <div className="error">This browser can't make video yet - it needs iOS 26 / Safari 26 or newer, or Chrome.</div>
    ) : askWide ? (
      <WideAsk
        names={askWide.names}
        total={askWide.order.length}
        onCut={() => {
          commitRef.current(askWide.order, true)
          setAskWide(null)
        }}
        onOnly916={() => {
          commitRef.current(askWide.order, false)
          setAskWide(null)
        }}
        onCancel={() => {
          // The wide ones are dropped; any 9:16 ones in the same drop are still added and cut.
          const rest = askWide.order.filter((o) => o.filming.vertical !== false)
          setAskWide(null)
          if (rest.length > 0) commitRef.current(rest, true)
        }}
      />
    ) : batchEditing ? (
      <BatchEdit
        key={batchEditing.id}
        name={batchEditing.name}
        headline={batchEditing.headline}
        music={batchEditing.music}
        options={batchEditing.options}
        posted={batchEditing.posted}
        onMake={(fields) => void makeBatchAgain(batchEditing, fields)}
        onCancel={() => setBatchEditing(null)}
      />
    ) : editing?.kind === 'campaign' ? (
      <CampaignEditor
        key={editing.campaign.id}
        initial={editing.campaign}
        isNew={editing.isNew}
        onSave={(edited) => saveCampaignEdit(edited, editing.isNew)}
        onCancel={() => setEditing(null)}
        onDelete={() => void removeCampaign(editing.campaign.id)}
      />
    ) : editing?.kind === 'posting' ? (
      <PostingEditor
        key={editing.campaign.id}
        campaign={editing.campaign}
        local={posting}
        onSave={(rules, place, catchUp) => savePosting(editing.campaign, rules, place, catchUp)}
        onCancel={() => setEditing(null)}
        onSetUp={() => {
          setEditing(null)
          setSettingUpPosting(true)
        }}
      />
    ) : settingUpPosting ? (
      <PostingSetup
        again={posting !== null}
        onDone={() => {
          setPosting(postingHere())
          setSettingUpPosting(false)
          setTab('settings')
        }}
        onCancel={() => setSettingUpPosting(false)}
      />
    ) : editing?.kind === 'angle' ? (
      <AngleEditor
        key={editing.angle.id}
        campaign={editing.campaign}
        initial={editing.angle}
        isNew={editing.isNew}
        copiedFrom={editing.copiedFrom}
        clips={angleClips[angleKey(editing.campaign.id, editing.angle.id)]}
        clipList={clipList}
        onAddClip={isReaction(editing.campaign) ? undefined : newClip}
        onSave={(edited, clips) => saveAngleEdit(editing.campaign, edited, isReaction(editing.campaign) ? undefined : clips)}
        onCancel={() => setEditing(null)}
        onDelete={
          !editing.isNew && !editing.angle.general && editing.campaign.angles.length > 1
            ? () => void removeAngle(editing.campaign, editing.angle.id)
            : undefined
        }
      />
    ) : cutsJob && cutting ? (
      <CutsEditor
        key={cutsJob.id}
        name={cutsJob.name}
        file={reviewFile?.id === cutsJob.id ? reviewFile.file : null}
        missing={reviewFile?.id === cutsJob.id && reviewFile.missing}
        duration={cutsJob.day!.plan!.duration}
        initial={planFor(cutsJob)!.keep}
        checks={cutsJob.day!.plan!.checks}
        peaks={cutsJob.day!.plan!.peaks}
        noiseNote={cutsJob.day!.plan!.noiseNote}
        words={captionWords(cutsJob.day!.plan!.spoken ?? cutsJob.day!.plan!.words, [{ start: 0, end: cutsJob.day!.plan!.duration }])}
        overlays={cutsJob.day!.overlays}
        bank={bankRef.current}
        defaults={angleBankDefaults(cutsJob)}
        loadImage={(m) => (m.source.kind === 'phone' ? loadOverlayFile(cutsJob.id, m.id, m.source.type) : Promise.resolve(null))}
        onDone={(keep, overlays, files) => {
          keepCuts(cutsJob.id, keep, overlays, files)
          setCutting(null)
        }}
        onCancel={() => setCutting(null)}
      />
    ) : askingHook ? (
      <HookQuestion count={askingHook.length} onChoose={(on) => answerHook(askingHook, on)} onCancel={() => setAskingHook(null)} />
    ) : reviewJob && reviewing && review ? (
      <CaptionReview
        key={reviewJob.id}
        bare={bareCaptions}
        name={reviewJob.name}
        file={reviewFile?.id === reviewJob.id ? reviewFile.file : null}
        missing={reviewFile?.id === reviewJob.id && reviewFile.missing}
        initial={review.shown.map((i) => review.all[i])}
        approveLabel={reviewing.length > 1 ? 'Approve & next' : 'Approve'}
        onChange={(words) => {
          const all = review.merge(words)
          setJobs((js) => js.map((j) => (j.id === reviewJob.id && j.day ? { ...j, day: { ...j.day, captions: all } } : j)))
        }}
        onApprove={(words) => {
          keepCaptions(reviewJob.id, review.merge(words), 'with')
          nextReview()
        }}
        onSkip={(words) => {
          keepCaptions(reviewJob.id, review.merge(words), 'without')
          nextReview()
        }}
        onClose={(words) => {
          keepCaptions(reviewJob.id, review.merge(words), false)
          setReviewing(null)
        }}
        onCuts={(words) => {
          keepCaptions(reviewJob.id, review.merge(words), false)
          setCutting({ id: reviewJob.id })
        }}
        clips={clipsField(reviewJob, true)}
        vocabulary={vocabularyFor(reviewJob)}
        riskSpans={(reviewJob.day?.plan?.checks ?? []).filter((c) => c.kind !== 'noise').map((c) => ({ start: c.start, end: c.end }))}
        onRecheck={posting ? (phrases) => recheckCaptions(phrases, vocabularyFor(reviewJob)) : undefined}
        position={reviewJob.day?.captionPosition ?? defaultCaptionPosition()}
        onPosition={(position) => setCaptionPosition(reviewJob.id, position)}
      />
    ) : showPosts && posting ? (
      <PostsView
        campaigns={campaigns ?? []}
        editable={editable}
        onEditAgain={(key) => void editAgain(key)}
        onBack={() => {
          setShowPosts(false)
          if (window.location.hash === '#posts') history.replaceState(null, '', window.location.pathname)
        }}
      />
    ) : showSignIn ? (
      <SignIn
        onSignedIn={(next) => {
          setSession(next)
          setShowSignIn(false)
          runSync()
        }}
        onCancel={() => setShowSignIn(false)}
      />
    ) : campaigns === null ? null : tab === 'campaigns' ? (
      <CampaignsView
        campaigns={campaigns}
        openId={openCampaignId}
        onOpen={setOpenCampaignId}
        onNewCampaign={startNewCampaign}
        onEditCampaign={(c) => setEditing({ kind: 'campaign', campaign: c, isNew: false })}
        onEditAngle={(c, a) => setEditing({ kind: 'angle', campaign: c, angle: a, isNew: false })}
        onNewAngle={(c) => newAngle(c, c.angles.find((a) => a.id === angleId) ?? c.angles[0])}
        onDeleteCampaign={(c) => {
          void removeCampaign(c.id)
          setOpenCampaignId(null)
        }}
        onPosting={(c) => setEditing({ kind: 'posting', campaign: c })}
        postingLine={postingLine}
        shared={session !== null}
      />
    ) : tab === 'pictures' ? (
      <BankView bank={bank} onChange={setBank} />
    ) : tab === 'batch' ? (
      <BatchView
        campaigns={campaigns}
        posting={posting}
        jobs={batchJobs}
        onMake={addBatch}
        onRetry={startHeld}
        onRemove={removeJob}
      />
    ) : tab === 'settings' ? (
      <SettingsView
        session={session}
        syncState={syncState}
        preset={preset}
        cleanSpeech={cleanSpeech}
        onSignIn={() => setShowSignIn(true)}
        onSignOut={() => {
          if (!window.confirm('Sign out? Your setups stay on this phone; they just stop being shared until you sign in again.')) return
          signOut()
          setSession(null)
          setSyncState({ kind: 'signed-out' })
        }}
        onPreset={setPreset}
        onCleanSpeech={setCleanSpeech}
        captions={captionsOn}
        onCaptions={setCaptionsOn}
        bareCaptions={bareCaptions}
        onBareCaptions={setBareCaptions}
        voice={voiceOn}
        onVoice={setVoiceOn}
        posting={posting}
        push={push}
        onSetUpPosting={() => setSettingUpPosting(true)}
        onSendHere={(on) => {
          setSendHere(on)
          setPosting(postingHere())
        }}
        onPush={() => {
          const key = posting?.profile.vapidPublic
          if (!key) return
          void turnOnPush(key)
            .then(setPush)
            .catch((error: unknown) => setNotice(`Notifications could not be turned on (${error instanceof Error ? error.message : String(error)}).`))
        }}
        onDisconnectPosting={() => {
          disconnectPosting()
          setPosting(null)
        }}
        onLimitsChanged={() => setPosting(postingHere())}
      />
    ) : (
      videos
    )

  const inFlow =
    editing !== null ||
    showSignIn ||
    settingUpPosting ||
    (showPosts && posting !== null) ||
    askingHook !== null || Boolean(cutsJob && cutting) || Boolean(reviewJob && reviewing)

  return (
    <>
      {inFlow ? null : <ModeNav current="campaign" workToLose={workToLose} />}
      <main className={inFlow ? 'flow' : 'tabbed'}>
        <UpdateBanner safeToReload={jobs.every((j) => j.status === 'held' || j.status === 'failed')} />
        {screen}
      </main>
      {inFlow ? null : <TabBar tab={tab} onTab={setTab} />}
    </>
  )
}
