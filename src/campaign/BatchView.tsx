// The Batch tab: for one campaign, a bank of reactions (they go first, with
// the headline), product showcases, headlines and music. He picks how many
// a day and for how many days, taps once, and the videos are mixed from the
// bank (batch.ts), made one after another on this phone, and sent up - each
// for one of the campaign's posting times - to wait for his approval. He
// hears once, when the whole batch is ready.

import { TrackName, TrackPlayer } from './TrackPlayer'
import { useEffect, useRef, useState } from 'react'

import { VideoPicker } from '../VideoPicker'
import { pickArrived, pickSaved } from '../pickWatch'
import {
  combos,
  dayLabel,
  emptyBank,
  DEFAULT_FORMULA,
  formulaLine,
  formulaText,
  headlinesFrom,
  headlinesToMix,
  hookOf,
  pickBatch,
  planSlots,
  todayHere,
  spend,
  type BankFile,
  type BatchBank,
  type BatchFormula,
} from './batch'
import { filmingOf } from './filming'
import { fingerprint, skippedNotice } from './fingerprint'
import { formatTime, labelOf, type Job } from './jobs'
import type { Angle, Campaign } from './look'
import { copySong, useMusicBank } from './musicBank'
import { BATCH_MAX_PER_DAY, accountLabel, batchTimesOn, ownDayTimes, placeFor, timeLabel, windowLabel, windowOf, type LocalPosting } from './posting'
import { deleteBankFile, loadBankFile, loadBatchBank, saveBankFile, saveBatchBank, type JobBatch } from './store'
import { FormulaPreview } from './FormulaPreview'

const LAST_KEY = 'batch.campaign'
const MAX_DAYS = 14
/** A track this big is any song there is. */
const MAX_SONG_MB = 30

export interface BatchVideo {
  reaction: BankFile
  product: BankFile
  music: BankFile | null
  headline: string
  /** The "Claude + X" hook, when the bank uses it: the headline above is then
   *  what it says in words, for the caption. */
  formula?: { left: BankFile | null; right: BankFile | null; line: string }
  batch: JobBatch
}

type Kind = 'reactions' | 'products' | 'music'

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
  /** Fingerprints being kept right now, so two picks that overlap cannot both
   *  keep the same recording. */
  const adding = useRef(new Set<string>())
  const bankRef = useRef(bank)
  bankRef.current = bank
  /** Set the moment "Make" is tapped, before React has re-rendered: a second
   *  tap in between would plan the same days again and make every video
   *  twice. Cleared once the batch's videos show up on this phone. */
  const making = useRef(false)
  const [tapped, setTapped] = useState(false)

  useEffect(() => {
    if (!campaign) return
    let cancelled = false
    setBank(null)
    void loadBatchBank(campaign.id).then((stored) => {
      if (cancelled) return
      const loaded = stored ?? emptyBank(campaign.id, campaign.angles[0].id)
      setBank(loaded)
      setHeadlineText(loaded.headlines.join('\n'))
    })
    return () => {
      cancelled = true
    }
  }, [campaign?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // The tap's videos have reached the job list (or nothing came of it): from
  // here the running jobs keep the button busy until they are made.
  const jobsAtTap = useRef(0)
  useEffect(() => {
    if (!tapped) return
    const done = () => {
      making.current = false
      setTapped(false)
    }
    if (jobs.length !== jobsAtTap.current) return done()
    const timer = setTimeout(done, 5000)
    return () => clearTimeout(timer)
  }, [tapped, jobs.length])

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
  const timesOnDate = (date: string) => batchTimesOn(place, campaign.id, date, perDay)
  const times = timesOnDate(todayHere())
  const random = ownDayTimes(place).length === 0
  const angle = campaign.angles.find((a) => a.id === bank?.angleId) ?? campaign.angles[0]

  const add = async (kind: Kind, files: File[]) => {
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
        const inBank = bankRef.current?.[kind] ?? []
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
      setNotice(skippedNotice(skipped, `in the ${kind === 'music' ? 'music' : kind} bank`))
      if (kind !== 'music') pickSaved()
      const current = bankRef.current
      if (current && added.length > 0) keep({ ...current, [kind]: [...current[kind], ...added] })
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

  const wanted = bank ? planSlots({ times: timesOnDate, perDay: bank.perDay, days: bank.days, madeThrough: bank.madeThrough }) : []
  // Never a video twice: a batch stops at the last different one left.
  const formulaHook = bank ? hookOf(bank) === 'formula' : false
  const formula: BatchFormula = bank?.formula ?? DEFAULT_FORMULA
  const mixable = bank ? { ...bank, headlines: headlinesToMix(bank) } : null
  const { total: different, left } = mixable ? combos(mixable) : { total: 0, left: 0 }
  const slots = Number.isFinite(left) ? wanted.slice(0, left) : wanted
  const spentShown = Boolean(bank?.spent) && (bank!.reactions.length === 0 || bank!.products.length === 0)
  const missing = !bank
    ? []
    : [
        bank.reactions.length === 0 ? 'a reaction' : '',
        bank.products.length === 0 ? 'a product showcase' : '',
        formulaHook ? (!formula.left || !formula.right ? 'both logos' : '') : bank.headlines.length === 0 ? 'a headline' : '',
      ].filter(Boolean)
  const running = jobs.filter((j) => j.status !== 'failed' && j.status !== 'held')
  const makingHere = running.filter((j) => j.campaignId === campaign.id)
  const busyMaking = tapped || makingHere.length > 0
  const madeHereTotal = [...new Map(jobs.filter((j) => j.campaignId === campaign.id).map((j) => [j.batch!.id, j.batch!.size])).values()].reduce(
    (a, b) => a + b,
    0,
  )
  const failed = jobs.filter((j) => j.status === 'failed' || j.status === 'held')
  const total = [...new Map(jobs.map((j) => [j.batch!.id, j.batch!.size])).values()].reduce((a, b) => a + b, 0)
  const working = jobs.find((j) => j.status === 'working')
  const canMake = Boolean(bank) && missing.length === 0 && slots.length > 0 && saving === null && !busyMaking

  const make = () => {
    if (!bank || !canMake || making.current) return
    making.current = true
    jobsAtTap.current = jobs.length
    setTapped(true)
    const { picks, used, lastPair, made } = pickBatch(mixable!, slots.length)
    const id = `b-${Date.now().toString(36)}`
    const byId = (list: BankFile[], fileId: string | null) => list.find((f) => f.id === fileId) ?? null
    const videos: BatchVideo[] = picks.map((pick, i) => ({
      reaction: byId(bank.reactions, pick.reaction)!,
      product: byId(bank.products, pick.product)!,
      music: byId(bank.music, pick.music),
      ...(formulaHook
        ? (() => {
            const line = formulaLine(formula, `${id}-${i}`)
            return { headline: formulaText(formula, line), formula: { left: formula.left, right: formula.right, line } }
          })()
        : { headline: pick.headline }),
      batch: { id, date: slots[i].date, time: slots[i].time, size: slots.length },
    }))
    remember(campaign.id)
    const through = slots[slots.length - 1].date
    let next: BatchBank = { ...bank, used, lastPair, made, madeThrough: through }
    let retire: string[] = []
    if (Number.isFinite(left) && slots.length >= left) {
      // That was every different video: the footage goes, for new filming.
      ;({ bank: next, retired: retire } = spend(next, through))
      setProblem(null)
    }
    keep(next)
    onMake(campaign, angle, videos, retire)
  }

  const bankSize = bank ? [...bank.reactions, ...bank.products, ...bank.music].reduce((n, f) => n + f.size, 0) : 0

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

  const nextDays = slots.length > 0 ? dayRange(slots[0].date, slots[slots.length - 1].date) : ''
  const makeLabel = busyMaking
    ? makingHere.length > 0
      ? `Making ${Math.max(0, madeHereTotal - makingHere.length) + 1} of ${madeHereTotal}…`
      : 'Making…'
    : slots.length > 0
      ? `Make ${slots.length}${bank?.madeThrough && bank.madeThrough >= todayHere() ? ' more' : ''} video${slots.length === 1 ? '' : 's'} - ${nextDays}`
      : 'Make them'

  return (
    <section className="screen batch">
      <div className="screen-head">
        <h1>Batch</h1>
      </div>

      <div className="chooser">
        <select
          aria-label="Campaign"
          value={campaign.id}
          onChange={(e) => {
            setCampaignId(e.target.value)
            remember(e.target.value)
            setProblem(null)
          }}
        >
          {choices.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
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
          {list('reactions', 'Reactions', 'They go first, with the headline over them.')}
          {list('products', 'Product showcases', 'Shown after the reaction.')}
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
          {formulaHook ? (
            <div className="group">
              <p className="hint bank-hint">Two logos with a plus between them over every reaction, then a different amount a day on each video. No headline.</p>
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
            <p className="hint bank-hint">One a line - paste them all in.</p>
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
          </div>
          )}
          {list('music', 'Music', 'The only sound - the clips are muted. With one track every video uses it; with more, each gets one at random.')}
          {saving ? <p className="hint">{saving}</p> : null}
          {bankSize > 0 ? <p className="hint">The bank keeps {mb(bankSize)} on this phone.</p> : null}

          <div className="group">
            <div className="group-title">Posting</div>
            <>
                <div className="field">
                  <span className="label">Videos a day</span>
                  <div className="stepper">
                    <button
                      type="button"
                      className="btn small icon-btn"
                      aria-label="Fewer a day"
                      disabled={bank.perDay <= 1}
                      onClick={() => keep({ ...bank, perDay: bank.perDay - 1 })}
                    >
                      −
                    </button>
                    <span className="stepper-value" aria-label="Videos a day">
                      {bank.perDay}
                    </span>
                    <button
                      type="button"
                      className="btn small icon-btn"
                      aria-label="More a day"
                      disabled={bank.perDay >= BATCH_MAX_PER_DAY}
                      onClick={() => keep({ ...bank, perDay: bank.perDay + 1 })}
                    >
                      +
                    </button>
                  </div>
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
                </div>
                <div className="field">
                  <span className="label">Days</span>
                  <div className="stepper">
                    <button type="button" className="btn small icon-btn" aria-label="Fewer days" disabled={bank.days <= 1} onClick={() => keep({ ...bank, days: bank.days - 1 })}>
                      −
                    </button>
                    <span className="stepper-value">{bank.days}</span>
                    <button
                      type="button"
                      className="btn small icon-btn"
                      aria-label="More days"
                      disabled={bank.days >= MAX_DAYS}
                      onClick={() => keep({ ...bank, days: bank.days + 1 })}
                    >
                      +
                    </button>
                  </div>
                </div>
              </>
          </div>

          {problem ? <p className="error">{problem}</p> : null}
          {notice ? <p className="notice">{notice}</p> : null}

          <button type="button" className="btn primary batch-make" disabled={!canMake} onClick={make}>
            {makeLabel}
          </button>
          {different > 0 && Number.isFinite(different) ? (
            <p className={`hint new-post-to batch-left${slots.length < wanted.length ? ' warn-text' : ''}`}>
              {left} of {different} different videos left
              {slots.length < wanted.length && slots.length > 0
                ? ` - that's all this batch can be. After them, film new reactions and product showcases.`
                : ''}
            </p>
          ) : null}
          {slots.length > 0 ? (
            <p className="hint new-post-to batch-span">
              {dayLabel(slots[0].date)}
              {slots[slots.length - 1].date !== slots[0].date ? ` to ${dayLabel(slots[slots.length - 1].date)}` : ''}
            </p>
          ) : null}
          <p className="hint new-post-to">
            {missing.length > 0
              ? `Add ${missing.join(', ')} first.`
              : bank.music.length === 0
                ? 'No music yet, so the videos will be silent.'
                : `Keep the app open with the screen on while they're made - about half a minute each. Each waits for your approval in Posts, and you get one notification when they're all ready.`}
          </p>
          {bank.madeThrough ? <p className="hint new-post-to">Made through {dayLabel(bank.madeThrough)}.</p> : null}

          {running.length > 0 ? (
            <div className="batch-progress">
              <div className="label">
                Making {Math.min(total, total - running.length + 1)} of {total}
                {working ? ` · ${Math.round(working.progress * 100)}%` : ''}
              </div>
              <div className="bar">
                <div style={{ width: `${Math.round(((total - running.length + (working?.progress ?? 0)) / Math.max(1, total)) * 100)}%` }} />
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

/** "Wed Oct 14" or "Wed Oct 14 to Fri Oct 16". */
function dayRange(first: string, last: string): string {
  return first === last ? dayLabel(first) : `${dayLabel(first)} to ${dayLabel(last)}`
}
