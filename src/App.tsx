// Silence Cutter, on its own and laid out like the desktop tool it came from:
// same header, same pacing card, same fine-tune sliders, same dotted drop
// zone, same job list. The two things the desktop version could do that a web
// page cannot are the two that changed - there is no "Open output folder" on
// a phone, so finished videos go to the share sheet instead, and cutting
// "um"s needs a speech model the desktop version never had, so that is an
// option rather than the default.
//
// No account and no server. The videos are read, cut and handed back on this
// device, which is why there is nothing to sign in to.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { isFillerWordDetectionSupported } from './media/fillerWords'
import {
  MAX_ATTEMPTS,
  claimAttempt,
  forgetJob,
  loadJobFile,
  loadPendingJobs,
  persistJob,
  resetAttempts,
} from './media/jobStore'
import { PRESETS, type PresetName, type SilenceSettings } from './media/silenceMath'
import {
  SilenceCutError,
  cutSilenceFromFile,
  isSilenceCutSupported,
  type SilenceCutResult,
} from './media/silenceCut'
import { UpdateBanner } from './UpdateBanner'

const PRESET_ORDER: PresetName[] = ['natural', 'balanced', 'tight']
const PRESET_LABEL: Record<PresetName, string> = {
  natural: 'Natural',
  balanced: 'Balanced',
  tight: 'Tight',
}
const PRESET_HINT: Record<PresetName | 'custom', string> = {
  natural: 'Relaxed. Keeps short pauses so it sounds conversational.',
  balanced: 'The default. Removes awkward pauses, keeps a natural rhythm.',
  tight: 'Fast TikTok pacing. Cuts almost every pause.',
  custom: 'Custom settings.',
}

type Settings = SilenceSettings & { preset: PresetName | 'custom' }

type Job = {
  id: string
  name: string
  /** Held in memory for a video added this session. One restored from a
   *  previous visit has none until its turn comes, so ten videos' bytes are
   *  not all read back at startup. */
  file: File | null
  settings: SilenceSettings
  cleanSpeech: boolean
  status: 'queued' | 'held' | 'working' | 'done' | 'failed'
  phase: 'model' | 'listening' | 'cutting'
  progress: number
  result?: SilenceCutResult
  url?: string
  error?: string
}

const PHASE_LABEL: Record<Job['phase'], string> = {
  model: 'Getting the speech model',
  listening: 'Listening for "um"s',
  cutting: 'Cutting',
}

function formatTime(seconds: number): string {
  const s = Math.round(seconds)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function cutName(originalName: string): string {
  const base = originalName.replace(/\.[^./]+$/, '')
  return `${base || 'video'}_cut.mp4`
}

function canShareFiles(files: File[]): boolean {
  if (typeof navigator === 'undefined' || !navigator.canShare) return false
  try {
    return navigator.canShare({ files })
  } catch {
    return false
  }
}

const VIDEO_PATTERN = /\.(mov|mp4|m4v|mkv|avi|webm|mts|3gp)$/i

function videoFilesFrom(list: Iterable<File>): File[] {
  return Array.from(list).filter((f) => f.type.startsWith('video/') || VIDEO_PATTERN.test(f.name))
}

let nextId = 0

export function App() {
  const [supported, setSupported] = useState<boolean | null>(null)
  const [settings, setSettings] = useState<Settings>({ ...PRESETS.balanced, preset: 'balanced' })
  // Off by default. It pulls down a speech model and roughly doubles the work
  // per video; the plain silence cut is the thing that already works well.
  const [cleanSpeech, setCleanSpeech] = useState(false)
  const [jobs, setJobs] = useState<Job[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const picker = useRef<HTMLInputElement>(null)
  const processing = useRef(false)
  const speechSupported = useMemo(() => isFillerWordDetectionSupported(), [])

  useEffect(() => {
    let cancelled = false
    void isSilenceCutSupported().then((ok) => {
      if (!cancelled) setSupported(ok)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Anything still waiting from last time comes back. A video that has
  // already been tried to the limit comes back *held* rather than running, so
  // one heavy clip cannot put the page into a crash-and-reload loop.
  useEffect(() => {
    let cancelled = false
    void loadPendingJobs().then((pending) => {
      if (cancelled || pending.length === 0) return
      const restored: Job[] = pending.map((p) => ({
        id: p.id,
        name: p.fileName,
        file: null,
        settings: p.settings,
        cleanSpeech: p.cleanSpeech,
        status: p.attempts >= MAX_ATTEMPTS ? ('held' as const) : ('queued' as const),
        phase: 'cutting' as const,
        progress: 0,
      }))
      setJobs((current) => [...restored, ...current])
      const held = restored.filter((j) => j.status === 'held').length
      setNotice(
        held > 0
          ? `${held} video${held === 1 ? '' : 's'} stopped this page more than once, so ${held === 1 ? 'it has' : 'they have'} been left alone. Start it by hand, or remove it. Turning off "um"s uses far less memory.`
          : `Picked up ${restored.length} video${restored.length === 1 ? '' : 's'} that hadn't finished.`,
      )
    })
    return () => {
      cancelled = true
    }
  }, [])

  // One at a time. Two videos at once on a phone makes both slower and is a
  // good way to be killed for using too much memory.
  useEffect(() => {
    if (processing.current) return
    const next = jobs.find((j) => j.status === 'queued')
    if (!next) return
    processing.current = true

    const patch = (fields: Partial<Job>) =>
      setJobs((js) => js.map((j) => (j.id === next.id ? { ...j, ...fields } : j)))
    const setPhase = (phase: Job['phase'], progress: number) =>
      patch({ status: 'working', phase, progress })

    void (async () => {
      try {
        // Counted before any work happens, so a tab that dies mid-cut still
        // remembers it tried.
        const allowed = await claimAttempt(next.id)
        if (!allowed) {
          patch({
            status: 'held',
            error: 'This one stopped the page twice, so it has been left alone.',
          })
          return
        }

        const file = next.file ?? (await loadJobFile(next.id))
        if (!file) {
          patch({ status: 'failed', error: 'That video is no longer available on this device.' })
          await forgetJob(next.id)
          return
        }

        setPhase(next.cleanSpeech ? 'model' : 'cutting', 0)
        const result = await cutSilenceFromFile(
          file,
          (progress) => setPhase('cutting', progress),
          next.settings,
          next.cleanSpeech
            ? {
                detectFillerWords: true,
                onModelDownload: (progress) => setPhase('model', progress),
                onTranscribeProgress: (progress) => setPhase('listening', progress),
              }
            : {},
        )
        patch({ status: 'done', result, url: URL.createObjectURL(result.blob) })
        await forgetJob(next.id)
      } catch (err) {
        const message =
          err instanceof SilenceCutError ? err.message : 'Something went wrong cutting this video.'
        patch({ status: 'failed', error: message })
        await forgetJob(next.id)
      } finally {
        processing.current = false
        // And then ask for another look. This effect only goes hunting for
        // work when `jobs` changes, and every change this run made - marking
        // the video done, held or failed - happened while the flag above was
        // still set, so each of them was turned away. Without this nudge the
        // queue moves exactly one video per drop: the rest sit at "waiting in
        // line" until something unrelated re-renders the list.
        setJobs((js) => [...js])
      }
    })()
  }, [jobs])

  const addFiles = useCallback(
    (incoming: Iterable<File> | null) => {
      if (!incoming) return
      const files = videoFilesFrom(incoming)
      if (files.length === 0) return
      const { preset: _preset, ...snapshot } = settings
      const useSpeech = cleanSpeech && speechSupported
      const added: Job[] = files.map((file) => ({
        id: `${Date.now()}-${nextId++}`,
        name: file.name,
        file,
        settings: snapshot,
        cleanSpeech: useSpeech,
        status: 'queued',
        phase: 'cutting',
        progress: 0,
      }))
      setJobs((current) => [...current, ...added])
      setNotice(null)
      for (const job of added) {
        void persistJob({
          id: job.id,
          fileBlob: job.file!,
          fileName: job.name,
          fileType: job.file!.type,
          settings: job.settings,
          cleanSpeech: job.cleanSpeech,
        }).catch(() => {
          // Still queued in memory; it just would not survive a reload.
        })
      }
    },
    [cleanSpeech, settings, speechSupported],
  )

  // Dropping works anywhere on the page, not only on the dotted rectangle.
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
      if (e.dataTransfer?.files) addFiles(e.dataTransfer.files)
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
  }, [addFiles])

  const startHeld = useCallback((id: string) => {
    // The count goes back to zero because he asked for this one specifically.
    // Without that it would claim an attempt already spent and hold straight
    // back, and the button would do nothing.
    void resetAttempts(id).finally(() => {
      setJobs((js) => js.map((j) => (j.id === id ? { ...j, status: 'queued', error: undefined } : j)))
    })
  }, [])

  const removeJob = useCallback((id: string) => {
    setJobs((js) => {
      const going = js.find((j) => j.id === id)
      if (going?.url) URL.revokeObjectURL(going.url)
      return js.filter((j) => j.id !== id)
    })
    void forgetJob(id)
  }, [])

  const clearFinished = useCallback(() => {
    setJobs((current) => {
      for (const j of current) {
        if ((j.status === 'done' || j.status === 'failed') && j.url) URL.revokeObjectURL(j.url)
      }
      return current.filter((j) => j.status !== 'done' && j.status !== 'failed')
    })
  }, [])

  const finished = useMemo(() => jobs.filter((j) => j.status === 'done' && j.result), [jobs])

  const summary = useMemo(() => {
    if (jobs.length === 0) return ''
    const failed = jobs.filter((j) => j.status === 'failed').length
    const saved = finished.reduce(
      (sum, j) => sum + (j.result!.originalDurationSec - j.result!.newDurationSec),
      0,
    )
    let text = `${finished.length} of ${jobs.length} done`
    if (failed > 0) text += ` · ${failed} failed`
    if (saved > 0) text += ` · ${formatTime(saved)} of dead air removed`
    return text
  }, [finished, jobs])

  const shareAll = useMemo(
    () => finished.map((j) => new File([j.result!.blob], cutName(j.name), { type: 'video/mp4' })),
    [finished],
  )
  const canShareAll = useMemo(
    () => shareAll.length > 1 && canShareFiles(shareAll),
    [shareAll],
  )

  return (
    <main>
      <header>
        <h1>✂️ Silence Cutter</h1>
        <span className="hint">Runs on this device. Nothing is uploaded.</span>
      </header>
      <p className="sub">
        Drop in your raw videos and get back copies with the dead air removed, ready for CapCut.
      </p>

      <UpdateBanner />

      {supported === false ? (
        <div className="error">
          This browser can't cut video yet - it needs iOS 26 / Safari 26 or newer, or Chrome.
          Everything here runs on the device itself, so it depends on what the browser can do.
        </div>
      ) : (
        <>
          {notice ? (
            <div className="notice">
              <span>{notice}</span>
              <button type="button" className="linkbtn" onClick={() => setNotice(null)}>
                Dismiss
              </button>
            </div>
          ) : null}

          <section className="card settings">
            <div className="row">
              <div>
                <div className="label">Pacing</div>
                <div className="hint">{PRESET_HINT[settings.preset]}</div>
              </div>
              <div className="seg">
                {PRESET_ORDER.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    className={settings.preset === preset ? 'active' : ''}
                    onClick={() => setSettings({ ...PRESETS[preset], preset })}
                  >
                    {PRESET_LABEL[preset]}
                  </button>
                ))}
              </div>
            </div>

            <details>
              <summary>Fine-tune</summary>
              <div className="sliders">
                <Slider
                  label="Silence level"
                  value={settings.thresholdDb}
                  min={-60}
                  max={-20}
                  step={1}
                  format={(v) => `${v} dB`}
                  onChange={(v) => setSettings((s) => ({ ...s, thresholdDb: v, preset: 'custom' }))}
                />
                <Slider
                  label="Shortest pause to cut"
                  value={settings.minSilenceSec}
                  min={0.1}
                  max={2}
                  step={0.05}
                  format={(v) => `${v.toFixed(2)} s`}
                  onChange={(v) => setSettings((s) => ({ ...s, minSilenceSec: v, preset: 'custom' }))}
                />
                <Slider
                  label="Breathing room"
                  value={settings.paddingSec}
                  min={0}
                  max={0.4}
                  step={0.01}
                  format={(v) => `${v.toFixed(2)} s`}
                  onChange={(v) => setSettings((s) => ({ ...s, paddingSec: v, preset: 'custom' }))}
                />
                <div className="hint">
                  Silence level: if words are getting cut, lower it (e.g. −45). If a noisy room
                  isn't getting cut, raise it (e.g. −28). Changes apply to videos you add after
                  changing them.
                </div>
              </div>
            </details>

            {speechSupported ? (
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={cleanSpeech}
                  onChange={(e) => setCleanSpeech(e.target.checked)}
                />
                <span>
                  <span className="label">Also cut "um"s and stumbles</span>
                  <span className="hint" style={{ display: 'block' }}>
                    Listens to every word on this device and takes out "um" and "uh", plus a small
                    word repeated in a row like "I-I-I". English only. Downloads a speech model the
                    first time, and uses a lot more memory - if a video keeps stopping the page,
                    turn this off.
                  </span>
                </span>
              </label>
            ) : null}
          </section>

          <input
            ref={picker}
            type="file"
            accept="video/*,.mov,.mp4,.m4v,.mkv,.avi,.webm"
            multiple
            hidden
            onChange={(e) => {
              addFiles(e.target.files)
              e.target.value = ''
            }}
          />
          <button
            type="button"
            className={dragging ? 'drop over' : 'drop'}
            aria-label="Add videos"
            onClick={() => picker.current?.click()}
          >
            <div className="icon">🎬</div>
            <div className="big">{dragging ? 'Drop them anywhere' : 'Drop videos here'}</div>
            <div className="hint">
              or tap to choose files · MP4, MOV and more · as many as you want
            </div>
          </button>

          <div className="toolbar">
            <div className="hint">{summary}</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn" onClick={clearFinished}>
                Clear finished
              </button>
              {canShareAll ? <SendAll files={shareAll} /> : null}
            </div>
          </div>

          <div className="jobs">
            {jobs.length === 0 ? (
              <div className="empty">No videos yet.</div>
            ) : (
              jobs.map((job) => (
                <JobCard key={job.id} job={job} onStart={startHeld} onRemove={removeJob} />
              ))
            )}
          </div>
        </>
      )}
    </main>
  )
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  format: (v: number) => string
  onChange: (v: number) => void
}) {
  return (
    <label className="slider">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <output>{format(value)}</output>
    </label>
  )
}

/** The desktop tool's "Open output folder", in the only form a web page has:
 *  the share sheet, with the whole finished batch in it at once. */
function SendAll({ files }: { files: File[] }) {
  const [failed, setFailed] = useState(false)
  if (failed) return null
  const send = async () => {
    try {
      await navigator.share({ files })
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      setFailed(true)
    }
  }
  return (
    <button type="button" className="btn primary" onClick={() => void send()}>
      Send all {files.length} to CapCut
    </button>
  )
}

function JobCard({
  job,
  onStart,
  onRemove,
}: {
  job: Job
  onStart: (id: string) => void
  onRemove: (id: string) => void
}) {
  const [shareFailed, setShareFailed] = useState(false)
  const file = useMemo(
    () => (job.result ? new File([job.result.blob], cutName(job.name), { type: 'video/mp4' }) : null),
    [job.name, job.result],
  )
  const canSend = useMemo(() => (file ? canShareFiles([file]) : false), [file])

  const send = async () => {
    if (!file) return
    try {
      await navigator.share({ files: [file] })
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      setShareFailed(true)
    }
  }

  const statusText =
    job.status === 'queued'
      ? 'Waiting in line'
      : job.status === 'held'
        ? 'Held back'
        : job.status === 'working'
          ? `${PHASE_LABEL[job.phase]}… ${Math.round(job.progress * 100)}%`
          : job.status === 'done'
            ? 'Done'
            : 'Failed'

  return (
    <div className="job">
      <div className="job-top">
        <div className="name">{job.name}</div>
        <div className="right">
          <span
            className={`status${job.status === 'done' ? ' done' : job.status === 'failed' ? ' failed' : ''}`}
          >
            {statusText}
          </span>
          {job.status === 'queued' || job.status === 'held' ? (
            <button type="button" className="linkbtn" onClick={() => onRemove(job.id)}>
              Remove
            </button>
          ) : null}
        </div>
      </div>

      {job.status === 'working' ? (
        <div className="bar">
          <div style={{ width: `${Math.round(job.progress * 100)}%` }} />
        </div>
      ) : null}

      {job.status === 'held' ? (
        <>
          <div className="error">{job.error}</div>
          <div className="result">
            <span className="hint">Turning off "um"s makes it far more likely to get through.</span>
            <button type="button" className="btn" onClick={() => onStart(job.id)}>
              Try this one again
            </button>
          </div>
        </>
      ) : null}

      {job.status === 'done' && job.result && job.url ? (
        <div className="result">
          <span className="pill">
            {formatTime(job.result.originalDurationSec)} → {formatTime(job.result.newDurationSec)} ·{' '}
            {job.result.cuts} pause{job.result.cuts === 1 ? '' : 's'}
            {job.result.fillerWords ? ` · ${job.result.fillerWords} "um"` : ''}
            {job.result.stutters ? ` · ${job.result.stutters} stumble` : ''} removed
          </span>
          {canSend && !shareFailed ? (
            <button type="button" className="btn primary" onClick={() => void send()}>
              Send to CapCut
            </button>
          ) : (
            <a className="btn" href={job.url} download={cutName(job.name)}>
              Save {cutName(job.name)}
            </a>
          )}
        </div>
      ) : null}

      {job.status === 'failed' ? <div className="error">{job.error}</div> : null}
    </div>
  )
}
