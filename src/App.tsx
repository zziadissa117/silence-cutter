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

import { cuesToSrt, type CaptionCue } from './media/captions'
import { isFillerWordDetectionSupported } from './media/fillerWords'
import {
  MAX_ATTEMPTS,
  claimAttempt,
  forgetJob,
  loadJobFile,
  loadPendingJobs,
  persistJob,
  recordPhase,
  resetAttempts,
} from './media/jobStore'
import { forgetCut } from './media/outputSink'
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
  wantCaptions: boolean
  status: 'queued' | 'held' | 'working' | 'done' | 'failed'
  phase: 'reading' | 'model' | 'listening' | 'cutting'
  progress: number
  result?: SilenceCutResult
  url?: string
  error?: string
  /** The phase this video was last seen entering, for a `held` video only -
   *  see recordPhase's own comment for why this exists and where it comes
   *  from. Undefined for a video that has never been tried. */
  lastPhase?: Job['phase']
}

const PHASE_LABEL: Record<Job['phase'], string> = {
  reading: 'reading the audio',
  model: 'getting the speech model',
  listening: 'listening for words',
  cutting: 'cutting',
}

function phaseLabel(job: Job): string {
  if (job.phase === 'reading') return 'Reading the audio'
  if (job.phase === 'model') return 'Getting the speech model'
  if (job.phase === 'cutting') return 'Cutting'
  if (job.cleanSpeech && job.wantCaptions) return 'Listening for "um"s and writing captions'
  if (job.wantCaptions) return 'Writing captions'
  return 'Listening for "um"s'
}

function formatTime(seconds: number): string {
  const s = Math.round(seconds)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function cutName(originalName: string): string {
  const base = originalName.replace(/\.[^./]+$/, '')
  return `${base || 'video'}_cut.mp4`
}

function srtName(originalName: string): string {
  const base = originalName.replace(/\.[^./]+$/, '')
  return `${base || 'video'}_captions.srt`
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
  // Also off by default, and also transcribes - same memory cost as above.
  // Independent of cleanSpeech: asking for either turns on transcription
  // once, and either or both can be on for a given video.
  const [wantCaptions, setWantCaptions] = useState(false)
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
        wantCaptions: p.wantCaptions,
        status: p.attempts >= MAX_ATTEMPTS ? ('held' as const) : ('queued' as const),
        phase: 'cutting' as const,
        progress: 0,
        lastPhase: p.lastPhase,
      }))
      setJobs((current) => [...restored, ...current])
      const held = restored.filter((j) => j.status === 'held').length
      setNotice(
        held > 0
          ? `${held} video${held === 1 ? '' : 's'} stopped this page more than once, so ${held === 1 ? 'it has' : 'they have'} been left alone. Start it by hand, or remove it. Turning off "um"s or captions uses far less memory.`
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
    const setPhase = (phase: Job['phase'], progress: number) => {
      patch({ status: 'working', phase, progress })
      // Written to disk, not just React state, so it survives the tab being
      // killed outright rather than only a graceful failure - see
      // recordPhase's own comment.
      if (progress === 0) void recordPhase(next.id, phase)
    }

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

        const wantsWords = next.cleanSpeech || next.wantCaptions
        // Reading the audio comes first whatever the options, and on a long
        // take it is minutes of the wait on its own.
        setPhase('reading', 0)
        const result = await cutSilenceFromFile(
          file,
          (progress) => setPhase('cutting', progress),
          next.settings,
          {
            onAnalyseProgress: (progress) => setPhase('reading', progress),
            ...(wantsWords
              ? {
                  detectFillerWords: next.cleanSpeech,
                  detectCaptions: next.wantCaptions,
                  onModelDownload: (progress) => setPhase('model', progress),
                  onTranscribeProgress: (progress) => setPhase('listening', progress),
                }
              : {}),
          },
        )
        patch({ status: 'done', result, url: URL.createObjectURL(result.blob) })
        await forgetJob(next.id)
      } catch (err) {
        // The real reason, not just "something went wrong" - it is the only
        // way to know what failed on a phone nobody can attach a debugger to.
        const message =
          err instanceof SilenceCutError
            ? err.message
            : `Something went wrong cutting this video (${err instanceof Error ? err.message : String(err)}).`
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
      const useCaptions = wantCaptions && speechSupported
      const added: Job[] = files.map((file) => ({
        id: `${Date.now()}-${nextId++}`,
        name: file.name,
        file,
        settings: snapshot,
        cleanSpeech: useSpeech,
        wantCaptions: useCaptions,
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
          wantCaptions: job.wantCaptions,
        }).catch(() => {
          // Still queued in memory; it just would not survive a reload.
        })
      }
    },
    [cleanSpeech, settings, speechSupported, wantCaptions],
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
      if (going?.result?.storedAs) void forgetCut(going.result.storedAs)
      return js.filter((j) => j.id !== id)
    })
    void forgetJob(id)
  }, [])

  const clearFinished = useCallback(() => {
    setJobs((current) => {
      for (const j of current) {
        if ((j.status === 'done' || j.status === 'failed') && j.url) URL.revokeObjectURL(j.url)
        if (j.status === 'done' && j.result?.storedAs) void forgetCut(j.result.storedAs)
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
        Drop in your raw videos and get back copies with the dead air removed, ready for your editor.
      </p>

      {/* Queued and held videos are on disk and come back after a reload; a
          running cut or a finished one is only in this tab's memory. */}
      <UpdateBanner safeToReload={jobs.every((j) => j.status === 'queued' || j.status === 'held')} />

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
              <>
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
                      word repeated in a row like "I-I-I". English only. Only cuts one when there is
                      a real pause around it, so some will be left in rather than risk clipping a
                      word. Downloads a speech model the first time, and uses more memory - if a
                      video keeps stopping the page, turn this off.
                    </span>
                  </span>
                </label>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={wantCaptions}
                    onChange={(e) => setWantCaptions(e.target.checked)}
                  />
                  <span>
                    <span className="label">Also write captions (.srt)</span>
                    <span className="hint" style={{ display: 'block' }}>
                      Transcribes the video on this device and hands back an editable caption file
                      alongside it, timed to match the cut video, ready to check over and import
                      into your editor. English only, and some words will be wrong - check them
                      before you import. Same speech model and memory cost as above - if a video
                      keeps stopping the page, turn this off too.
                    </span>
                  </span>
                </label>
              </>
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
      Send all {files.length}
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
          ? `${phaseLabel(job)}… ${Math.round(job.progress * 100)}%`
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
          <div className="error">
            {job.error}
            {job.lastPhase ? ` It last got as far as: ${PHASE_LABEL[job.lastPhase]}.` : ''}
          </div>
          <div className="result">
            <span className="hint">Turning off "um"s or captions makes it far more likely to get through.</span>
            <button type="button" className="btn" onClick={() => onStart(job.id)}>
              Try this one again
            </button>
          </div>
        </>
      ) : null}

      {job.status === 'done' && job.result && job.url ? (
        <>
          <div className="result">
            <span className="pill">
              {formatTime(job.result.originalDurationSec)} → {formatTime(job.result.newDurationSec)} ·{' '}
              {job.result.cuts} pause{job.result.cuts === 1 ? '' : 's'}
              {job.result.fillerWords ? ` · ${job.result.fillerWords} "um"` : ''}
              {job.result.stutters ? ` · ${job.result.stutters} stumble` : ''} removed
            </span>
            {job.result.captionCues ? null : canSend && !shareFailed ? (
              <button type="button" className="btn primary" onClick={() => void send()}>
                Send
              </button>
            ) : (
              <a className="btn" href={job.url} download={cutName(job.name)}>
                Save {cutName(job.name)}
              </a>
            )}
          </div>
          {job.result.captionCues ? (
            <CaptionsEditor
              cues={job.result.captionCues}
              videoName={job.name}
              videoFile={file}
              videoUrl={job.url}
            />
          ) : null}
        </>
      ) : null}

      {job.status === 'failed' ? (
        <div className="error">
          {job.error}
          {job.lastPhase ? ` Before the page reloaded, it last got as far as: ${PHASE_LABEL[job.lastPhase]}.` : ''}
        </div>
      ) : null}
    </div>
  )
}

/** The captions the model wrote are a starting point, not a finished file -
 *  Whisper gets words wrong sometimes, and there is no way to fix that after
 *  the fact except by reading every line. This is that: every line, editable,
 *  before it ever becomes an .srt on disk. */
function CaptionsEditor({
  cues: initialCues,
  videoName,
  videoFile,
  videoUrl,
}: {
  cues: CaptionCue[]
  videoName: string
  videoFile: File | null
  videoUrl: string
}) {
  const [cues, setCues] = useState(initialCues)
  const [captionsSaved, setCaptionsSaved] = useState(false)
  const [captionShareFailed, setCaptionShareFailed] = useState(false)
  const [videoShareFailed, setVideoShareFailed] = useState(false)
  const [srtUrl, setSrtUrl] = useState<string | null>(null)
  const fileName = srtName(videoName)

  const srtText = useMemo(() => cuesToSrt(cues), [cues])

  useEffect(() => {
    const url = URL.createObjectURL(new Blob([srtText], { type: 'application/x-subrip' }))
    setSrtUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [srtText])

  // Shared as plain text: the share sheet only takes a short list of file
  // types, and .srt is not on it. The name still ends in .srt.
  const srtFile = useMemo(() => new File([srtText], fileName, { type: 'text/plain' }), [srtText, fileName])
  const canShareCaptions = useMemo(() => canShareFiles([srtFile]), [srtFile])
  const canShareVideo = useMemo(() => (videoFile ? canShareFiles([videoFile]) : false), [videoFile])

  const updateText = (i: number, text: string) => {
    setCues((cs) => cs.map((c, idx) => (idx === i ? { ...c, text } : c)))
    setCaptionsSaved(false)
  }
  const removeCue = (i: number) => {
    setCues((cs) => cs.filter((_, idx) => idx !== i))
    setCaptionsSaved(false)
  }

  // No page can hand a file to a named app, and one share goes to one place,
  // so this is two shares: captions first (to Files), because the video goes
  // to the editor and opening it leaves this page behind.
  const shareCaptions = async () => {
    try {
      await navigator.share({ files: [srtFile] })
      setCaptionsSaved(true)
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      setCaptionShareFailed(true)
    }
  }
  const shareVideo = async () => {
    if (!videoFile) return
    try {
      await navigator.share({ files: [videoFile] })
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      setVideoShareFailed(true)
    }
  }

  const captionsLabel = captionsSaved ? '✓ Captions saved' : '1. Save captions to Files'

  return (
    <div className="captions">
      <details>
        <summary>
          {cues.length} caption line{cues.length === 1 ? '' : 's'} - check and edit before saving
        </summary>
        <div className="caption-list">
        {cues.map((cue, i) => (
          <div className="caption-row" key={i}>
            <span className="caption-time">
              {formatTime(cue.start)}–{formatTime(cue.end)}
            </span>
            <input type="text" value={cue.text} onChange={(e) => updateText(i, e.target.value)} />
            <button
              type="button"
              className="linkbtn"
              aria-label="Remove this line"
              onClick={() => removeCue(i)}
            >
              ✕
            </button>
          </div>
        ))}
        </div>
      </details>
      <div className="steps">
        {canShareCaptions && !captionShareFailed ? (
          <button
            type="button"
            className={captionsSaved ? 'btn' : 'btn primary'}
            onClick={() => void shareCaptions()}
          >
            {captionsLabel}
          </button>
        ) : srtUrl ? (
          <a
            className={captionsSaved ? 'btn' : 'btn primary'}
            href={srtUrl}
            download={fileName}
            onClick={() => setCaptionsSaved(true)}
          >
            {captionsSaved ? '✓ Captions saved' : `1. Save ${fileName}`}
          </a>
        ) : null}
        {canShareVideo && !videoShareFailed ? (
          <button
            type="button"
            className={captionsSaved ? 'btn primary' : 'btn'}
            onClick={() => void shareVideo()}
          >
            2. Send video to CapCut
          </button>
        ) : (
          <a className={captionsSaved ? 'btn primary' : 'btn'} href={videoUrl} download={cutName(videoName)}>
            2. Save {cutName(videoName)}
          </a>
        )}
      </div>
      {canShareCaptions || canShareVideo ? (
        <div className="hint">
          Each opens the share sheet: pick "Save to Files" for the captions, then CapCut for the
          video.
        </div>
      ) : null}
    </div>
  )
}
