// Silence Cutter, on its own.
//
// This used to live inside the UGC planner, behind a button on a screen that
// only appeared when a video was waiting to be edited. That was the wrong
// home for it: it is a tool, used at a different moment, on a different
// device, and it dragged a 40MB speech model and a whole video pipeline into
// an app whose first job is to load instantly on bad signal. So it moved out.
//
// No account, no sync, no server. Videos are read, cut and handed back
// entirely on this device - nothing is uploaded anywhere, which is also why
// it can work with the network off once it has been opened once.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { isFillerWordDetectionSupported } from './media/fillerWords'
import { forgetJob, loadPendingJobs, persistJob } from './media/jobStore'
import { PRESETS, type PresetName, type SilenceSettings } from './media/silenceMath'
import {
  SilenceCutError,
  cutSilenceFromFile,
  isSilenceCutSupported,
  type SilenceCutResult,
} from './media/silenceCut'

const PRESET_ORDER: PresetName[] = ['natural', 'balanced', 'tight']
const PRESET_LABEL: Record<PresetName, string> = {
  natural: 'Natural',
  balanced: 'Balanced',
  tight: 'Tight',
}
const PRESET_HINT: Record<PresetName | 'custom', string> = {
  natural: 'Relaxed. Keeps short pauses so it still sounds conversational.',
  balanced: 'The default. Removes awkward pauses, keeps a natural rhythm.',
  tight: 'Fast pacing. Cuts almost every pause.',
  custom: 'Your own settings.',
}

type Settings = SilenceSettings & { preset: PresetName | 'custom' }

type Job = {
  id: string
  file: File
  settings: SilenceSettings
  cleanSpeech: boolean
  status: 'queued' | 'working' | 'done' | 'failed'
  phase: 'downloading' | 'transcribing' | 'cutting'
  progress: number
  result?: SilenceCutResult
  url?: string
  error?: string
}

const PHASE_LABEL: Record<Job['phase'], string> = {
  downloading: 'Getting the speech model',
  transcribing: 'Listening for "um"s',
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

/** True when this browser can hand video files to the OS share sheet. On iOS
 *  that sheet is where CapCut appears, and where "Save Video" writes to the
 *  camera roll. No browser can push a file into another app on its own - that
 *  gate is shut everywhere, on purpose - so the sheet is the whole of what
 *  "export automatically" can honestly mean here. */
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
  const [cleanSpeech, setCleanSpeech] = useState(true)
  const [fineTuneOpen, setFineTuneOpen] = useState(false)
  const [jobs, setJobs] = useState<Job[]>([])
  const [restored, setRestored] = useState(0)
  const [justAdded, setJustAdded] = useState<{ count: number; at: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
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

  // Anything that was still queued when this was last open comes back. A
  // video is written to storage the moment it is added, so closing the tab,
  // the phone killing it for memory, or a reload cannot lose it.
  useEffect(() => {
    let cancelled = false
    void loadPendingJobs().then((pending) => {
      if (cancelled || pending.length === 0) return
      setJobs((current) => [
        ...pending.map((p) => ({
          id: p.id,
          file: p.file,
          settings: p.settings,
          cleanSpeech: p.detectFillerWords,
          status: 'queued' as const,
          phase: 'cutting' as const,
          progress: 0,
        })),
        ...current,
      ])
      setRestored(pending.length)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!justAdded) return
    const timer = window.setTimeout(() => setJustAdded(null), 4000)
    return () => window.clearTimeout(timer)
  }, [justAdded])

  // One at a time. A phone's encoder is already working hard on a single
  // video; two at once makes both slower and risks running the tab out of
  // memory halfway through a batch.
  useEffect(() => {
    if (processing.current) return
    const next = jobs.find((j) => j.status === 'queued')
    if (!next) return
    processing.current = true
    const setPhase = (phase: Job['phase'], progress: number) =>
      setJobs((js) => js.map((j) => (j.id === next.id ? { ...j, status: 'working', phase, progress } : j)))
    setPhase(next.cleanSpeech ? 'downloading' : 'cutting', 0)

    void (async () => {
      try {
        const result = await cutSilenceFromFile(
          next.file,
          (progress) => setPhase('cutting', progress),
          next.settings,
          next.cleanSpeech
            ? {
                detectFillerWords: true,
                onModelDownload: (progress) => setPhase('downloading', progress),
                onTranscribeProgress: (progress) => setPhase('transcribing', progress),
              }
            : {},
        )
        const url = URL.createObjectURL(result.blob)
        setJobs((js) => js.map((j) => (j.id === next.id ? { ...j, status: 'done', result, url } : j)))
      } catch (err) {
        const message =
          err instanceof SilenceCutError ? err.message : 'Something went wrong cutting this video.'
        setJobs((js) => js.map((j) => (j.id === next.id ? { ...j, status: 'failed', error: message } : j)))
      } finally {
        processing.current = false
        void forgetJob(next.id)
      }
    })()
  }, [jobs])

  const addFiles = useCallback(
    (incoming: Iterable<File> | null) => {
      if (!incoming) return
      const files = videoFilesFrom(incoming)
      if (files.length === 0) return
      const { preset: _preset, ...snapshot } = settings
      const added: Job[] = files.map((file) => ({
        id: String(nextId++),
        file,
        settings: snapshot,
        cleanSpeech: cleanSpeech && speechSupported,
        status: 'queued',
        phase: 'cutting',
        progress: 0,
      }))
      setJobs((current) => [...current, ...added])
      setJustAdded({ count: added.length, at: Date.now() })
      for (const job of added) {
        void persistJob({
          id: job.id,
          fileBlob: job.file,
          fileName: job.file.name,
          fileType: job.file.type,
          settings: job.settings,
          detectFillerWords: job.cleanSpeech,
        }).catch(() => {
          // Already queued in memory; it just would not survive a reload.
        })
      }
    },
    [cleanSpeech, settings, speechSupported],
  )

  // Drag and drop, for when this is open on the laptop rather than the phone.
  // The listeners sit on the window so a file can be let go anywhere on the
  // page, not only on the dotted rectangle.
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

  const clearFinished = useCallback(() => {
    setJobs((current) => {
      for (const j of current) {
        if ((j.status === 'done' || j.status === 'failed') && j.url) URL.revokeObjectURL(j.url)
      }
      return current.filter((j) => j.status === 'queued' || j.status === 'working')
    })
  }, [])

  const finished = useMemo(
    () => jobs.filter((j) => j.status === 'done' && j.result),
    [jobs],
  )

  const summary = useMemo(() => {
    if (jobs.length === 0) return null
    const done = finished.length
    const failed = jobs.filter((j) => j.status === 'failed').length
    const saved = finished.reduce(
      (sum, j) => sum + (j.result!.originalDurationSec - j.result!.newDurationSec),
      0,
    )
    let text = `${done} of ${jobs.length} done`
    if (failed > 0) text += ` · ${failed} failed`
    if (saved > 0) text += ` · ${formatTime(saved)} cut out`
    return text
  }, [finished, jobs])

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-4 px-4 pb-16 pt-6">
      <header className="flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight text-text">Silence Cutter</h1>
        <p className="label text-state-later">On this device</p>
      </header>

      {supported === false ? (
        <div className="flex flex-col gap-2 rounded-xl border border-state-failed/40 bg-state-failed/10 px-4 py-4">
          <p className="text-sm text-text">
            This browser can't cut video yet. It needs iOS 26 / Safari 26 or newer, or Chrome.
          </p>
          <p className="text-sm text-state-later">
            Everything here runs on the device itself, so it depends on what the browser can do.
          </p>
        </div>
      ) : (
        <>
          {restored > 0 ? (
            <div className="flex items-start justify-between gap-3 rounded-xl border border-state-waiting/40 bg-state-waiting/10 px-3 py-2">
              <p className="text-sm text-text">
                Picked up {restored} video{restored === 1 ? '' : 's'} that hadn't finished.
              </p>
              <button
                type="button"
                onClick={() => setRestored(0)}
                aria-label="Dismiss"
                className="shrink-0 rounded px-1 text-state-later active:bg-surface-raised"
              >
                ✕
              </button>
            </div>
          ) : null}

          <Pacing settings={settings} onPreset={(p) => setSettings({ ...PRESETS[p], preset: p })} />

          <details
            className="rounded-xl border border-edge bg-surface px-3 py-2"
            open={fineTuneOpen}
            onToggle={(e) => setFineTuneOpen(e.currentTarget.open)}
          >
            <summary className="cursor-pointer py-1 text-sm text-state-later">Fine-tune</summary>
            <div className="mb-1 mt-3 flex flex-col gap-3">
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
              <p className="meta leading-relaxed text-state-later">
                If words are getting clipped, lower the silence level (try −45). If a noisy room isn't
                getting cut, raise it (try −28). Changes apply to videos added after you change them.
              </p>
            </div>
          </details>

          {speechSupported ? (
            <label className="flex items-start gap-3 rounded-xl border border-edge bg-surface px-3 py-3">
              <input
                type="checkbox"
                checked={cleanSpeech}
                onChange={(e) => setCleanSpeech(e.target.checked)}
                className="mt-0.5 h-5 w-5 shrink-0 accent-state-done"
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-semibold text-text">Also cut "um"s and stumbles</span>
                <span className="meta leading-relaxed text-state-later">
                  Listens to every word on this device and takes out "um" and "uh", plus a small word
                  repeated in a row like "I-I-I". A cut can never reach into the words either side, so
                  it leaves a filler in rather than clip something you meant to say. English only.
                  First video downloads a speech model, and every video takes longer with this on.
                </span>
              </span>
            </label>
          ) : null}

          <input
            ref={fileInput}
            type="file"
            accept="video/*"
            multiple
            className="hidden"
            onChange={(e) => {
              addFiles(e.target.files)
              e.target.value = ''
            }}
          />
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className={[
              'flex min-h-[8rem] flex-col items-center justify-center gap-1.5 rounded-2xl',
              'border-2 border-dashed border-edge bg-surface px-4 text-center transition-colors',
              'active:bg-surface-raised',
              dragging ? 'drop-live' : '',
            ].join(' ')}
          >
            <span className="text-lg font-semibold text-text">
              {dragging ? 'Drop them anywhere' : 'Add videos'}
            </span>
            <span className="text-sm text-state-later">
              Drag them in, or tap to pick - as many at once as you like
            </span>
          </button>

          {justAdded ? (
            <p key={justAdded.at} className="rise-in text-center text-sm text-state-done">
              Added {justAdded.count} video{justAdded.count === 1 ? '' : 's'}
              {justAdded.count > 1 ? ' - check that is everything you picked.' : '.'}
            </p>
          ) : null}

          {jobs.length > 0 ? (
            <>
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-state-later">{summary}</p>
                <button
                  type="button"
                  onClick={clearFinished}
                  className="min-h-tap rounded-lg border border-edge bg-surface px-3 text-sm font-semibold text-state-later active:bg-surface-raised"
                >
                  Clear finished
                </button>
              </div>

              {finished.length > 1 ? <SendAll jobs={finished} /> : null}

              <ul className="flex flex-col gap-2">
                {jobs.map((job) => (
                  <li key={job.id}>
                    <JobCard job={job} />
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </>
      )}

      <footer className="mt-auto pt-6 text-center">
        <p className="meta text-state-later">
          Your videos never leave this device. Add this page to your home screen to keep it one tap away.
        </p>
      </footer>
    </div>
  )
}

function Pacing({
  settings,
  onPreset,
}: {
  settings: Settings
  onPreset: (preset: PresetName) => void
}) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-edge bg-surface px-3 py-3">
      <p className="label text-state-later">{PRESET_HINT[settings.preset]}</p>
      <div className="flex gap-1.5">
        {PRESET_ORDER.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => onPreset(preset)}
            className={[
              'min-h-tap flex-1 rounded-lg text-sm font-semibold transition-colors',
              settings.preset === preset
                ? 'border border-state-now/70 bg-surface-raised text-state-now'
                : 'border border-edge bg-ink text-state-later active:bg-surface-raised',
            ].join(' ')}
          >
            {PRESET_LABEL[preset]}
          </button>
        ))}
      </div>
    </div>
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
    <label className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-sm">
        <span className="text-text">{label}</span>
        <span className="numeric text-state-later">{format(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-6 accent-state-now"
      />
    </label>
  )
}

/** One tap to push the whole finished batch into the share sheet, where
 *  CapCut is one of the apps listed. */
function SendAll({ jobs }: { jobs: Job[] }) {
  const [failed, setFailed] = useState(false)
  const files = useMemo(
    () => jobs.map((j) => new File([j.result!.blob], cutName(j.file.name), { type: 'video/mp4' })),
    [jobs],
  )
  const canSend = useMemo(() => canShareFiles(files), [files])
  if (!canSend || failed) return null

  const send = async () => {
    try {
      await navigator.share({ files })
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      setFailed(true)
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => void send()}
        className="flex min-h-tap items-center justify-center rounded-xl border border-state-done/70 bg-state-done/10 text-base font-semibold text-state-done active:bg-state-done/20"
      >
        Send all {files.length} to CapCut
      </button>
      <p className="meta text-center text-state-later">
        Opens the share sheet with all of them - pick CapCut, or "Save Video" for the camera roll.
      </p>
    </div>
  )
}

function JobCard({ job }: { job: Job }) {
  const [shareFailed, setShareFailed] = useState(false)
  const file = useMemo(
    () =>
      job.result
        ? new File([job.result.blob], cutName(job.file.name), { type: 'video/mp4' })
        : null,
    [job.file.name, job.result],
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

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-edge bg-surface px-3 py-3">
      <p className="truncate text-sm text-text">{job.file.name}</p>

      {job.status === 'queued' ? (
        <p className="text-sm text-state-later">Waiting its turn…</p>
      ) : job.status === 'working' ? (
        <>
          <div className="h-2 overflow-hidden rounded-full bg-ink">
            <div
              className="h-full rounded-full bg-state-now transition-[width] duration-300"
              style={{ width: `${Math.round(job.progress * 100)}%` }}
            />
          </div>
          <p className="label text-state-later">
            {PHASE_LABEL[job.phase]}… {Math.round(job.progress * 100)}%
          </p>
        </>
      ) : job.status === 'done' && job.result && job.url ? (
        <>
          <p className="text-sm text-state-done">
            {formatTime(job.result.originalDurationSec)} → {formatTime(job.result.newDurationSec)} ·{' '}
            {job.result.cuts} pause{job.result.cuts === 1 ? '' : 's'}
            {job.result.fillerWords != null ? ` · ${job.result.fillerWords} "um"` : ''}
            {job.result.stutters ? ` · ${job.result.stutters} stumble` : ''} removed
          </p>
          {canSend && !shareFailed ? (
            <button
              type="button"
              onClick={() => void send()}
              className="flex min-h-tap items-center justify-center rounded-lg border border-state-now/70 bg-surface-raised text-sm font-semibold text-state-now active:bg-surface"
            >
              Send to CapCut
            </button>
          ) : (
            <a
              href={job.url}
              download={cutName(job.file.name)}
              className="flex min-h-tap items-center justify-center rounded-lg border border-state-now/70 bg-surface-raised text-sm font-semibold text-state-now active:bg-surface"
            >
              Save {cutName(job.file.name)}
            </a>
          )}
        </>
      ) : (
        <p className="text-sm text-state-failed">{job.error}</p>
      )}
    </div>
  )
}
