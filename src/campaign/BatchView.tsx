// The Batch tab: for one campaign, a bank of reactions (they go first, with
// the headline), product showcases, headlines and music. He picks how many
// a day and taps Start once; the batch keeps going (batchRun.ts) - the next
// week made now, the days after whenever the app is open - until every
// different video is made. The videos are mixed from the bank (batch.ts),
// made one after another on this phone or on the engine, and sent up - each
// for one of the campaign's posting times - to wait for his approval.

import { TrackName, TrackPlayer } from './TrackPlayer'
import { useEffect, useRef, useState } from 'react'

import { VideoPicker } from '../VideoPicker'
import { pickArrived, pickSaved } from '../pickWatch'
import {
  addDays,
  dayLabel,
  emptyBank,
  DEFAULT_FORMULA,
  formulaLine,
  headlinesFrom,
  logoName,
  madeWith,
  MAX_COMBOS,
  ONLY_HOOK_ELSE,
  rememberUsed,
  stepTitle,
  BATCH_LOOKS,
  looksOf,
  type BatchLook,
  type LookShare,
  todayHere,
  usesSteps,
  type BankFile,
  type BatchBank,
  type BatchFormula,
  type BatchStep,
} from './batch'
import { StepOrder } from './StepOrder'
import { ClipViewer } from './ClipViewer'
import { describeClip } from './clipCheck'
import { report as reportProblem } from '../report'
import { filmingOf } from './filming'
import { fingerprint, skippedNotice } from './fingerprint'
import { formatTime, labelOf, type Job } from './jobs'
import type { Angle, Campaign } from './look'
import { copySong, useMusicBank } from './musicBank'
import {
  accountLabel,
  batchTimesOn,
  lastPosts,
  listPosts,
  ownDayTimes,
  placeFor,
  timeLabel,
  windowLabel,
  windowOf,
  type LocalPosting,
  type ServerPost,
} from './posting'
import { deleteBankFile, loadBankFile, loadBatchBank, saveBankFile, saveBatchBank } from './store'
import {
  AHEAD_DAYS,
  dayVideos,
  daysToMake,
  growthSummary,
  perDayOn,
  withGrowth,
  withPerDay,
  leftToMake,
  missingFor,
  oneAtATime,
  overfull,
  runSlots,
  settled,
  startOver,
  takenBy,
  topUp,
  trimDown,
  variationParts,
  type BatchVideo,
} from './batchRun'
import { FormulaPreview } from './FormulaPreview'
import { CORNER_SIZES, DEFAULT_CORNER } from './greenScreenRender'
import {
  carryOnEngineJob,
  engineJob,
  engineUrl,
  stopEngineJob,
  type EngineJob,
} from './engine'
import { serverConnected } from './serverFlag'
import { bankFiles, lastServerStatus, linkProblem, sendingLine, serverCommand, serverMaking, SERVER_LINK_EVENT, type LinkEvent } from './serverLink'

const LAST_KEY = 'batch.campaign'
/** A track this big is any song there is. */
const MAX_SONG_MB = 30

export type { BatchVideo } from './batchRun'

/** Calls `run` a moment after `due` is true for a new `signal` - so tapping
 *  + five times makes one top-up, not five. A component of its own so its
 *  hook can sit below the Batch tab's early returns. */
function WhenDue({ due, signal, run }: { due: boolean; signal: string; run: () => void }) {
  const runRef = useRef(run)
  runRef.current = run
  useEffect(() => {
    if (!due) return
    const timer = setTimeout(() => runRef.current(), 1200)
    return () => clearTimeout(timer)
  }, [due, signal])
  return null
}

type Kind = 'reactions' | 'products' | 'music'
/** Where new clips go: one of the bank's lists, or a step of the product. */
type Target = Kind | { step: string }

const LEFT_KEY = 'batch.formulaLeft'

/** The left logo he last picked, for a campaign whose batch has none yet. */
function rememberedLeft(): BankFile | null {
  try {
    const raw = localStorage.getItem(LEFT_KEY)
    return raw ? (JSON.parse(raw) as BankFile) : null
  } catch {
    return null
  }
}

function rememberLeft(file: BankFile): void {
  try {
    localStorage.setItem(LEFT_KEY, JSON.stringify(file))
  } catch {
    /* only a convenience */
  }
}

function remembered(): string | null {
  try {
    return localStorage.getItem(LAST_KEY)
  } catch {
    return null
  }
}

function remember(id: string): void {
  try {
    localStorage.setItem(LAST_KEY, id)
  } catch {
    // Just won't be picked first next time.
  }
}

/** Reaction files already reported (clipCheck), by fingerprint - each again
 *  once since the report says where a video starts it. */
const CHECKED_KEY = 'batch.reactionsChecked2'

function readList(key: string): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? '[]') as unknown
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function writeList(key: string, list: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(list))
  } catch {
    // Reported again next time: harmless.
  }
}

const mb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1e6))} MB`

/** The most "more each day" there is. */
const MAX_GROWTH = 5

/** "2 min ago", "at 14:05": when the server last said something. */
function timeAgo(iso: string, now = Date.now()): string {
  const minutes = Math.round((now - Date.parse(iso)) / 60_000)
  if (!Number.isFinite(minutes)) return 'a while ago'
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  return `at ${new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
}

export function BatchView({
  campaigns,
  posting,
  jobs,
  onMake,
  onRetry,
  onRemove,
}: {
  campaigns: Campaign[]
  posting: LocalPosting | null
  /** The batch videos still on this phone: being made, or failed. */
  jobs: Job[]
  /** Makes the videos; `retire` is footage to let go of once they are made. */
  onMake: (campaign: Campaign, angle: Angle, videos: BatchVideo[], retire?: string[]) => void
  onRetry: (id: string) => void
  onRemove: (id: string) => void
}) {
  const profile = posting?.profile ?? null
  const choices = profile ? campaigns.filter((c) => placeFor(profile, c.id).accounts.length > 0) : []
  const [campaignId, setCampaignId] = useState(() => choices.find((c) => c.id === remembered())?.id ?? choices[0]?.id ?? '')
  const campaign = choices.find((c) => c.id === campaignId) ?? null
  const [bank, setBank] = useState<BatchBank | null>(null)
  const [headlineText, setHeadlineText] = useState('')
  const [saving, setSaving] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  /** Clips just turned away as already in videos made, for Add anyway. */
  const [reuse, setReuse] = useState<{ target: Target; files: File[] } | null>(null)
  const songs = useMusicBank()
  /** The campaign's posts as the server has them, for the times a day
   *  topped up keeps clear of; the last copy seen until they come. */
  const [posts, setPosts] = useState<ServerPost[]>(() => lastPosts())
  // The clip being watched full screen, and how to take it out from there.
  const [watching, setWatching] = useState<{ file: BankFile; note: string; out: () => void } | null>(null)
  useEffect(() => {
    if (!posting) return
    let alive = true
    void listPosts()
      .then((list) => {
        if (!alive) return
        setPosts(list)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [posting, campaignId])
  /** Fingerprints being kept right now, so two picks that overlap cannot both
   *  keep the same recording. */
  const adding = useRef(new Set<string>())
  const bankRef = useRef(bank)
  bankRef.current = bank
  /** A top-up of this campaign's batch is being worked out or handed over. */
  const [topping, setTopping] = useState(false)
  /** What he is typing as videos a day, until it is a number. */
  const [perDayDraft, setPerDayDraft] = useState<string | null>(null)
  /** The Set order sheet is open. */
  const [ordering, setOrdering] = useState(false)
  /** The batch the engine is making for this campaign, as it last said. */
  const [engineState, setEngineState] = useState<EngineJob | null>(null)
  useEffect(() => {
    const id = bank?.engineJob
    setEngineState(null)
    if (!id || !engineUrl()) return
    let alive = true
    let going = true
    const look = () => {
      if (!going) return
      void engineJob(id)
        .then((job) => {
          if (!alive) return
          setEngineState(job)
          going = job.status === 'waiting' || job.status === 'making'
        })
        .catch(() => {})
    }
    look()
    const timer = window.setInterval(look, 15_000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [bank?.engineJob])

  useEffect(() => {
    if (!campaign) return
    let cancelled = false
    setBank(null)
    // After the app's own top-up of this campaign, if one is running, so the
    // bank shown is the one it saved.
    void settled(campaign.id)
      .then(() => loadBatchBank(campaign.id))
      .then((stored) => {
        if (cancelled) return
        const loaded = stored ?? emptyBank(campaign.id, campaign.angles[0].id)
        setBank(loaded)
        setHeadlineText(loaded.headlines.join('\n'))
      })
    return () => {
      cancelled = true
    }
  }, [campaign?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // The Cutter server (serverLink.ts): clips going up, and its bank read
  // back - what it has made shows here as it happens.
  const [, setLinkTick] = useState(0)
  useEffect(() => {
    const onLink = (event: Event) => {
      const { campaignId: id, changed } = (event as CustomEvent<LinkEvent>).detail
      setLinkTick((n) => n + 1)
      if (!changed || id !== campaign?.id) return
      void loadBatchBank(id).then((stored) => {
        if (!stored || stored.campaignId !== bankRef.current?.campaignId) return
        setBank(stored)
        bankRef.current = stored
      })
    }
    window.addEventListener(SERVER_LINK_EVENT, onLink)
    return () => window.removeEventListener(SERVER_LINK_EVENT, onLink)
  }, [campaign?.id])

  // What each reaction file is made of, reported once per file (clipCheck):
  // some reactions made every video from them laggy and others never, and
  // this is how to tell those files apart without asking him anything.
  const reactionIds = bank?.reactions.map((f) => f.id).join(',') ?? ''
  useEffect(() => {
    const reactions = bank?.reactions ?? []
    if (reactions.length === 0) return
    let stopped = false
    const timer = setTimeout(() => {
      void (async () => {
        const seen = new Set(readList(CHECKED_KEY))
        for (const file of reactions) {
          if (stopped) return
          const key = file.fp ?? `${file.name}|${file.size}`
          if (seen.has(key)) continue
          try {
            const blob = await loadBankFile(file)
            if (!blob || stopped) continue
            const { made, rejected } = madeWith(posts, campaign?.id ?? '', file.name, true)
            const line = await describeClip(file.name, blob)
            reportProblem({ kind: 'check', phase: 'reaction', message: `${line}${made ? ` · ${made} made, ${rejected} rejected` : ''}` })
            seen.add(key)
            writeList(CHECKED_KEY, [...seen].slice(-300))
          } catch {
            // Not readable here: the render says so when it gets to it.
          }
        }
      })()
    }, 4000)
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [reactionIds, posts.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const keep = (next: BatchBank) => {
    setBank(next)
    bankRef.current = next
    void saveBatchBank(next).catch(() => setProblem("The bank couldn't be saved on this phone. Free some space and try again."))
  }

  if (!profile) {
    return (
      <section className="screen batch">
        <div className="screen-head">
          <h1>Batch</h1>
        </div>
        <p className="empty">Batches post through Postiz. Set posting up in Settings first.</p>
      </section>
    )
  }
  if (!campaign) {
    return (
      <section className="screen batch">
        <div className="screen-head">
          <h1>Batch</h1>
        </div>
        <p className="empty">No campaign posts anywhere yet. Pick its accounts first: Campaigns, open the campaign, then Posting.</p>
      </section>
    )
  }

  const place = placeFor(profile, campaign.id)
  const accounts = place.accounts.map((id) => profile.accounts.find((a) => a.id === id)).filter((a) => a !== undefined)
  // As many times a day as he picked: random ones from the campaign's
  // window, or his own (with random extras when he wants more than he has).
  const today = todayHere()
  // Today's number: his, or - while it grows each day - where it has got to.
  const perDay = bank ? perDayOn(bank, today) : 1
  const growth = bank?.growth ?? 0
  const running = Boolean(bank?.running)
  const takenOn = takenBy(posts, jobs, campaign.id)
  const times = batchTimesOn(place, campaign.id, today, perDay)
  const random = ownDayTimes(place).length === 0
  const angle = campaign.angles.find((a) => a.id === bank?.angleId) ?? campaign.angles[0]

  /** Files into a bank. `again`: he tapped Add anyway - clips already in
   *  videos made before are taken in again, each as a clip of its own
   *  (batch.usedKey). */
  const add = async (target: Target, files: File[], again = false) => {
    const kind: Kind = typeof target === 'string' ? target : 'products'
    const stepId = typeof target === 'string' ? null : target.step
    const listOf = (b: BatchBank | null): BankFile[] => (stepId ? (b?.steps?.find((s) => s.id === stepId)?.files ?? []) : (b?.[kind] ?? []))
    if (kind !== 'music') {
      const problemPicking = pickArrived(files)
      if (problemPicking) {
        setProblem(problemPicking)
        return
      }
    }
    setProblem(null)
    setNotice(null)
    setReuse(null)
    const added: BankFile[] = []
    const skipped: string[] = []
    // Clips already in videos made before, since taken out (usedClips) - kept
    // for Add anyway.
    const usedBefore: File[] = []
    const mine = new Set<string>()
    try {
      for (const [i, file] of files.entries()) {
        if (kind === 'music' && file.size > MAX_SONG_MB * 1e6) throw new Error(`${file.name} is over ${MAX_SONG_MB} MB - pick a shorter one or an MP3.`)
        // The same recording is never kept twice: by what is in it, and for
        // files kept before fingerprints existed, by name and size.
        const fp = await fingerprint(file)
        const inBank = listOf(bankRef.current)
        const alreadyKept =
          adding.current.has(fp) ||
          inBank.some((f) => (f.fp ? f.fp === fp : f.name === file.name && f.size === file.size)) ||
          added.some((f) => f.fp === fp)
        if (alreadyKept) {
          skipped.push(file.name)
          continue
        }
        const used = new Set(bankRef.current?.usedClips ?? [])
        if (kind !== 'music' && !again && (used.has(fp) || used.has(`${file.name}|${file.size}`))) {
          usedBefore.push(file)
          continue
        }
        adding.current.add(fp)
        mine.add(fp)
        setSaving(`Keeping ${files.length > 1 ? `${i + 1} of ${files.length}` : file.name} on this phone…`)
        const id = crypto.randomUUID()
        await saveBankFile(id, file)
        const seconds = kind === 'music' ? undefined : (await filmingOf(file)).seconds
        added.push({
          id,
          name: file.name,
          type: file.type || (kind === 'music' ? 'audio/mpeg' : 'video/mp4'),
          size: file.size,
          fp,
          ...(seconds ? { seconds } : {}),
          ...(again ? { again: Date.now() + i } : {}),
        })
      }
    } catch (error) {
      setProblem(`Not all of them could be kept: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setSaving(null)
      const reused =
        usedBefore.length === 0
          ? null
          : `${usedBefore.length === 1 ? usedBefore[0].name : `${usedBefore.length} of them`} ${usedBefore.length === 1 ? 'was' : 'were'} already in videos you made, so ${usedBefore.length === 1 ? "it wasn't" : "they weren't"} added again - film new ones, or tap Add anyway to use ${usedBefore.length === 1 ? 'it' : 'them'} again.`
      setNotice([skippedNotice(skipped, stepId ? 'in this step' : `in the ${kind === 'music' ? 'music' : kind} bank`), reused].filter(Boolean).join(' ') || null)
      setReuse(usedBefore.length > 0 ? { target, files: usedBefore } : null)
      if (kind !== 'music') pickSaved()
      const current = bankRef.current
      if (current && added.length > 0) {
        if (stepId) keep({ ...current, steps: (current.steps ?? []).map((s) => (s.id === stepId ? { ...s, files: [...s.files, ...added] } : s)) })
        else keep({ ...current, [kind]: [...current[kind], ...added] })
      }
      for (const fp of mine) adding.current.delete(fp)
    }
  }

  /** A logo for the formula hook, kept in the bank like the clips. The left
   *  one is remembered for other campaigns' batches too - it is usually
   *  Claude everywhere. */
  const addLogo = async (side: 'left' | 'right', file: File) => {
    const current = bankRef.current
    if (!current) return
    if (!file.type.startsWith('image/')) {
      setProblem(`${file.name} isn't a picture. Pick a PNG or JPG.`)
      return
    }
    setProblem(null)
    setSaving(`Keeping ${file.name} on this phone…`)
    try {
      const id = crypto.randomUUID()
      await saveBankFile(id, file)
      const kept: BankFile = { id, name: file.name, type: file.type, size: file.size }
      const latest = bankRef.current ?? current
      const before = latest.formula ?? DEFAULT_FORMULA
      keep({ ...latest, formula: { ...before, [side]: kept } })
      if (side === 'left') rememberLeft(kept)
    } catch (error) {
      setProblem(`${file.name} couldn't be kept: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setSaving(null)
    }
  }

  /** A song from the music bank into this campaign's Batch music - a copy,
   *  so taking it out here leaves the bank's own. */
  const addFromBank = async (song: BankFile) => {
    setProblem(null)
    setSaving(`Adding ${song.name}…`)
    try {
      const copy = await copySong(song)
      const current = bankRef.current
      if (current) keep({ ...current, music: [...current.music, copy] })
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(null)
    }
  }

  // A clip taken out after videos were made from it is remembered, so it
  // can't come back in and make the same videos again (rememberUsed).
  const takeOut = (kind: Kind, file: BankFile) => {
    if (!bank || !window.confirm(`Take ${file.name} out of the bank?`)) return
    void deleteBankFile(file.id).catch(() => {})
    const next = { ...bank, [kind]: bank[kind].filter((f) => f.id !== file.id) }
    keep(kind === 'music' ? next : rememberUsed(next, [file]))
  }
  const takeOutOfStep = (stepId: string, file: BankFile) => {
    if (!bank || !window.confirm(`Take ${file.name} out of the bank?`)) return
    void deleteBankFile(file.id).catch(() => {})
    keep(rememberUsed({ ...bank, steps: (bank.steps ?? []).map((s) => (s.id === stepId ? { ...s, files: s.files.filter((f) => f.id !== file.id) } : s)) }, [file]))
  }
  /** "3 videos, 3 rejected": what the videos made with a clip came to. */
  const madeNote = (file: BankFile, first: boolean) => {
    const { made, rejected } = madeWith(posts, campaign.id, file.name, first)
    return made === 0 ? '' : `${made} video${made === 1 ? '' : 's'}${rejected > 0 ? `, ${rejected} rejected` : ''}`
  }
  /** The order saved: a step taken out goes with its clips. */
  const saveOrder = (steps: BatchStep[]) => {
    if (!bank) return
    const kept = new Set(steps.map((s) => s.id))
    const gone = (bank.steps ?? []).filter((s) => !kept.has(s.id)).flatMap((s) => s.files)
    for (const f of gone) void deleteBankFile(f.id).catch(() => {})
    keep(rememberUsed({ ...bank, steps }, gone))
  }

  // The days the batch is still missing, up to a week ahead.
  const due = bank ? runSlots({ bank, place, campaignId: campaign.id, taken: takenOn }) : []
  const green = bank?.layout === 'greenscreen'
  const onEngine = bank?.layout === 'engine'
  // Made on the Cutter server (serverLink.ts), or about to be: nothing is made here.
  const onServer = !onEngine && (bank?.where === 'server' || serverConnected())
  const sending = sendingLine(campaign.id)
  const linkTrouble = onServer ? linkProblem(campaign.id) : null
  const serverNow = onServer ? serverMaking(campaign.id) : null
  const serverSeen = onServer ? lastServerStatus()?.page?.at : undefined
  const serverQueued = (serverNow?.queued ?? 0) + (serverNow?.now ? 1 : 0)
  const corner = bank?.corner ?? DEFAULT_CORNER
  // The hooks picked, with their shares - none picked: headlines in the
  // angle's look.
  const shownLooks: LookShare[] = !bank ? [] : looksOf(bank).length > 0 ? looksOf(bank) : [{ look: angle.headline.style, parts: 1 }]
  const formulaOn = !green && !onEngine && shownLooks.some((l) => l.look === 'formula')
  const headlinesOn = green || onEngine || shownLooks.some((l) => l.look !== 'formula')
  const saveLooks = (looks: LookShare[]) => {
    if (!bank) return
    const formulaNow = looks.some((l) => l.look === 'formula')
    keep({
      ...bank,
      looks,
      hook: undefined,
      headlineStyles: undefined,
      headlineStyle: undefined,
      ...(formulaNow && !bank.formula ? { formula: { ...DEFAULT_FORMULA, left: rememberedLeft() } } : {}),
    })
  }
  const formula: BatchFormula = bank?.formula ?? DEFAULT_FORMULA
  // The engine makes many videos from each take, so it never runs out.
  const { total: different, left } = bank && !onEngine ? leftToMake(bank) : { total: Infinity, left: Infinity }
  const stepped = bank ? usesSteps(bank) : false
  const productCount = !bank ? 0 : stepped ? Math.min(...bank.steps!.map((s) => s.files.length)) : bank.products.length
  const spentShown = Boolean(bank?.spent) && (bank!.reactions.length === 0 || productCount === 0)
  const missing = bank ? missingFor(bank) : []
  const inProgress = jobs.filter((j) => j.status !== 'failed' && j.status !== 'held')
  const makingHere = inProgress.filter((j) => j.campaignId === campaign.id)
  const engineBusy = onEngine && (engineState?.status === 'waiting' || engineState?.status === 'making')
  const busyMaking = topping || makingHere.length > 0 || engineBusy
  const madeHereTotal = [...new Map(jobs.filter((j) => j.campaignId === campaign.id).map((j) => [j.batch!.id, j.batch!.size])).values()].reduce(
    (a, b) => a + b,
    0,
  )
  const failed = jobs.filter((j) => j.status === 'failed' || j.status === 'held')
  const total = [...new Map(jobs.map((j) => [j.batch!.id, j.batch!.size])).values()].reduce((a, b) => a + b, 0)
  const working = jobs.find((j) => j.status === 'working')
  const canStart = Boolean(bank) && !running && perDay > 0 && missing.length === 0 && saving === null && !topping

  /** Makes the days the batch is missing (batchRun.topUp) - on this phone or
   *  on the engine - unless a top-up of it is already going. */
  const runTopUp = (from: BatchBank) => {
    if (!profile) return
    setTopping(true)
    void oneAtATime(campaign.id, () =>
      topUp({
        bank: from,
        campaign,
        place,
        profileId: profile.id,
        taken: takenOn,
        save: async (next) => {
          setBank(next)
          bankRef.current = next
          await saveBatchBank(next)
        },
        make: (videos, retire) => onMake(campaign, angle, videos, retire),
        say: setSaving,
        latest: () => bankRef.current ?? from,
      }),
    )
      .catch(() => setProblem("The bank couldn't be saved on this phone. Free some space and try again."))
      .finally(() => setTopping(false))
  }

  /** One tap: the batch starts and keeps going. */
  const start = () => {
    const current = bankRef.current
    if (!current || current.running || !canStart) return
    remember(campaign.id)
    setProblem(null)
    const next = { ...current, running: true, runProblem: undefined, spent: undefined, startedAt: new Date().toISOString() }
    keep(next)
    runTopUp(next)
  }

  /** Start anyway: the same, but the mixes already made are forgotten for
   *  this batch - the same clips make the same videos again. Start on its
   *  own still never repeats one. */
  const startAnyway = () => {
    const current = bankRef.current
    if (!current || current.running || !canStart) return
    remember(campaign.id)
    setProblem(null)
    const at = new Date().toISOString()
    const next = { ...current, running: true, runProblem: undefined, spent: undefined, made: [], startedAt: at, anyway: at }
    keep(next)
    runTopUp(next)
  }

  const stop = () => {
    if (bank) keep({ ...bank, running: false })
  }

  /** He lowered the number: the extra videos come back out of the days
   *  ahead (batchRun.trimPlan) - jobs not started yet are dropped, posts not
   *  out yet are stopped, the same way Posts stops them. */
  const runTrim = (from: BatchBank) => {
    setTopping(true)
    setSaving('Taking the extra videos out of the days ahead…')
    void oneAtATime(campaign.id, async () => {
      const done = await trimDown({
        bank: from,
        campaignId: campaign.id,
        jobs,
        removeJob: onRemove,
        save: async (next) => {
          setBank(next)
          bankRef.current = next
          await saveBatchBank(next)
        },
        latest: () => bankRef.current ?? from,
      })
      setPosts(done.posts)
      if (done.failed > 0) setProblem(`${done.failed} couldn't be taken out: ${done.reason}`)
      void listPosts().then(setPosts).catch(() => {})
    })
      .catch((error: unknown) => setProblem(error instanceof Error ? error.message : String(error)))
      .finally(() => {
        setSaving(null)
        setTopping(false)
      })
  }

  // The batch's videos not out yet, that Start over would take out.
  const outAhead = bank ? dayVideos(posts, jobs, campaign.id).filter((v) => v.removable).length : 0
  // The batch's videos (made, or being made) on the days it fills ahead.
  const aheadEnd = addDays(todayHere(), AHEAD_DAYS)
  const aheadCount = bank ? dayVideos(posts, jobs, campaign.id).filter((v) => v.date < aheadEnd).length : 0
  /** Start over: every video of the batch not out yet comes out and can be
   *  made again with what he has set now (batchRun.startOver); then Start. */
  const runStartOver = () => {
    if (!bank) return
    const confirmText = `Take out the ${outAhead} video${outAhead === 1 ? '' : 's'} of this batch that haven't gone out yet, to make them again with your latest settings? Your clips, headlines and songs stay - tap Start after to make them.`
    if (!window.confirm(confirmText)) return
    if (onServer) {
      // The server has the batch's videos still to be made: it takes them out.
      keep({ ...bank, running: false })
      setProblem(null)
      void serverCommand(campaign.id, 'start-over')
        .then(() => setNotice('The server is taking them out. Tap Start to make them again.'))
        .catch((error: unknown) => setProblem(error instanceof Error ? error.message : String(error)))
      return
    }
    setTopping(true)
    setProblem(null)
    setSaving('Taking the batch\'s videos out…')
    void oneAtATime(campaign.id, async () => {
      const done = await startOver({
        bank,
        campaignId: campaign.id,
        jobs,
        removeJob: onRemove,
        save: async (next) => {
          setBank(next)
          bankRef.current = next
          await saveBatchBank(next)
        },
        latest: () => bankRef.current ?? bank,
      })
      setPosts(done.posts)
      setNotice(`Took out ${done.taken} video${done.taken === 1 ? '' : 's'}. Tap Start to make them again.`)
      if (done.failed > 0) setProblem(`${done.failed} couldn't be taken out: ${done.reason}`)
      void listPosts().then(setPosts).catch(() => {})
    })
      .catch((error: unknown) => setProblem(error instanceof Error ? error.message : String(error)))
      .finally(() => {
        setSaving(null)
        setTopping(false)
      })
  }

  // While the tab is open, a running batch keeps up with the number on its
  // own (WhenDue): days over it lose the extra first, then a day gone by or
  // a higher number is made.
  // On the server, the server does both.
  const over = running && bank && !onServer ? overfull(bank) : []
  const trimNow = over.length > 0 && saving === null && !topping
  const dueNow = running && !onServer && over.length === 0 && due.length > 0 && missing.length === 0 && saving === null && !topping
  const setPerDay = (n: number) => {
    if (bank && Number.isFinite(n)) keep(withPerDay(bank, Math.max(0, Math.round(n)), today))
  }
  const setGrowth = (n: number) => {
    if (bank && Number.isFinite(n)) keep(withGrowth(bank, Math.min(MAX_GROWTH, Math.max(0, Math.round(n))), today))
  }

  const bankSize = bank
    ? [...bank.reactions, ...bank.products, ...bank.music, ...(bank.steps ?? []).flatMap((s) => s.files)].reduce((n, f) => n + f.size, 0)
    : 0

  /** One step of the product showcase: its clips, one of which - the moment
   *  something happens in it - goes in each video. */
  const stepList = (step: BatchStep, index: number) => (
    <div className="group" key={step.id}>
      <div className="bank-head">
        <span className="group-title">
          {index + 1}. {step.name} <span className="bank-count">{step.files.length}</span>
        </span>
        <VideoPicker className="btn small" label={`Add clips for ${step.name}`} onFiles={(files) => void add({ step: step.id }, files)}>
          + Add
        </VideoPicker>
      </div>
      <p className="hint bank-hint">
        One of these in every video: the moment something happens in it, or all of it when it&rsquo;s short
        {stepTitle(step.name) ? `, with "${stepTitle(step.name)}" written over it` : ''}.
      </p>
      {step.files.length > 0 ? (
        <ul className="bank-list">
          {step.files.map((file) => (
            <li key={file.id} className="bank-item">
              <button type="button" className="bank-name watch" onClick={() => setWatching({ file, note: madeNote(file, false), out: () => takeOutOfStep(step.id, file) })}>
                {file.name}
              </button>
              <span className="hint">{[file.seconds ? formatTime(file.seconds) : '', mb(file.size)].filter(Boolean).join(' · ')}</span>
              <button type="button" className="btn small icon-btn" aria-label={`Take out ${file.name}`} onClick={() => takeOutOfStep(step.id, file)}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )

  const list = (kind: Kind, title: string, hint: string) => (
    <div className="group">
      <div className="bank-head">
        <span className="group-title">
          {title} <span className="bank-count">{bank?.[kind].length ?? 0}</span>
        </span>
        {kind === 'music' ? (
          <div className="btn small picker">
            + Add
            <input
              type="file"
              accept="audio/*,.mp3,.m4a,.wav,.aac"
              multiple
              aria-label={`Add ${title.toLowerCase()}`}
              disabled={saving !== null}
              onChange={(e) => {
                const picked = Array.from(e.target.files ?? [])
                e.target.value = ''
                if (picked.length > 0) void add('music', picked)
              }}
            />
          </div>
        ) : (
          <VideoPicker className="btn small" label={`Add ${title.toLowerCase()}`} onFiles={(files) => void add(kind, files)}>
            + Add
          </VideoPicker>
        )}
      </div>
      <p className="hint bank-hint">{hint}</p>
      {kind === 'music' && bank && songs.length > 0 ? (
        <label className="field">
          <span className="label">From the music bank</span>
          <select
            value=""
            disabled={saving !== null}
            aria-label="Add a song from the music bank"
            onChange={(e) => {
              const song = songs.find((x) => x.id === e.target.value)
              if (song) void addFromBank(song)
            }}
          >
            <option value="">Pick a song…</option>
            {songs.map((song) => (
              <option key={song.id} value={song.id} disabled={bank.music.some((m) => m.fp && m.fp === song.fp)}>
                {song.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {bank && bank[kind].length > 0 ? (
        <ul className="bank-list">
          {bank[kind].map((file) => (
            <li key={file.id} className="bank-item">
              {kind === 'music' && bank ? (
                <>
                  <TrackPlayer file={file} />
                  <TrackName
                    name={file.name}
                    onRename={(name) => keep({ ...bank, music: bank.music.map((m) => (m.id === file.id ? { ...m, name } : m)) })}
                  />
                </>
              ) : (
                <button
                  type="button"
                  className="bank-name watch"
                  onClick={() => setWatching({ file, note: madeNote(file, kind === 'reactions'), out: () => takeOut(kind, file) })}
                >
                  {file.name}
                </button>
              )}
              <span className="hint">{[file.seconds ? formatTime(file.seconds) : '', mb(file.size)].filter(Boolean).join(' · ')}</span>
              {kind === 'reactions' && madeWith(posts, campaign.id, file.name, true).rejected > 0 ? (
                <span className="hint rejected">{madeNote(file, true)}</span>
              ) : null}
              <button type="button" className="btn small icon-btn" aria-label={`Take out ${file.name}`} onClick={() => takeOut(kind, file)}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )

  const makeLabel =
    makingHere.length > 0
      ? `Making ${Math.max(0, madeHereTotal - makingHere.length) + 1} of ${madeHereTotal}…`
      : topping
        ? 'Making…'
        : engineBusy
          ? 'The engine is making the next days'
          : running
            ? perDay === 0
              ? 'Paused · 0 a day'
              : `Running${onServer ? ' on the server' : ''} · ${perDay} ${growth > 0 ? `today, +${growth} a day` : 'a day'}`
            : `Start · ${perDay} ${growth > 0 ? `today, +${growth} a day` : 'a day'}`
  // How long the footage lasts at this many a day.
  const daysLeft = Number.isFinite(left) && perDay > 0 ? daysToMake(bank!, left, today) : Infinity
  // The videos the week ahead holds at his numbers - growing ones count each day's.
  const aim = bank ? Array.from({ length: AHEAD_DAYS }, (_, d) => perDayOn(bank, addDays(today, d))).reduce((a, b) => a + b, 0) : 0
  // While it grows: how it goes from here, and the first day the window is too small for it.
  const growthLine = bank && growth > 0 && perDay > 0 ? growthSummary(bank, today, (date, n) => batchTimesOn(place, campaign.id, date, n).length) : null

  return (
    <section className="screen batch">
      <div className="screen-head">
        <h1>Batch</h1>
      </div>

      <div className="chooser">
        <div className="chooser-row">
        <select
          aria-label="Campaign"
          value={campaign.id}
          onChange={(e) => {
            setCampaignId(e.target.value)
            remember(e.target.value)
            setProblem(null)
            setOrdering(false)
          }}
        >
          {choices.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {bank && (bank.layout ?? 'after') === 'after' ? (
          <button type="button" className="btn small" aria-expanded={ordering} onClick={() => setOrdering((o) => !o)}>
            {bank.steps?.length ? `Order · ${bank.steps.length} steps` : 'Set order'}
          </button>
        ) : null}
        </div>
        {campaign.angles.length > 1 && bank ? (
          <div className="seg chips" role="radiogroup" aria-label="Headline look">
            {campaign.angles.map((a) => (
              <button
                key={a.id}
                type="button"
                role="radio"
                aria-checked={a.id === angle.id}
                className={a.id === angle.id ? 'active' : ''}
                onClick={() => keep({ ...bank, angleId: a.id })}
              >
                {a.name}
              </button>
            ))}
          </div>
        ) : null}
        <p className="hint new-post-to">
          To {accounts.map(accountLabel).join(', ')}
          {random
            ? ` · ${windowLabel(windowOf(place))}`
            : times.length > 0
              ? ` · at ${times.map(timeLabel).join(', ')}`
              : ''}
        </p>
      </div>

      {bank && ordering ? (
        <StepOrder campaignName={campaign.name} steps={bank.steps ?? []} onSave={saveOrder} onClose={() => setOrdering(false)} />
      ) : null}

      {bank && spentShown && bank.spent ? (
        <div className="callout batch-spent">
          <div>
            <div className="label">Time to film new ones</div>
            <div className="hint">
              All {bank.spent.videos} different videos from your last reactions and product showcases are made - the last one posts{' '}
              {dayLabel(bank.spent.through)}. They've been cleared out. Add new reactions and product showcases to make more; your headlines and
              music are kept.
            </div>
          </div>
        </div>
      ) : null}

      {bank ? (
        <>
          <div className="group">
            <div className="group-title">Layout</div>
            <div className="seg full" role="radiogroup" aria-label="Layout">
              <button type="button" role="radio" aria-checked={!green} className={!green ? 'active' : ''} onClick={() => keep({ ...bank, layout: 'after' })}>
                Reaction, then video
              </button>
              <button type="button" role="radio" aria-checked={green} className={green ? 'active' : ''} onClick={() => keep({ ...bank, layout: 'greenscreen' })}>
                Green screen
              </button>
              {engineUrl() || onEngine ? (
                <button type="button" role="radio" aria-checked={onEngine} className={onEngine ? 'active' : ''} onClick={() => keep({ ...bank, layout: 'engine' })}>
                  On the engine
                </button>
              ) : null}
            </div>
            {onEngine ? (
              <p className="hint tip">
                Made on the server - close the app once it says the batch is handed over. Each take gives several hooks, every video
                a little different, never a near-copy. They wait in Posts: watch one, then Approve all.
              </p>
            ) : null}
          </div>
          {green ? (
            <>
              {list('reactions', 'Reactions', 'You, cut out of your background and put in the corner. Film them as long as the background videos.')}
              {list('products', 'Background videos', "The brief's videos. Each plays full screen with its own sound, and the video lasts as long as it does.")}
              <div className="group">
                <div className="group-title">Your corner</div>
                <div className="seg full" role="radiogroup" aria-label="Corner">
                  {(['left', 'right'] as const).map((side) => (
                    <button
                      key={side}
                      type="button"
                      role="radio"
                      aria-checked={corner.side === side}
                      className={corner.side === side ? 'active' : ''}
                      onClick={() => keep({ ...bank, corner: { ...corner, side } })}
                    >
                      Bottom {side}
                    </button>
                  ))}
                </div>
                <label className="slider">
                  <span>Size</span>
                  <input
                    type="range"
                    min={CORNER_SIZES.min}
                    max={CORNER_SIZES.max}
                    step={1}
                    value={corner.sizePct}
                    aria-label="How big you are in the corner"
                    onChange={(e) => keep({ ...bank, corner: { ...corner, sizePct: Number(e.target.value) } })}
                  />
                  <output>{corner.sizePct}%</output>
                </label>
              </div>
            </>
          ) : onEngine ? (
            <>
              {list('reactions', 'Hooks - your face', 'Takes of 10-12 s; the engine cuts several hooks out of each.')}
              {list('products', 'Product clips', 'Shown after the hook.')}
            </>
          ) : (
            <>
              {list('reactions', 'Reactions', 'They go first, with the headline over them - slowly zooming in.')}
              {stepped
                ? bank.steps!.map((step, i) => stepList(step, i))
                : list('products', 'Product showcases', 'Shown after the reaction. To show several in a set order, tap Set order at the top.')}
            </>
          )}
          {green || onEngine ? null : (
          <div className="group">
            <div className="group-title">Hook</div>
            <HookLooks looks={shownLooks} withFormula stepped={stepped} onChange={saveLooks} />
          </div>
          )}
          {formulaOn ? (
            <div className="group">
              <p className="hint bank-hint tip">
                Two logos with a plus between them over the reaction, then a different amount a day on each Claude + X video. No headline on those.
              </p>
              <div className="formula-logos">
                {(['left', 'right'] as const).map((side) => (
                  <label key={side} className="btn small formula-pick">
                    {formula[side] ? `${side === 'left' ? 'Left' : 'Right'}: ${formula[side]!.name}` : side === 'left' ? 'Left logo (e.g. Claude)' : 'Right logo (e.g. OpenArt)'}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      aria-label={side === 'left' ? 'Left logo' : 'Right logo'}
                      disabled={saving !== null}
                      onChange={(e) => {
                        const picked = e.target.files?.[0]
                        e.target.value = ''
                        if (picked) void addLogo(side, picked)
                      }}
                    />
                  </label>
                ))}
              </div>
              {(['left', 'right'] as const).map((side) => {
                const file = formula[side]
                const given = side === 'left' ? formula.leftName : formula.rightName
                // Asked only when the file's name doesn't say what it is.
                if (!file || (logoName(file) && !given)) return null
                return (
                  <label key={`${side}-${file.id}`} className="field">
                    <span className="label">{side === 'left' ? 'The left logo is' : 'The right logo is'}</span>
                    <input
                      type="text"
                      className="find"
                      placeholder={side === 'left' ? 'e.g. Claude' : 'e.g. Lovable'}
                      defaultValue={given ?? ''}
                      aria-label={side === 'left' ? 'Left logo name' : 'Right logo name'}
                      onBlur={(e) => {
                        const name = e.target.value.trim() || undefined
                        if (name !== given) keep({ ...bank, formula: { ...formula, [side === 'left' ? 'leftName' : 'rightName']: name } })
                      }}
                    />
                    <span className="hint">{`"${file.name}" doesn't say - the captions use this.`}</span>
                  </label>
                )
              })}
              <div className="field">
                <span className="label">Amount a day</span>
                <div className="formula-range">
                  ${' '}
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    step={50}
                    aria-label="Lowest amount"
                    value={formula.min}
                    onChange={(e) => keep({ ...bank, formula: { ...formula, min: Math.max(0, Number(e.target.value) || 0) } })}
                  />
                  {' '}to ${' '}
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    step={50}
                    aria-label="Highest amount"
                    value={formula.max}
                    onChange={(e) => keep({ ...bank, formula: { ...formula, max: Math.max(0, Number(e.target.value) || 0) } })}
                  />
                </div>
                <span className="hint">Each video gets its own - like {formulaLine(formula, 'a')}, {formulaLine(formula, 'b')}, {formulaLine(formula, 'c')}.</span>
              </div>
              <FormulaPreview left={formula.left} right={formula.right} line={formulaLine(formula, 'preview')} look={{ ...angle.headline, style: ONLY_HOOK_ELSE }} load={loadBankFile} />
            </div>
          ) : null}
          {headlinesOn ? (
          <div className="group">
            <div className="bank-head">
              <span className="group-title">
                Headlines <span className="bank-count">{bank.headlines.length}</span>
              </span>
            </div>
            <p className="hint bank-hint">
              {green
                ? 'Optional - none and the videos have no headline. One a line.'
                : onEngine
                  ? 'The words over the hook, one a line - Claude rewords them a little for each video.'
                  : 'One a line - paste them all in.'}
            </p>
            <textarea
              className="post-caption bank-headlines"
              rows={Math.min(8, Math.max(3, bank.headlines.length + 1))}
              value={headlineText}
              aria-label="Headlines, one a line"
              placeholder={'POV: you finally found it\nwait for it…'}
              onChange={(e) => setHeadlineText(e.target.value)}
              onBlur={() => {
                const headlines = headlinesFrom(headlineText)
                setHeadlineText(headlines.join('\n'))
                keep({ ...bank, headlines })
              }}
            />
            {green ? (
              <HookLooks
                looks={shownLooks.some((l) => l.look !== 'formula') ? shownLooks.filter((l) => l.look !== 'formula') : [{ look: angle.headline.style, parts: 1 }]}
                withFormula={false}
                stepped={false}
                onChange={saveLooks}
              />
            ) : null}
          </div>
          ) : null}
          {green
            ? null
            : onEngine
              ? list('music', 'Songs', 'Each video gets the song this campaign used least, starting on its chorus.')
              : list('music', 'Music', 'The only sound - the clips are muted. With one track every video uses it; with more, each gets one at random.')}
          {saving ? <p className="hint">{saving}</p> : null}
          {bankSize > 0 ? <p className="hint">The bank keeps {mb(bankSize)} on this phone.</p> : null}

          <div className="group">
            <div className="group-title">Posting</div>
            <div className="field">
              <span className="label">Videos a day</span>
              <div className="stepper">
                <button
                  type="button"
                  className="btn small icon-btn"
                  aria-label="Fewer a day"
                  disabled={perDay <= 0}
                  onClick={() => setPerDay(perDay - 1)}
                >
                  −
                </button>
                <input
                  type="number"
                  inputMode="numeric"
                  className="stepper-value"
                  aria-label="Videos a day"
                  min={0}
                  value={perDayDraft ?? String(perDay)}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => {
                    setPerDayDraft(e.target.value)
                    if (e.target.value.trim() !== '') setPerDay(Number(e.target.value))
                  }}
                  onBlur={() => setPerDayDraft(null)}
                />
                <button
                  type="button"
                  className="btn small icon-btn"
                  aria-label="More a day"
                  onClick={() => setPerDay(perDay + 1)}
                >
                  +
                </button>
              </div>
              {perDay === 0 ? (
                <span className="hint">Paused: nothing more goes out until you raise it. Your clips and what's left to make are kept.</span>
              ) : (
                <span className={`hint${times.length < perDay ? ' warn-text' : ''}`}>
                  {times.length < perDay
                    ? `The window only fits ${times.length} a day - widen it in the campaign's Posting. `
                    : ''}
                  {random
                    ? `At random times inside the window, different each day - today ${times.map(timeLabel).join(', ')}.`
                    : times.length > place.times.length
                      ? `At your times and random ones in between - today ${times.map(timeLabel).join(', ')}.`
                      : `At ${times.map(timeLabel).join(', ')}.`}
                </span>
              )}
              {running ? <span className="hint">Change it any time - the week ahead follows at once, up or down.</span> : null}
            </div>
            <div className="field">
              <span className="label">More each day</span>
              <div className="stepper">
                <button type="button" className="btn small icon-btn" aria-label="Less more each day" disabled={growth <= 0} onClick={() => setGrowth(growth - 1)}>
                  −
                </button>
                <span className="stepper-value" aria-label="More each day">
                  {growth > 0 ? `+${growth}` : '0'}
                </span>
                <button
                  type="button"
                  className="btn small icon-btn"
                  aria-label="More each day"
                  disabled={growth >= MAX_GROWTH || perDay === 0}
                  onClick={() => setGrowth(growth + 1)}
                >
                  +
                </button>
              </div>
              {growthLine ? (
                <span className={`hint${growthLine.tight ? ' warn-text' : ''}`}>{growthLine.text}</span>
              ) : (
                <span className="hint">0: the same number every day. +1: one more video each day than the day before.</span>
              )}
            </div>
          </div>

          {problem ? <p className="error">{problem}</p> : null}
          {notice ? <p className="notice">{notice}</p> : null}
          {reuse && saving === null ? (
            <button
              type="button"
              className="btn small"
              onClick={() => {
                const { target, files } = reuse
                setReuse(null)
                void add(target, files, true)
              }}
            >
              Add {reuse.files.length === 1 ? 'it' : `these ${reuse.files.length}`} anyway
            </button>
          ) : null}

          <WhenDue due={trimNow} signal={`${perDay}|${over.join(',')}`} run={() => bankRef.current && runTrim(bankRef.current)} />
          <WhenDue due={dueNow} signal={`${perDay}|${due.length}`} run={() => bankRef.current && runTopUp(bankRef.current)} />
          {/* Mixes already made hold Start back: Start anyway, in red, makes
              them again for this batch. */}
          {!running && Number.isFinite(left) && left < different ? (
            <>
              <div className="batch-start-row">
                <button type="button" className="btn primary batch-make" disabled={!canStart || busyMaking} onClick={start}>
                  {makeLabel}
                </button>
                <button type="button" className="btn batch-make batch-anyway" disabled={!canStart || busyMaking} onClick={startAnyway}>
                  Start anyway
                </button>
              </div>
              <p className="hint">
                {left === 0
                  ? `Every one of these ${different.toLocaleString('en-US')} mixes was made before, so Start makes none.`
                  : `${(different - left).toLocaleString('en-US')} of these ${different.toLocaleString('en-US')} mixes were made before, so Start makes only the other ${left.toLocaleString('en-US')}.`}{' '}
                Start anyway makes them again.
              </p>
            </>
          ) : (
            <button type="button" className="btn primary batch-make" disabled={!canStart || busyMaking} onClick={start}>
              {makeLabel}
            </button>
          )}
          {running && perDay > 0 ? (
            // What "Running · 10 a day" is aiming for: "it says 10 a day, but
            // in Posts there are only 20 - I don't know how much it wants to make".
            <p className="hint batch-aim">
              Next {AHEAD_DAYS} days: {aheadCount} of {aim} videos made
              {onServer
                ? serverQueued > 0
                  ? ` - the server is making ${serverQueued} more, one after another`
                  : ''
                : aheadCount < aim
                  ? ` - it makes the other ${aim - aheadCount} a few at a time`
                  : ''}
              .
            </p>
          ) : null}
          {onServer && (bank.where === 'server' || sending || linkTrouble || bankFiles(bank).length > 0) ? (
            <p className={`hint batch-server${linkTrouble ? ' warn-text' : ''}`}>
              {sending ??
                (linkTrouble
                  ? `Couldn't reach the server: ${linkTrouble} It tries again by itself.`
                  : serverNow?.now
                    ? `On the server now: ${serverNow.now}`
                    : bank.where === 'server'
                      ? `Made on the server${serverSeen ? ` - last heard from ${timeAgo(serverSeen)}` : ''}.`
                      : 'Handing this batch to the server…')}
            </p>
          ) : null}
          {bank.runProblem && running ? <p className="hint warn-text">The last days couldn't be made: {bank.runProblem} It tries again next time.</p> : null}
          <p className="hint new-post-to batch-span">
            {running
              ? `${bank.madeThrough ? `Made through ${dayLabel(bank.madeThrough)}. ` : ''}It makes the next days on its own ${onServer ? 'on the server, day and night' : 'whenever the app is open'}${onEngine ? '' : ' - until every different video is made'}.`
              : `Makes the next ${AHEAD_DAYS} days now, then keeps going on its own ${onServer ? 'on the server, day and night' : 'whenever the app is open'}${onEngine ? '' : ', until every different video is made'}.`}
            {running ? (
              <>
                {' '}
                <button type="button" className="linkbtn" onClick={stop}>
                  Stop
                </button>
              </>
            ) : null}
            {outAhead > 0 ? (
              <>
                {' '}
                <button type="button" className="linkbtn" disabled={busyMaking || saving !== null} onClick={runStartOver}>
                  Start over
                </button>
              </>
            ) : null}
          </p>
          {onEngine && engineState ? (
            <div className="batch-progress">
              <div className={`label${engineState.status === 'failed' ? ' warn-text' : ''}`}>
                {engineState.status === 'done'
                  ? `The engine sent ${engineState.sent} of ${engineState.total} to Posts`
                  : engineState.status === 'failed' || engineState.status === 'stopped'
                    ? `The engine stopped at ${engineState.sent} of ${engineState.total}`
                    : `The engine is making ${engineState.total} · ${engineState.sent} sent`}
              </div>
              <div className="bar">
                <div style={{ width: `${Math.round((engineState.sent / Math.max(1, engineState.total)) * 100)}%` }} />
              </div>
              {engineState.error ? <p className="hint warn-text">{engineState.error}</p> : null}
              {engineState.skipped > 0 ? (
                <p className="hint">{engineState.skipped} couldn't be made different enough from what already went out - film new hooks.</p>
              ) : null}
              {engineBusy ? (
                <button
                  type="button"
                  className="linkbtn"
                  onClick={() => {
                    void stopEngineJob(engineState.id)
                      .then(() => setEngineState({ ...engineState, status: 'stopped' }))
                      .catch((error: unknown) => setProblem(error instanceof Error ? error.message : String(error)))
                  }}
                >
                  Stop after the video it's on
                </button>
              ) : (engineState.status === 'failed' || engineState.status === 'stopped') && engineState.sent < engineState.total ? (
                <button
                  type="button"
                  className="btn small"
                  onClick={() => {
                    setProblem(null)
                    void carryOnEngineJob(engineState.id)
                      .then((job) => {
                        if (bank) keep({ ...bank, engineJob: job.id })
                        setEngineState(job)
                      })
                      .catch((error: unknown) => setProblem(error instanceof Error ? error.message : String(error)))
                  }}
                >
                  Carry on - make the other {engineState.total - engineState.sent}
                </button>
              ) : null}
            </div>
          ) : null}
          <p className="hint new-post-to">
            {missing.length > 0
              ? `Add ${missing.join(', ')} first.`
              : !green && bank.music.length === 0
                ? 'No music yet, so the videos will be silent.'
                : onEngine
                  ? 'Keep the app open while new clips go up to the engine; after that it makes the videos with the app closed. Each waits for your approval in Posts.'
                  : onServer
                    ? 'Keep the app open while new clips go up to the server; after that it makes the videos with the app closed. Each waits for your approval in Posts.'
                    : `Keep the app open with the screen on while they're made - about half a minute each. Each waits for your approval in Posts, and you get one notification when they're all ready.`}
          </p>

          {inProgress.length > 0 ? (
            <div className="batch-progress">
              <div className="label">
                Making {Math.min(total, total - inProgress.length + 1)} of {total}
                {working ? ` · ${Math.round(working.progress * 100)}%` : ''}
              </div>
              <div className="bar">
                <div style={{ width: `${Math.round(((total - inProgress.length + (working?.progress ?? 0)) / Math.max(1, total)) * 100)}%` }} />
              </div>
              <p className="hint">Keep the app open until this is done.</p>
            </div>
          ) : null}

          {failed.length > 0 ? (
            <div className="batch-failed">
              <div className="label warn-text">
                {failed.length} couldn't be made
              </div>
              <ul className="bank-list">
                {failed.map((job) => (
                  <li key={job.id} className="bank-item failed">
                    <span className="bank-text">
                      <span className="bank-name">{job.name}</span>
                      <span className="hint">{job.error ?? 'Failed'}</span>
                    </span>
                    <button type="button" className="btn small" onClick={() => onRetry(job.id)}>
                      Try again
                    </button>
                    <button type="button" className="linkbtn" onClick={() => onRemove(job.id)}>
                      Skip
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {!onEngine && different > 0 ? (
            <div className="batch-variations">
              <div className="label">
                {Number.isFinite(different) ? `${different.toLocaleString('en-US')} variation${different === 1 ? '' : 's'}` : `Over ${MAX_COMBOS.toLocaleString('en-US')} variations`}
              </div>
              <div className="hint">{variationParts(bank).join(' × ')}</div>
              {Number.isFinite(left) ? (
                <div className={`hint batch-left${perDay > 0 && daysLeft <= AHEAD_DAYS ? ' warn-text' : ''}`}>
                  {left === different ? 'None made yet' : `${left.toLocaleString('en-US')} still to make`}
                  {perDay > 0 ? ` - ${daysLeft} day${daysLeft === 1 ? '' : 's'} at ${perDay} a day${growth > 0 ? `, +${growth} each day` : ''}.` : '.'}
                  {perDay > 0 && daysLeft <= AHEAD_DAYS ? ' After them, film new reactions and product showcases.' : ''}
                </div>
              ) : null}
            </div>
          ) : null}
          <p className="hint new-post-to">For {labelOf(campaign, angle)}</p>
        </>
      ) : null}
      {watching ? <ClipViewer file={watching.file} note={watching.note} onClose={() => setWatching(null)} onTakeOut={watching.out} /> : null}
    </section>
  )
}

const LOOK_LABEL: Record<BatchLook, string> = { box: 'White box', outline: 'Outline', snap: 'Snapchat', formula: 'Claude + X' }

/** The hooks a batch's videos take turns between: tap to add one or take it
 *  out - one always stays. With more than one, each gets a share, even until
 *  he taps + or − on one. */
function HookLooks({
  looks,
  withFormula,
  stepped,
  onChange,
}: {
  looks: LookShare[]
  withFormula: boolean
  stepped: boolean
  onChange: (looks: LookShare[]) => void
}) {
  const choices = BATCH_LOOKS.filter((look) => withFormula || look !== 'formula')
  const partsOf = (look: BatchLook) => looks.find((l) => l.look === look)?.parts
  const all = looks.reduce((n, l) => n + l.parts, 0)
  const change = (look: BatchLook, parts: number | null) => {
    const next = choices.flatMap((c) => {
      const kept = c === look ? parts : (partsOf(c) ?? null)
      return kept === null ? [] : [{ look: c, parts: kept }]
    })
    if (next.length > 0) onChange(next)
  }
  const headlineLooks = looks.filter((l) => l.look !== 'formula').length
  return (
    <>
      <div className="seg full headline-look" role="group" aria-label="Hook looks">
        {choices.map((look) => {
          const on = partsOf(look) !== undefined
          return (
            <button key={look} type="button" role="checkbox" aria-checked={on} className={on ? 'active' : ''} onClick={() => change(look, on ? null : 1)}>
              {LOOK_LABEL[look]}
            </button>
          )
        })}
      </div>
      {looks.length > 1 ? (
        <ul className="look-shares">
          {looks.map(({ look, parts }) => (
            <li key={look} className="look-share">
              <span className="look-share-name">{LOOK_LABEL[look]}</span>
              <button type="button" className="btn small icon-btn" aria-label={`Less ${LOOK_LABEL[look]}`} disabled={parts <= 1} onClick={() => change(look, parts - 1)}>
                −
              </button>
              <span className="look-share-pct">{Math.round((parts / all) * 100)}%</span>
              <button type="button" className="btn small icon-btn" aria-label={`More ${LOOK_LABEL[look]}`} disabled={parts >= 9} onClick={() => change(look, parts + 1)}>
                +
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="hint bank-hint">
        {looks.length > 1
          ? `The videos take turns in these shares${headlineLooks > 1 ? ', the same headlines in each look' : ''}.`
          : 'Tap more than one and the videos take turns between them.'}
        {stepped || looks.some((l) => l.look === 'formula') ? ' Step names and Claude + X are always in Outline - Snapchat is only for the hook.' : ''}
      </p>
    </>
  )
}
