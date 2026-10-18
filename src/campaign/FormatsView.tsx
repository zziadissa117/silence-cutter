// The Formats tab: for a campaign, its formats - one way of making a video,
// filmed again and again (formats.ts). Inside one he drops his takes; each
// comes out cut, captioned and joined with the format's own clips, and waits
// here, on the phone, not posted. He watches them, saves them to his phone to
// send the brand, and once the brand says yes taps Schedule for the week (or
// the next 5 days): they go out over those days at the campaign's times.

import { useEffect, useMemo, useRef, useState } from 'react'

import { VideoPicker } from '../VideoPicker'
import { ChevronLeft, ChevronRight } from './icons'
import { SCHEDULE_DAYS, daysLine, spreadOver } from './formats'
import { PHASE_LABEL, canShareFiles, formatTime, share, type Job } from './jobs'
import { isReaction, type Angle, type Campaign } from './look'
import { placeFor, type CampaignPlace, type Profile } from './posting'
import { heldVideos, loadHeldVideo, type PendingJob } from './store'

const LAST_KEY = 'formats.campaign'

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

/** A made video waiting to be scheduled: kept on the phone (`held`), or -
 *  when the phone had no room - only in this session's memory. */
interface Ready {
  id: string
  name: string
  duration: number
  plain: boolean
  /** Its finished file, when already in memory. */
  blob?: Blob
}

export interface FormatClips {
  before?: string
  after?: string
  middle: number
}

export function FormatsView({
  campaigns,
  profile,
  jobs,
  heldVersion,
  clipsOf,
  onNewFormat,
  onEditFormat,
  onAddTakes,
  onSchedule,
  onRemove,
  onRetry,
}: {
  campaigns: Campaign[]
  profile: Profile | null
  /** This session's format takes: being made, failed, or made. */
  jobs: Job[]
  /** Bumped when a video is kept or scheduled. */
  heldVersion: number
  /** The clips joined onto every take of a format. */
  clipsOf: (campaign: Campaign, angle: Angle) => FormatClips
  onNewFormat: (campaign: Campaign, name: string) => void
  onEditFormat: (campaign: Campaign, angle: Angle) => void
  onAddTakes: (campaign: Campaign, angle: Angle, files: File[]) => void
  /** Schedules these videos over `days` days; says how it went. */
  onSchedule: (campaign: Campaign, angle: Angle, ids: string[], days: number) => Promise<string>
  onRemove: (id: string) => void
  onRetry: (id: string) => void
}) {
  const talking = campaigns.filter((c) => !isReaction(c) && !c.general)
  const [campaignId, setCampaignId] = useState(() => talking.find((c) => c.id === remembered())?.id ?? talking[0]?.id ?? '')
  const campaign = talking.find((c) => c.id === campaignId) ?? talking[0] ?? null
  const [openId, setOpenId] = useState<string | null>(null)
  const [naming, setNaming] = useState<string | null>(null)
  const [held, setHeld] = useState<PendingJob[]>([])
  useEffect(() => {
    let alive = true
    void heldVideos()
      .then((rows) => alive && setHeld(rows))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [heldVersion])

  if (!campaign) {
    return (
      <section className="screen formats">
        <div className="screen-head">
          <h1>Formats</h1>
        </div>
        <p className="empty">Make a campaign first, in Campaigns.</p>
      </section>
    )
  }
  const formats = campaign.angles.filter((a) => a.isFormat)
  const open = formats.find((a) => a.id === openId) ?? null
  const readyOf = (angle: Angle): Ready[] => {
    const kept = held
      .filter((r) => r.forFormat === angle.id && r.campaignId === campaign.id && r.held)
      .map((r) => ({ id: r.id, name: r.fileName, duration: r.held!.duration, plain: Boolean(r.held!.plain) }))
    const keptIds = new Set(kept.map((r) => r.id))
    // Made this session but not kept (no room): still here until the app closes.
    const memory = jobs
      .filter((j) => j.forFormat === angle.id && j.status === 'done' && j.result && !keptIds.has(j.id))
      .map((j) => ({ id: j.id, name: j.name, duration: j.result!.newDurationSec, plain: false, blob: j.result!.blob }))
    return [...kept, ...memory]
  }
  const makingOf = (angle: Angle) => jobs.filter((j) => j.forFormat === angle.id && j.status !== 'done')

  if (open) {
    return (
      <FormatPage
        campaign={campaign}
        angle={open}
        place={profile ? placeFor(profile, campaign.id) : null}
        ready={readyOf(open)}
        making={makingOf(open)}
        clips={clipsOf(campaign, open)}
        onBack={() => setOpenId(null)}
        onEdit={() => onEditFormat(campaign, open)}
        onAddTakes={(files) => onAddTakes(campaign, open, files)}
        onSchedule={(ids, days) => onSchedule(campaign, open, ids, days)}
        onRemove={onRemove}
        onRetry={onRetry}
      />
    )
  }

  return (
    <section className="screen formats">
      <div className="screen-head">
        <h1>Formats</h1>
      </div>
      <div className="chooser">
        <select
          aria-label="Campaign"
          value={campaign.id}
          onChange={(e) => {
            setCampaignId(e.target.value)
            remember(e.target.value)
          }}
        >
          {talking.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <p className="hint tip">
        A format is one way of making a video that you film again and again. Drop in your takes: each comes out cut, captioned and joined
        with the format's own clips, and waits here. Send them to the brand, then schedule them for the week.
      </p>

      {formats.length > 0 ? (
        <div className="group format-list">
          {formats.map((angle) => {
            const ready = readyOf(angle).length
            const making = makingOf(angle).length
            return (
              <button key={angle.id} type="button" className="row-link format-row" onClick={() => setOpenId(angle.id)}>
                <span className="format-row-name">{angle.name}</span>
                <span className="hint">
                  {[ready > 0 ? `${ready} ready` : '', making > 0 ? `${making} making` : ''].filter(Boolean).join(' · ') || 'No takes yet'}
                </span>
                <ChevronRight />
              </button>
            )
          })}
        </div>
      ) : null}

      {naming === null ? (
        <button type="button" className="btn" onClick={() => setNaming('')}>
          + New format
        </button>
      ) : (
        <div className="group">
          <label className="field">
            <span className="label">Format name</span>
            <input
              type="text"
              className="find"
              autoFocus
              maxLength={60}
              placeholder="e.g. Morning routine, Day in the life"
              value={naming}
              onChange={(e) => setNaming(e.target.value)}
            />
          </label>
          <p className="hint">Next you set its look and the clips joined onto every take - intro, product demo, outro.</p>
          <div className="actions-row">
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                onNewFormat(campaign, naming.trim() || `Format ${formats.length + 1}`)
                setNaming(null)
              }}
            >
              Create
            </button>
            <button type="button" className="btn" onClick={() => setNaming(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

function FormatPage({
  campaign,
  angle,
  place,
  ready,
  making,
  clips,
  onBack,
  onEdit,
  onAddTakes,
  onSchedule,
  onRemove,
  onRetry,
}: {
  campaign: Campaign
  angle: Angle
  place: CampaignPlace | null
  ready: Ready[]
  making: Job[]
  clips: FormatClips
  onBack: () => void
  onEdit: () => void
  onAddTakes: (files: File[]) => void
  onSchedule: (ids: string[], days: number) => Promise<string>
  onRemove: (id: string) => void
  onRetry: (id: string) => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [said, setSaid] = useState<string | null>(null)
  const [watching, setWatching] = useState<{ id: string; url: string } | null>(null)
  const urls = useRef(new Set<string>())
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), [])
  const posting = Boolean(place && place.accounts.length > 0)

  const fileOf = async (video: Ready): Promise<File | null> => {
    const blob = video.blob ?? (await loadHeldVideo(video.id))
    return blob ? new File([blob], video.name.replace(/\.[^./]+$/, '') + '.mp4', { type: 'video/mp4' }) : null
  }
  const watch = async (video: Ready) => {
    if (watching?.id === video.id) return setWatching(null)
    const file = await fileOf(video)
    if (!file) return setSaid(`${video.name} is no longer on this phone.`)
    const url = URL.createObjectURL(file)
    urls.current.add(url)
    setWatching({ id: video.id, url })
  }
  const save = async (list: Ready[]) => {
    setBusy('Getting them ready…')
    try {
      const files = (await Promise.all(list.map(fileOf))).filter((f): f is File => f !== null)
      if (files.length === 0) return setSaid('Those videos are no longer on this phone.')
      if (canShareFiles(files)) {
        if (!(await share(files))) setSaid("They couldn't be shared - try one at a time.")
        return
      }
      // No share sheet (a computer): each one downloads.
      for (const file of files) {
        const url = URL.createObjectURL(file)
        const a = document.createElement('a')
        a.href = url
        a.download = file.name
        a.click()
        setTimeout(() => URL.revokeObjectURL(url), 10_000)
      }
    } finally {
      setBusy(null)
    }
  }
  const schedule = async (days: number) => {
    setBusy('Scheduling…')
    setSaid(null)
    try {
      setSaid(await onSchedule(ready.map((r) => r.id), days))
    } finally {
      setBusy(null)
    }
  }
  const plans = useMemo(
    () =>
      place && ready.length > 0
        ? Object.fromEntries(SCHEDULE_DAYS.map((days) => [days, spreadOver({ count: ready.length, days, place, campaignId: campaign.id })]))
        : {},
    [place, ready.length, campaign.id],
  )

  return (
    <section className="screen formats">
      <button type="button" className="back" onClick={onBack}>
        <ChevronLeft /> Formats
      </button>
      <div className="screen-head">
        <h1>{angle.name}</h1>
        <button type="button" className="btn small" onClick={onEdit}>
          Look &amp; clips
        </button>
      </div>
      <p className="hint new-post-to">
        {campaign.name} ·{' '}
        {clips.before || clips.after || clips.middle > 0
          ? `joined on every take: ${[clips.before ? `${clips.before} before` : '', clips.middle > 0 ? `${clips.middle} in the middle` : '', clips.after ? `${clips.after} after` : '']
              .filter(Boolean)
              .join(', ')}`
          : 'no clips joined yet - add them in Look & clips'}
      </p>

      <VideoPicker className="btn primary format-add" label={`Add takes for ${angle.name}`} onFiles={onAddTakes}>
        + Add takes
      </VideoPicker>

      {making.length > 0 ? (
        <div className="group">
          <div className="group-title">Making · {making.length}</div>
          <ul className="bank-list">
            {making.map((job) => (
              <li key={job.id} className="bank-item format-making">
                <span className="bank-name">{job.name}</span>
                {job.status === 'failed' || job.status === 'held' ? (
                  <>
                    <span className="hint warn-text">{job.error ?? "Couldn't be made."}</span>
                    <button type="button" className="btn small" onClick={() => onRetry(job.id)}>
                      Try again
                    </button>
                  </>
                ) : (
                  <span className="hint">
                    {job.status === 'working' ? `${PHASE_LABEL[job.phase]} · ${Math.round(job.progress * 100)}%` : 'Waiting its turn'}
                  </span>
                )}
                <button type="button" className="btn small icon-btn" aria-label={`Take out ${job.name}`} onClick={() => onRemove(job.id)}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <p className="hint">Keep the app open with the screen on while they're made.</p>
        </div>
      ) : null}

      {ready.length > 0 ? (
        <div className="group">
          <div className="group-title">Ready · {ready.length}</div>
          <ul className="bank-list">
            {ready.map((video) => (
              <li key={video.id} className="format-ready">
                <div className="bank-item">
                  <button type="button" className="linkbtn bank-name" onClick={() => void watch(video)}>
                    {watching?.id === video.id ? 'Hide' : 'Watch'} · {video.name}
                  </button>
                  <span className="hint">
                    {formatTime(video.duration)}
                    {video.plain ? ' · plain cut' : ''}
                  </span>
                  <button type="button" className="btn small" disabled={busy !== null} onClick={() => void save([video])}>
                    Save
                  </button>
                  <button
                    type="button"
                    className="btn small icon-btn"
                    aria-label={`Take out ${video.name}`}
                    onClick={() => {
                      if (window.confirm(`Take ${video.name} out? It isn't posted anywhere yet.`)) onRemove(video.id)
                    }}
                  >
                    ✕
                  </button>
                </div>
                {watching?.id === video.id ? <video className="format-video" src={watching.url} controls playsInline autoPlay /> : null}
              </li>
            ))}
          </ul>
          <button type="button" className="btn" disabled={busy !== null} onClick={() => void save(ready)}>
            Save all {ready.length} to my phone
          </button>
          <p className="hint">To send them to the brand. Nothing is posted until you schedule them.</p>
        </div>
      ) : making.length === 0 ? (
        <p className="empty">No takes yet. Add the ones you filmed for this format - as many as you like.</p>
      ) : null}

      {ready.length > 0 ? (
        <div className="group">
          <div className="group-title">Brand said yes?</div>
          {posting ? (
            <>
              <div className="actions-row format-schedule">
                {SCHEDULE_DAYS.map((days) => (
                  <button key={days} type="button" className="btn primary" disabled={busy !== null} onClick={() => void schedule(days)}>
                    {days === 7 ? 'Schedule for the week' : `Next ${days} days`}
                  </button>
                ))}
              </div>
              <p className="hint">
                {SCHEDULE_DAYS.map((days) => {
                  const slots = plans[days] ?? []
                  return `${days === 7 ? 'The week' : `${days} days`}: ${daysLine(slots)}`
                }).join('. ')}
                . At {campaign.name}'s posting times; they go without asking again - see them in Posts.
              </p>
            </>
          ) : (
            <p className="hint warn-text">Pick {campaign.name}'s accounts first: Campaigns, open it, then Posting.</p>
          )}
        </div>
      ) : null}

      {busy ? <p className="hint">{busy}</p> : null}
      {said ? <p className="notice">{said}</p> : null}
    </section>
  )
}
