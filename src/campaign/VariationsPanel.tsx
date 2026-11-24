// The Variations screen's own part (More -> Variations, his ask 2026-11-17),
// under the same format cards as a batch: how many different videos the
// hooks and bodies make, Make all, what is being made, and every video made
// in a grid - tap one to watch it (‹ › to the next), then save them all to
// the phone at once. Nothing here is scheduled or posted.

import { useEffect, useMemo, useRef, useState } from 'react'

import type { Angle, Campaign } from './look'
import type { BatchBank } from './batch'
import type { BatchVideo } from './batchRun'
import { FullPage } from './FullPage'
import { ChevronLeft, ChevronRight, CloseIcon } from './icons'
import { PHASE_LABEL, canShareFiles, formatTime, share, type Job } from './jobs'
import { forgetJob, heldVideos, loadHeldVideo, type PendingJob } from './store'
import { allVariations, variationVideos, variationsToMake } from './variations'

/** One video made, as the grid shows it. */
interface Made {
  id: string
  name: string
  combo: string
  seconds: number
}

export function VariationsPanel({
  campaign,
  angle,
  bank,
  missing,
  jobs,
  heldVersion,
  onMake,
  onRetry,
  onRemove,
}: {
  campaign: Campaign
  angle: Angle
  bank: BatchBank
  missing: string[]
  /** This campaign's variations being made, or failed, on this phone. */
  jobs: Job[]
  /** Goes up whenever a video is kept: the grid reads them again. */
  heldVersion: number
  onMake: (campaign: Campaign, angle: Angle, videos: BatchVideo[]) => void
  onRetry: (id: string) => void
  onRemove: (id: string) => void
}) {
  const [made, setMade] = useState<Made[]>([])
  const [readAgain, setReadAgain] = useState(0)
  const [watching, setWatching] = useState<number | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [said, setSaid] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void heldVideos().then((rows: PendingJob[]) => {
      if (!alive) return
      setMade(
        rows
          .filter((r) => r.campaignId === campaign.id && r.batch?.variation && r.held)
          .map((r) => ({ id: r.id, name: r.fileName, combo: r.batch!.variation!.combo, seconds: r.held!.duration })),
      )
    })
    return () => {
      alive = false
    }
  }, [campaign.id, heldVersion, readAgain])

  const all = useMemo(() => allVariations(bank), [bank])
  const making = jobs.filter((j) => j.status !== 'failed' && j.status !== 'done')
  const failed = jobs.filter((j) => j.status === 'failed')
  const taken = new Set([...made.map((m) => m.combo), ...jobs.flatMap((j) => (j.batch?.variation ? [j.batch.variation.combo] : []))])
  const toMake = variationsToMake(bank, taken)
  // Each format's hooks and bodies, as he counts them: "9 hooks × 2 bodies".
  const counts = useMemo(() => {
    const by = new Map<string, { name: string; hooks: Set<string>; bodies: Set<string> }>()
    for (const v of all) {
      const one = by.get(v.formatId) ?? { name: v.formatName, hooks: new Set(), bodies: new Set() }
      one.hooks.add(v.hook.id)
      one.bodies.add(v.body.map((f) => f.id).join('+'))
      by.set(v.formatId, one)
    }
    return [...by.values()]
  }, [all])

  const make = () => {
    if (toMake.length === 0) return
    setSaid(null)
    onMake(campaign, angle, variationVideos(bank, toMake))
  }

  const fileOf = async (m: Made, n: number): Promise<File | null> => {
    const blob = await loadHeldVideo(m.id)
    return blob ? new File([blob], `${String(n + 1).padStart(2, '0')} ${m.name.replace(/\.[^./]+$/, '')}.mp4`, { type: 'video/mp4' }) : null
  }

  const saveAll = async (list: Made[]) => {
    setBusy('Getting them ready…')
    setSaid(null)
    try {
      const files = (await Promise.all(list.map((m) => fileOf(m, made.indexOf(m))))).filter((f): f is File => f !== null)
      if (files.length === 0) return setSaid('Those videos are no longer on this phone.')
      if (canShareFiles(files)) {
        if (!(await share(files))) setSaid("They couldn't be shared all at once - try fewer, or one at a time.")
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

  const remove = async (list: Made[]) => {
    for (const m of list) await forgetJob(m.id).catch(() => {})
    setWatching(null)
    setReadAgain((n) => n + 1)
  }

  return (
    <div className="group variations">
      <div className="group-title">
        <span className="vary-num">5</span> Make them
      </div>
      {counts.length > 0 ? (
        <ul className="var-counts">
          {counts.map((c) => (
            <li key={c.name}>
              <span className="row-name">{c.name}</span>
              <span className="hint">
                {c.hooks.size} hook{c.hooks.size === 1 ? '' : 's'} × {c.bodies.size} bod{c.bodies.size === 1 ? 'y' : 'ies'} = {c.hooks.size * c.bodies.size} videos
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {missing.length > 0 ? <p className="hint warn-text">Add {missing.join(', ')} first.</p> : null}
      <button type="button" className="btn primary batch-make" disabled={toMake.length === 0 || missing.length > 0} onClick={make}>
        {toMake.length === 0
          ? all.length > 0 && taken.size >= all.length
            ? 'Every variation is made'
            : 'Make variations'
          : made.length + making.length > 0
            ? `Make the ${toMake.length} not made yet`
            : `Make all ${toMake.length}`}
      </button>
      <p className="hint">
        Each hook once with each body - nothing mixed at random. They stay on this phone: keep the app open with the screen on while they&rsquo;re made,
        about half a minute each. Nothing is posted.
      </p>

      {making.length > 0 ? (
        <div className="batch-progress">
          <div className="label">
            Making {making.length} variation{making.length === 1 ? '' : 's'}
            {making[0]?.status === 'working' ? ` · ${PHASE_LABEL[making[0].phase]} ${making[0].name}` : ''}
          </div>
          <div className="bar">
            <div style={{ width: `${Math.round((making.find((j) => j.status === 'working')?.progress ?? 0) * 100)}%` }} />
          </div>
        </div>
      ) : null}

      {failed.length > 0 ? (
        <div className="batch-failed">
          <div className="label warn-text">{failed.length} couldn&rsquo;t be made</div>
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

      {made.length > 0 ? (
        <>
          <div className="bank-head var-head">
            <span className="group-title">
              Made <span className="bank-count">{made.length}</span>
            </span>
            <button
              type="button"
              className="linkbtn warn-text"
              onClick={() => {
                if (window.confirm(`Delete all ${made.length} variations from this phone? Save the ones you want first.`)) void remove(made)
              }}
            >
              Delete all
            </button>
          </div>
          <ul className="var-grid">
            {made.map((m, i) => (
              <li key={m.id}>
                <button type="button" className="var-cell" onClick={() => setWatching(i)} aria-label={`Watch variation ${i + 1}: ${m.name}`}>
                  <Still id={m.id} />
                  <span className="var-num">{i + 1}</span>
                  <span className="var-len">{formatTime(m.seconds)}</span>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="btn primary wide" disabled={busy !== null} onClick={() => void saveAll(made)}>
            {busy ?? `Save all ${made.length} to my phone`}
          </button>
        </>
      ) : null}
      {said ? <p className="hint warn-text">{said}</p> : null}

      {watching !== null && made[watching] ? (
        <Viewer
          video={made[watching]}
          at={watching}
          of={made.length}
          onPrev={watching > 0 ? () => setWatching(watching - 1) : undefined}
          onNext={watching < made.length - 1 ? () => setWatching(watching + 1) : undefined}
          onSave={() => void saveAll([made[watching]])}
          onDelete={() => {
            if (window.confirm('Delete this variation from this phone?')) void remove([made[watching]])
          }}
          onClose={() => setWatching(null)}
        />
      ) : null}
    </div>
  )
}

/** A made video's object URL, while it is shown. */
function useVideoUrl(id: string): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    let made: string | null = null
    void loadHeldVideo(id).then((blob) => {
      if (!alive || !blob) return
      made = URL.createObjectURL(blob)
      setUrl(made)
    })
    return () => {
      alive = false
      if (made) URL.revokeObjectURL(made)
      setUrl(null)
    }
  }, [id])
  return url
}

/** A grid cell's picture: the video's first moments, never playing. */
function Still({ id }: { id: string }) {
  const url = useVideoUrl(id)
  return url ? <video className="var-still" src={`${url}#t=0.5`} muted playsInline preload="metadata" /> : <span className="var-still" />
}

/** One variation full screen, playing, with the ones either side a tap away. */
function Viewer({
  video,
  at,
  of,
  onPrev,
  onNext,
  onSave,
  onDelete,
  onClose,
}: {
  video: Made
  at: number
  of: number
  onPrev?: () => void
  onNext?: () => void
  onSave: () => void
  onDelete: () => void
  onClose: () => void
}) {
  const url = useVideoUrl(video.id)
  const player = useRef<HTMLVideoElement>(null)
  return (
    <FullPage>
    <div className="var-viewer" role="dialog" aria-label={`Variation ${at + 1} of ${of}`}>
      <div className="var-viewer-head">
        <span className="row-name">
          {at + 1} of {of}
        </span>
        <span className="hint var-viewer-name">{video.name}</span>
        <button type="button" className="clip-editor-close" aria-label="Close" onClick={onClose}>
          <CloseIcon />
        </button>
      </div>
      <div className="var-viewer-video">
        {url ? <video ref={player} key={url} src={url} autoPlay playsInline loop controls /> : <p className="hint">Getting it…</p>}
        <button type="button" className="var-arrow left" aria-label="Previous" disabled={!onPrev} onClick={onPrev}>
          <ChevronLeft />
        </button>
        <button type="button" className="var-arrow right" aria-label="Next" disabled={!onNext} onClick={onNext}>
          <ChevronRight />
        </button>
      </div>
      <div className="actions-row var-viewer-foot">
        <button type="button" className="btn primary" onClick={onSave}>
          Save to my phone
        </button>
        <button type="button" className="btn danger" onClick={onDelete}>
          Delete
        </button>
      </div>
    </div>
    </FullPage>
  )
}
