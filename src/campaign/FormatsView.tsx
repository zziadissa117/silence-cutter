// The Formats tab: for a campaign, its formats - a script filmed again and
// again (formats.ts). He writes its lines in order and drops in his takes of
// each - the same words, said a different way every time - and Make mixes
// them into videos: a different opening each, one take of every line,
// joined, cut, captioned and with the format's look and clips. They wait
// here, on the phone, not posted. He watches them, saves them to his phone
// to send the brand, and once the brand says yes taps Over the month (or the
// week, or the next 5 days): they go out over those days at the campaign's
// times.

import { useEffect, useMemo, useRef, useState } from 'react'

import { VideoPicker } from '../VideoPicker'
import { pickArrived, pickSaved } from '../pickWatch'
import { ClipViewer } from './ClipViewer'
import { filmingOf } from './filming'
import { fingerprint, skippedNotice } from './fingerprint'
import { SCHEDULE_DAYS, daysLine, mixesOf, spreadOver, type FormatLine, type FormatScript, type FormatTake } from './formats'
import { ChevronLeft, ChevronRight } from './icons'
import { PHASE_LABEL, canShareFiles, formatTime, share, type Job } from './jobs'
import { isReaction, type Angle, type Campaign } from './look'
import { placeFor, type CampaignPlace, type Profile } from './posting'
import { StepName } from './StepOrder'
import { heldVideos, loadFormatScript, loadHeldVideo, saveBankFile, saveFormatScript, type PendingJob } from './store'

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
  onMake,
  onLetGo,
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
  /** The clips joined onto every video of a format. */
  clipsOf: (campaign: Campaign, angle: Angle) => FormatClips
  onNewFormat: (campaign: Campaign, name: string) => void
  onEditFormat: (campaign: Campaign, angle: Angle) => void
  /** Makes a video for every opening of the format's script not made yet;
   *  says how many. */
  onMake: (campaign: Campaign, angle: Angle) => Promise<number>
  /** Takes taken out: off the phone once no video still to be made needs them. */
  onLetGo: (ids: string[]) => void
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
        onMake={() => onMake(campaign, open)}
        onLetGo={onLetGo}
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
        A format is a script you film again and again, a different way each time. Write its lines, add your takes of each, and Make mixes
        them into videos - a different opening every time - cut, captioned and joined with the format's clips. They wait here: send them to
        the brand, then schedule them for the month.
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
          <p className="hint">Next you set its look and the clips joined onto every video - intro, product demo, outro. Then write its lines.</p>
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
  onMake,
  onLetGo,
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
  onMake: () => Promise<number>
  onLetGo: (ids: string[]) => void
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

  // The script: its lines and their takes, kept on the phone. Takes come in
  // a few at a time while he types, so every change starts from the latest.
  const [script, setScript] = useState<FormatScript | null>(null)
  const scriptRef = useRef<FormatScript | null>(null)
  const [openLine, setOpenLine] = useState<string | null>(null)
  const [viewing, setViewing] = useState<{ line: FormatLine; take: FormatTake } | null>(null)
  const [newLine, setNewLine] = useState('')
  const making_ = useRef(false)
  useEffect(() => {
    let alive = true
    void loadFormatScript(angle.id).then((loaded) => {
      if (!alive) return
      scriptRef.current = loaded
      setScript(loaded)
    })
    return () => {
      alive = false
    }
  }, [angle.id])
  const keep = (next: FormatScript) => {
    scriptRef.current = next
    setScript(next)
    void saveFormatScript(next).catch(() => setSaid("The script couldn't be kept on this phone. Try that again."))
  }
  const lines = script?.lines ?? []
  const mixes = useMemo(() => (script ? mixesOf(script) : []), [script])
  const changeLine = (id: string, change: (line: FormatLine) => FormatLine) => {
    const current = scriptRef.current
    if (current) keep({ ...current, lines: current.lines.map((line) => (line.id === id ? change(line) : line)) })
  }
  const addLine = () => {
    const current = scriptRef.current
    if (!current) return
    const words = newLine.trim() || `Line ${current.lines.length + 1}`
    keep({ ...current, lines: [...current.lines, { id: crypto.randomUUID(), words, takes: [] }] })
    setNewLine('')
  }
  const moveUp = (i: number) => {
    const current = scriptRef.current
    if (!current || i < 1) return
    const next = [...current.lines]
    ;[next[i - 1], next[i]] = [next[i], next[i - 1]]
    keep({ ...current, lines: next })
  }
  const removeLine = (line: FormatLine) => {
    const n = line.takes.length
    if (n > 0 && !window.confirm(`Take out "${line.words}" and its ${n} take${n === 1 ? '' : 's'}?`)) return
    const current = scriptRef.current
    if (!current) return
    keep({ ...current, lines: current.lines.filter((l) => l.id !== line.id) })
    if (n > 0) onLetGo(line.takes.map((t) => t.id))
  }
  const removeTake = (line: FormatLine, take: FormatTake) => {
    const current = scriptRef.current
    if (!current) return
    const { [take.id]: _, ...uses } = current.uses
    keep({ ...current, uses, lines: current.lines.map((l) => (l.id === line.id ? { ...l, takes: l.takes.filter((t) => t.id !== take.id) } : l)) })
    onLetGo([take.id])
    setViewing(null)
  }

  /** His takes of one line, each kept once on the phone: the same recording
   *  again is skipped and named, and an opening already made into a video
   *  never comes back. */
  const addTakes = async (lineId: string, files: File[]) => {
    const problem = pickArrived(files)
    if (problem) setSaid(problem)
    if (files.length === 0) return pickSaved()
    if (making_.current) {
      pickSaved()
      return setSaid('Wait a moment until they have started, then add these again.')
    }
    setSaid(null)
    const added: FormatTake[] = []
    const skipped: string[] = []
    const usedBefore: string[] = []
    try {
      for (const [i, file] of files.entries()) {
        const fp = await fingerprint(file)
        const current = scriptRef.current
        const known = (current?.lines ?? []).flatMap((line) => line.takes)
        if ([...known, ...added].some((t) => t.fp === fp)) {
          skipped.push(file.name)
          continue
        }
        if (current?.lines[0]?.id === lineId && current.opened.includes(fp)) {
          usedBefore.push(file.name)
          continue
        }
        setBusy(`Keeping ${files.length > 1 ? `${i + 1} of ${files.length}` : file.name} on this phone…`)
        const id = crypto.randomUUID()
        await saveBankFile(id, file)
        const { filmedAt, seconds } = await filmingOf(file)
        added.push({
          id,
          name: file.name,
          type: file.type || 'video/mp4',
          size: file.size,
          fp,
          ...(seconds ? { seconds } : {}),
          ...(filmedAt !== undefined ? { filmedAt } : {}),
        })
      }
    } catch (error) {
      setSaid(`Not all of them could be kept: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusy(null)
      pickSaved()
      if (added.length > 0) changeLine(lineId, (line) => ({ ...line, takes: [...line.takes, ...added] }))
      const again =
        usedBefore.length === 0
          ? null
          : `${usedBefore.length === 1 ? usedBefore[0] : `${usedBefore.length} of them`} already opened a video you made, so ${usedBefore.length === 1 ? "it wasn't" : "they weren't"} added again - film new ones to make more.`
      const notice = [skippedNotice(skipped, 'in this format'), again].filter(Boolean).join(' ')
      if (notice) setSaid(notice)
    }
  }

  const make = async () => {
    if (making_.current) return
    making_.current = true
    setBusy('Starting them…')
    setSaid(null)
    try {
      const n = await onMake()
      const latest = await loadFormatScript(angle.id)
      scriptRef.current = latest
      setScript(latest)
      setSaid(
        n > 0
          ? `${n} video${n === 1 ? '' : 's'} on the way. Keep the app open with the screen on - each one shows under Ready when it's made.`
          : 'Nothing new to make.',
      )
    } catch (error) {
      setSaid(`They couldn't be started: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      making_.current = false
      setBusy(null)
    }
  }

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
  const waiting = (() => {
    if (!script || lines.length === 0 || mixes.length > 0) return null
    const empty = lines.findIndex((line, i) => i > 0 && line.takes.length === 0)
    if (lines[0].takes.length === 0) {
      return script.opened.length > 0
        ? `Every take of line 1 opens a video already. Film new ones of "${lines[0].words}" to make more.`
        : `Add your takes of line 1, "${lines[0].words}", to make videos.`
    }
    return `Add your takes of line ${empty + 1}, "${lines[empty].words}", to make videos.`
  })()

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
          ? `joined on every video: ${[clips.before ? `${clips.before} before` : '', clips.middle > 0 ? `${clips.middle} in the middle` : '', clips.after ? `${clips.after} after` : '']
              .filter(Boolean)
              .join(', ')}`
          : 'no clips joined yet - add them in Look & clips'}
      </p>

      {script ? (
        <div className="group format-script">
          <div className="group-title">Script{lines.length > 0 ? ` · ${lines.length} line${lines.length === 1 ? '' : 's'}` : ''}</div>
          {lines.length === 0 ? (
            <p className="hint">
              Write its lines in order - what you say, filmed again and again a different way each time. Then add your takes of each line:
              every video takes one take of each, in this order.
            </p>
          ) : null}
          <ol className="step-list">
            {lines.map((line, i) => (
              <li key={line.id} className="step-row format-line">
                <span className="step-n">{i + 1}</span>
                <StepName label={`Line ${i + 1}`} value={line.words} onChange={(words) => changeLine(line.id, (l) => ({ ...l, words }))} />
                <span className="format-takes">
                  <button
                    type="button"
                    className="linkbtn"
                    disabled={line.takes.length === 0}
                    onClick={() => setOpenLine(openLine === line.id ? null : line.id)}
                  >
                    {takesLine(line, i, script)}
                  </button>
                  <span className="step-tools">
                    <VideoPicker className="btn small" label={`Add takes of ${line.words}`} onFiles={(files) => void addTakes(line.id, files)}>
                      + Takes
                    </VideoPicker>
                    <button type="button" className="btn small icon-btn" aria-label={`Move ${line.words} up`} disabled={i === 0} onClick={() => moveUp(i)}>
                      ↑
                    </button>
                    <button type="button" className="btn small icon-btn" aria-label={`Take out the line ${line.words}`} onClick={() => removeLine(line)}>
                      ✕
                    </button>
                  </span>
                </span>
                {openLine === line.id && line.takes.length > 0 ? (
                  <ul className="bank-list format-take-list">
                    {line.takes.map((take) => (
                      <li key={take.id} className="bank-item">
                        <button type="button" className="linkbtn bank-name" onClick={() => setViewing({ line, take })}>
                          {take.name}
                        </button>
                        <span className="hint">
                          {[take.seconds ? formatTime(take.seconds) : '', i > 0 ? inVideos(script.uses[take.id] ?? 0) : ''].filter(Boolean).join(' · ')}
                        </span>
                        <button type="button" className="btn small icon-btn" aria-label={`Take out ${take.name}`} onClick={() => removeTake(line, take)}>
                          ✕
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ol>
          <div className="actions-row format-new-line">
            <input
              type="text"
              className="find"
              aria-label="New line"
              placeholder={lines.length === 0 ? 'e.g. ELON MUST BE STOPPED' : 'The next line'}
              value={newLine}
              onChange={(e) => setNewLine(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addLine()
              }}
            />
            <button type="button" className="btn small" onClick={addLine}>
              + Add line
            </button>
          </div>
          {mixes.length > 0 ? (
            <>
              <button type="button" className="btn primary format-add" disabled={busy !== null} onClick={() => void make()}>
                Make {mixes.length} video{mixes.length === 1 ? '' : 's'}
              </button>
              <p className="hint">
                {lines.length === 1
                  ? 'Each take becomes its own video.'
                  : 'Each one opens with a different take of line 1, then takes one of every other line - the one used least, filmed closest to it.'}{' '}
                They wait here when they're made.
              </p>
            </>
          ) : waiting ? (
            <p className="hint">{waiting}</p>
          ) : null}
        </div>
      ) : null}

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
      ) : null}

      {ready.length > 0 ? (
        <div className="group">
          <div className="group-title">Brand said yes?</div>
          {posting ? (
            <>
              <div className="actions-row format-schedule">
                {SCHEDULE_DAYS.map((days) => (
                  <button key={days} type="button" className="btn primary" disabled={busy !== null} onClick={() => void schedule(days)}>
                    {days === 30 ? 'Over the month' : days === 7 ? 'Schedule for the week' : `Next ${days} days`}
                  </button>
                ))}
              </div>
              <p className="hint">
                {SCHEDULE_DAYS.map((days) => {
                  const slots = plans[days] ?? []
                  return `${days === 30 ? 'The month' : days === 7 ? 'The week' : `${days} days`}: ${daysLine(slots)}`
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
      {viewing ? (
        <ClipViewer
          file={viewing.take}
          note={lines[0]?.id === viewing.line.id ? 'Opens one video' : inVideos(script?.uses[viewing.take.id] ?? 0)}
          onClose={() => setViewing(null)}
          onTakeOut={() => removeTake(viewing.line, viewing.take)}
        />
      ) : null}
    </section>
  )
}

const inVideos = (n: number) => (n === 0 ? 'in no video yet' : `in ${n} video${n === 1 ? '' : 's'}`)

/** "30 takes to open with · 12 made" for the first line, "30 takes" for the rest. */
function takesLine(line: FormatLine, index: number, script: FormatScript): string {
  const n = line.takes.length
  const takes = n === 0 ? 'No takes yet' : `${n} take${n === 1 ? '' : 's'}`
  if (index > 0) return takes
  const made = script.opened.length
  return [n > 0 ? `${takes} to open with` : takes, made > 0 ? `${made} made` : ''].filter(Boolean).join(' · ')
}
