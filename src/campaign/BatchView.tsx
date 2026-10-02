// The Batch tab: for one campaign, a bank of reactions (they go first, with
// the headline), product showcases, headlines and music. He picks how many
// a day and for how many days, taps once, and the videos are mixed from the
// bank (batch.ts), made one after another on this phone, and sent up - each
// for one of the campaign's posting times - to wait for his approval. He
// hears once, when the whole batch is ready.

import { useEffect, useRef, useState } from 'react'

import { VideoPicker } from '../VideoPicker'
import { pickArrived, pickSaved } from '../pickWatch'
import {
  combos,
  dayLabel,
  dayTimes,
  emptyBank,
  headlinesFrom,
  pickBatch,
  planSlots,
  spend,
  type BankFile,
  type BatchBank,
} from './batch'
import { filmingOf } from './filming'
import { formatTime, labelOf, type Job } from './jobs'
import type { Angle, Campaign } from './look'
import { accountLabel, placeFor, timeLabel, type LocalPosting } from './posting'
import { deleteBankFile, loadBatchBank, saveBankFile, saveBatchBank, type JobBatch } from './store'

const LAST_KEY = 'batch.campaign'
const MAX_DAYS = 14
/** A track this big is any song there is. */
const MAX_SONG_MB = 30

export interface BatchVideo {
  reaction: BankFile
  product: BankFile
  music: BankFile | null
  headline: string
  batch: JobBatch
}

type Kind = 'reactions' | 'products' | 'music'

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
  const bankRef = useRef(bank)
  bankRef.current = bank

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
  const times = place.times
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
    const added: BankFile[] = []
    try {
      for (const [i, file] of files.entries()) {
        if (kind === 'music' && file.size > MAX_SONG_MB * 1e6) throw new Error(`${file.name} is over ${MAX_SONG_MB} MB - pick a shorter one or an MP3.`)
        setSaving(`Keeping ${files.length > 1 ? `${i + 1} of ${files.length}` : file.name} on this phone…`)
        const id = crypto.randomUUID()
        await saveBankFile(id, file)
        const seconds = kind === 'music' ? undefined : (await filmingOf(file)).seconds
        added.push({ id, name: file.name, type: file.type || (kind === 'music' ? 'audio/mpeg' : 'video/mp4'), size: file.size, ...(seconds ? { seconds } : {}) })
      }
    } catch (error) {
      setProblem(`Not all of them could be kept: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setSaving(null)
      if (kind !== 'music') pickSaved()
      const current = bankRef.current
      if (current && added.length > 0) keep({ ...current, [kind]: [...current[kind], ...added] })
    }
  }

  const takeOut = (kind: Kind, file: BankFile) => {
    if (!bank || !window.confirm(`Take ${file.name} out of the bank?`)) return
    void deleteBankFile(file.id).catch(() => {})
    keep({ ...bank, [kind]: bank[kind].filter((f) => f.id !== file.id) })
  }

  const wanted = bank ? planSlots({ times, perDay: bank.perDay, days: bank.days, madeThrough: bank.madeThrough }) : []
  // Never a video twice: a batch stops at the last different one left.
  const { total: different, left } = bank ? combos(bank) : { total: 0, left: 0 }
  const slots = Number.isFinite(left) ? wanted.slice(0, left) : wanted
  const spentShown = Boolean(bank?.spent) && (bank!.reactions.length === 0 || bank!.products.length === 0)
  const missing = !bank
    ? []
    : [
        bank.reactions.length === 0 ? 'a reaction' : '',
        bank.products.length === 0 ? 'a product showcase' : '',
        bank.headlines.length === 0 ? 'a headline' : '',
      ].filter(Boolean)
  const running = jobs.filter((j) => j.status !== 'failed' && j.status !== 'held')
  const failed = jobs.filter((j) => j.status === 'failed' || j.status === 'held')
  const total = [...new Map(jobs.map((j) => [j.batch!.id, j.batch!.size])).values()].reduce((a, b) => a + b, 0)
  const working = jobs.find((j) => j.status === 'working')
  const canMake = Boolean(bank) && missing.length === 0 && slots.length > 0 && times.length > 0 && saving === null

  const make = () => {
    if (!bank || !canMake) return
    const { picks, used, lastPair, made } = pickBatch(bank, slots.length)
    const id = `b-${Date.now().toString(36)}`
    const byId = (list: BankFile[], fileId: string | null) => list.find((f) => f.id === fileId) ?? null
    const videos: BatchVideo[] = picks.map((pick, i) => ({
      reaction: byId(bank.reactions, pick.reaction)!,
      product: byId(bank.products, pick.product)!,
      music: byId(bank.music, pick.music),
      headline: pick.headline,
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
      {bank && bank[kind].length > 0 ? (
        <ul className="bank-list">
          {bank[kind].map((file) => (
            <li key={file.id} className="bank-item">
              <span className="bank-name">{file.name}</span>
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

  const perDayChoices = Array.from({ length: Math.min(6, times.length) }, (_, i) => i + 1)

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
          {times.length > 0 ? ` · at ${times.map(timeLabel).join(', ')}` : ''}
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
          {list('music', 'Music', 'The only sound - the clips are muted. With one track every video uses it; with more, each gets one at random.')}
          {saving ? <p className="hint">{saving}</p> : null}
          {bankSize > 0 ? <p className="hint">The bank keeps {mb(bankSize)} on this phone.</p> : null}

          <div className="group">
            <div className="group-title">Posting</div>
            {times.length === 0 ? (
              <p className="hint warn-text">{campaign.name} has no posting times. Add them first: Campaigns, {campaign.name}, Posting.</p>
            ) : (
              <>
                <div className="field">
                  <span className="label">Videos a day</span>
                  <div className="seg full" role="radiogroup" aria-label="Videos a day">
                    {perDayChoices.map((n) => (
                      <button
                        key={n}
                        type="button"
                        role="radio"
                        aria-checked={bank.perDay === n}
                        className={bank.perDay === n ? 'active' : ''}
                        onClick={() => keep({ ...bank, perDay: n })}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                  <span className="hint">At {dayTimes(times, bank.perDay).map(timeLabel).join(', ')}.</span>
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
            )}
          </div>

          {problem ? <p className="error">{problem}</p> : null}

          <button type="button" className="btn primary batch-make" disabled={!canMake} onClick={make}>
            {slots.length > 0 ? `Make ${slots.length} video${slots.length === 1 ? '' : 's'}` : 'Make them'}
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
