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
  dayLabel,
  emptyBank,
  DEFAULT_FORMULA,
  formulaLine,
  headlinesFrom,
  stepTitle,
  hookOf,
  todayHere,
  usesSteps,
  type BankFile,
  type BatchBank,
  type BatchFormula,
  type BatchStep,
} from './batch'
import { StepOrder } from './StepOrder'
import { filmingOf } from './filming'
import { fingerprint, skippedNotice } from './fingerprint'
import { formatTime, labelOf, type Job } from './jobs'
import { HeadlineLook } from './JobRow'
import type { Angle, Campaign } from './look'
import { copySong, useMusicBank } from './musicBank'
import {
  BATCH_MAX_PER_DAY,
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
  leftToMake,
  missingFor,
  oneAtATime,
  overfull,
  runSlots,
  settled,
  takenBy,
  topUp,
  trimDown,
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

const mb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1e6))} MB`

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
  const songs = useMusicBank()
  /** The campaign's posts as the server has them, for the times a day
   *  topped up keeps clear of; the last copy seen until they come. */
  const [posts, setPosts] = useState<ServerPost[]>(() => lastPosts())
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
  const perDay = bank?.perDay ?? 1
  const running = Boolean(bank?.running)
  const takenOn = takenBy(posts, jobs, campaign.id)
  const times = batchTimesOn(place, campaign.id, todayHere(), perDay)
  const random = ownDayTimes(place).length === 0
  const angle = campaign.angles.find((a) => a.id === bank?.angleId) ?? campaign.angles[0]

  const add = async (target: Target, files: File[]) => {
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
    const added: BankFile[] = []
    const skipped: string[] = []
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
        adding.current.add(fp)
        mine.add(fp)
        setSaving(`Keeping ${files.length > 1 ? `${i + 1} of ${files.length}` : file.name} on this phone…`)
        const id = crypto.randomUUID()
        await saveBankFile(id, file)
        const seconds = kind === 'music' ? undefined : (await filmingOf(file)).seconds
        added.push({ id, name: file.name, type: file.type || (kind === 'music' ? 'audio/mpeg' : 'video/mp4'), size: file.size, fp, ...(seconds ? { seconds } : {}) })
      }
    } catch (error) {
      setProblem(`Not all of them could be kept: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setSaving(null)
      setNotice(skippedNotice(skipped, stepId ? 'in this step' : `in the ${kind === 'music' ? 'music' : kind} bank`))
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
      keep({ ...latest, hook: 'formula', formula: { ...before, [side]: kept } })
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

  const takeOut = (kind: Kind, file: BankFile) => {
    if (!bank || !window.confirm(`Take ${file.name} out of the bank?`)) return
    void deleteBankFile(file.id).catch(() => {})
    keep({ ...bank, [kind]: bank[kind].filter((f) => f.id !== file.id) })
  }
  const takeOutOfStep = (stepId: string, file: BankFile) => {
    if (!bank || !window.confirm(`Take ${file.name} out of the bank?`)) return
    void deleteBankFile(file.id).catch(() => {})
    keep({ ...bank, steps: (bank.steps ?? []).map((s) => (s.id === stepId ? { ...s, files: s.files.filter((f) => f.id !== file.id) } : s)) })
  }
  /** The order saved: a step taken out goes with its clips. */
  const saveOrder = (steps: BatchStep[]) => {
    if (!bank) return
    const kept = new Set(steps.map((s) => s.id))
    for (const gone of (bank.steps ?? []).filter((s) => !kept.has(s.id))) for (const f of gone.files) void deleteBankFile(f.id).catch(() => {})
    keep({ ...bank, steps })
  }

  // The days the batch is still missing, up to a week ahead.
  const due = bank ? runSlots({ bank, place, campaignId: campaign.id, taken: takenOn }) : []
  const green = bank?.layout === 'greenscreen'
  const onEngine = bank?.layout === 'engine'
  const corner = bank?.corner ?? DEFAULT_CORNER
  const formulaHook = bank && !green ? hookOf(bank) === 'formula' : false
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
    const next = { ...current, running: true, runProblem: undefined, spent: undefined }
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

  // While the tab is open, a running batch keeps up with the number on its
  // own (WhenDue): days over it lose the extra first, then a day gone by or
  // a higher number is made.
  const over = running && bank ? overfull(bank) : []
  const trimNow = over.length > 0 && saving === null && !topping
  const dueNow = running && over.length === 0 && due.length > 0 && missing.length === 0 && saving === null && !topping
  const setPerDay = (n: number) => {
    if (bank && Number.isFinite(n)) keep({ ...bank, perDay: Math.min(BATCH_MAX_PER_DAY, Math.max(0, Math.round(n))) })
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
              <span className="bank-name">{file.name}</span>
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
                <span className="bank-name">{file.name}</span>
              )}
              <span className="hint">{[file.seconds ? formatTime(file.seconds) : '', mb(file.size)].filter(Boolean).join(' · ')}</span>
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
              : `Running · ${perDay} a day`
            : `Start · ${perDay} a day`
  // How long the footage lasts at this many a day.
  const daysLeft = Number.isFinite(left) && perDay > 0 ? Math.ceil(left / perDay) : Infinity

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
            <div className="seg full" role="radiogroup" aria-label="Hook">
              <button type="button" role="radio" aria-checked={!formulaHook} className={!formulaHook ? 'active' : ''} onClick={() => keep({ ...bank, hook: 'headline' })}>
                Headlines
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={formulaHook}
                className={formulaHook ? 'active' : ''}
                onClick={() => keep({ ...bank, hook: 'formula', formula: bank.formula ?? { ...DEFAULT_FORMULA, left: rememberedLeft() } })}
              >
                Claude + X
              </button>
            </div>
          </div>
          )}
          {formulaHook ? (
            <div className="group">
              <p className="hint bank-hint tip">Two logos with a plus between them over every reaction, then a different amount a day on each video. No headline.</p>
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
              <FormulaPreview left={formula.left} right={formula.right} line={formulaLine(formula, 'preview')} look={angle.headline} load={loadBankFile} />
            </div>
          ) : (
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
            {onEngine ? null : (
              <>
                <HeadlineLook value={bank.headlineStyle ?? angle.headline.style} onPick={(headlineStyle) => keep({ ...bank, headlineStyle })} />
                {stepped ? <p className="hint bank-hint">The step names use the same look.</p> : null}
              </>
            )}
          </div>
          )}
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
                  disabled={bank.perDay <= 0}
                  onClick={() => setPerDay(bank.perDay - 1)}
                >
                  −
                </button>
                <input
                  type="number"
                  inputMode="numeric"
                  className="stepper-value"
                  aria-label="Videos a day"
                  min={0}
                  max={BATCH_MAX_PER_DAY}
                  value={perDayDraft ?? String(bank.perDay)}
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
                  disabled={bank.perDay >= BATCH_MAX_PER_DAY}
                  onClick={() => setPerDay(bank.perDay + 1)}
                >
                  +
                </button>
              </div>
              {bank.perDay === 0 ? (
                <span className="hint">Paused: nothing more goes out until you raise it. Your clips and what's left to make are kept.</span>
              ) : (
                <span className={`hint${times.length < bank.perDay ? ' warn-text' : ''}`}>
                  {times.length < bank.perDay
                    ? `The window only fits ${times.length} a day, 10 minutes apart - widen it in the campaign's Posting. `
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
          </div>

          {problem ? <p className="error">{problem}</p> : null}
          {notice ? <p className="notice">{notice}</p> : null}

          <WhenDue due={trimNow} signal={`${perDay}|${over.join(',')}`} run={() => bankRef.current && runTrim(bankRef.current)} />
          <WhenDue due={dueNow} signal={`${perDay}|${due.length}`} run={() => bankRef.current && runTopUp(bankRef.current)} />
          <button type="button" className="btn primary batch-make" disabled={!canStart || busyMaking} onClick={start}>
            {makeLabel}
          </button>
          {bank.runProblem && running ? <p className="hint warn-text">The last days couldn't be made: {bank.runProblem} It tries again next time.</p> : null}
          <p className="hint new-post-to batch-span">
            {running
              ? `${bank.madeThrough ? `Made through ${dayLabel(bank.madeThrough)}. ` : ''}It makes the next days on its own whenever the app is open${onEngine ? '' : ' - until every different video is made'}.`
              : `Makes the next ${AHEAD_DAYS} days now, then keeps going on its own whenever the app is open${onEngine ? '' : ', until every different video is made'}.`}
            {running ? (
              <>
                {' '}
                <button type="button" className="linkbtn" onClick={stop}>
                  Stop
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
          {different > 0 && Number.isFinite(different) && perDay > 0 ? (
            <p className={`hint new-post-to batch-left${daysLeft <= AHEAD_DAYS ? ' warn-text' : ''}`}>
              {left} of {different} different videos left - {daysLeft} day{daysLeft === 1 ? '' : 's'} at {perDay} a day.
              {daysLeft <= AHEAD_DAYS ? ' After them, film new reactions and product showcases.' : ''}
            </p>
          ) : null}
          <p className="hint new-post-to">
            {missing.length > 0
              ? `Add ${missing.join(', ')} first.`
              : !green && bank.music.length === 0
                ? 'No music yet, so the videos will be silent.'
                : onEngine
                  ? 'Keep the app open while new clips go up to the engine; after that it makes the videos with the app closed. Each waits for your approval in Posts.'
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
          <p className="hint new-post-to">For {labelOf(campaign, angle)}</p>
        </>
      ) : null}
    </section>
  )
}

