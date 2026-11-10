// Silence Cutter, on its own and laid out like the desktop tool it came from:
// same header, same pacing card, same fine-tune sliders, same drop zone, same
// job list. The two things the desktop version could do that a web page
// cannot are the two that changed - there is no "Open output folder" on a
// phone, so finished videos go to the share sheet instead, and cutting "um"s
// needs a speech model the desktop version never had, so that is an option
// rather than the default.
//
// No account and no server. The videos are read, cut and handed back on this
// device, which is why there is nothing to sign in to.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { CloseIcon, UploadIcon } from './campaign/icons'
import { cuesToSrt, type CaptionCue } from './media/captions'
import { isFillerWordDetectionSupported } from './media/fillerWords'
import {
  MAX_ATTEMPTS,
  claimAttempt,
  forgetJob,
  forgetFile,
  loadJobFile,
  loadPendingJobs,
  persistJob,
  spaceOnDevice,
  recordFailure,
  recordPhase,
  resetAttempts,
  updateJobOptions,
} from './media/jobStore'
import { forgetCut } from './media/outputSink'
import { PRESETS, type PresetName, type SilenceSettings } from './media/silenceMath'
import {
  SilenceCutError,
  cutSilenceFromFile,
  isSilenceCutSupported,
  type SilenceCutResult,
} from './media/silenceCut'
import { pageLeaving } from './leaving'
import { within } from './media/within'
import { keepScreenOn } from './campaign/wakeLock'
import { lostPick, pickArrived, pickSaved, whenPickGoesWrong } from './pickWatch'
import { report } from './report'
import { canShareFiles, shareFiles, type ShareOutcome } from './share'
import { UpdateBanner, safeToReloadWith } from './UpdateBanner'
import { VideoPicker, videoFilesFrom } from './VideoPicker'
import { HELD_LINE, HELD_TEXT, PHASE, PHASE_DOING, count, heldNotice, pickedUpNotice } from './words'

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
  /** Its row - and copy, unless let go to make room - is in the queue
   *  store, so Try again can read it back even with no file in hand. */
  kept?: boolean
  /** Said on a finished video that was cut without what was asked for. */
  note?: string
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

// --- What he set last time ------------------------------------------------------
//
// Pacing, the sliders and the two switches are kept on this phone, so a
// visit starts where the last one left off rather than back on Balanced with
// everything off.

const PREFS_KEY = 'cut.prefs'

interface Prefs {
  settings: Settings
  cleanSpeech: boolean
  wantCaptions: boolean
}

const DEFAULT_PREFS: Prefs = { settings: { ...PRESETS.balanced, preset: 'balanced' }, cleanSpeech: false, wantCaptions: false }

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (!raw) return DEFAULT_PREFS
    const stored = JSON.parse(raw) as Partial<Prefs>
    const s = stored.settings
    const numbers = s && [s.thresholdDb, s.minSilenceSec, s.paddingSec].every((n) => typeof n === 'number' && Number.isFinite(n))
    const preset: Settings['preset'] = s?.preset && s.preset in PRESETS ? s.preset : 'custom'
    return {
      settings: numbers ? { thresholdDb: s.thresholdDb, minSilenceSec: s.minSilenceSec, paddingSec: s.paddingSec, preset } : DEFAULT_PREFS.settings,
      cleanSpeech: stored.cleanSpeech === true,
      wantCaptions: stored.wantCaptions === true,
    }
  } catch {
    return DEFAULT_PREFS
  }
}

function savePrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // Private mode or storage blocked: just not remembered.
  }
}

let nextId = 0

export function App() {
  const [supported, setSupported] = useState<boolean | null>(null)
  const [prefs] = useState(loadPrefs)
  const [settings, setSettings] = useState<Settings>(prefs.settings)
  // Off by default. It pulls down a speech model and roughly doubles the work
  // per video; the plain silence cut is the thing that already works well.
  const [cleanSpeech, setCleanSpeech] = useState(prefs.cleanSpeech)
  // Also off by default, and also transcribes - same memory cost as above.
  // Independent of cleanSpeech: asking for either turns on transcription
  // once, and either or both can be on for a given video.
  const [wantCaptions, setWantCaptions] = useState(prefs.wantCaptions)
  const [jobs, setJobs] = useState<Job[]>([])
  const jobsRef = useRef(jobs)
  useEffect(() => {
    jobsRef.current = jobs
  }, [jobs])
  const [notice, setNotice] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const processing = useRef(false)
  // Each new video's backup copy, while it is still being written. The cut
  // waits for it: started alongside, the copy could land after the cut had
  // already let it go, doubling the space used mid-cut and bringing a
  // finished video back to run again on the next visit.
  const persisting = useRef(new Map<string, Promise<unknown>>())
  const speechSupported = useMemo(() => isFillerWordDetectionSupported(), [])

  useEffect(() => {
    savePrefs({ settings, cleanSpeech, wantCaptions })
  }, [settings, cleanSpeech, wantCaptions])

  // The screen stays on while there is work to do - an iPhone stops a page's
  // work the moment the screen locks, and a long cut outlasts auto-lock. The
  // campaign page has done this all along; this page lost cuts to it.
  const busy = jobs.some((j) => j.status === 'working' || j.status === 'queued')
  useEffect(() => {
    keepScreenOn(busy)
    return () => keepScreenOn(false)
  }, [busy])

  useEffect(() => {
    let cancelled = false
    void isSilenceCutSupported().then((ok) => {
      if (!cancelled) setSupported(ok)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // A video picked just before the page restarted never arrived; say so
  // rather than showing an empty list as if nothing happened.
  useEffect(() => {
    const lost = lostPick('cut')
    if (lost) setNotice(lost)
    whenPickGoesWrong(setNotice)
  }, [])

  // Anything still waiting from last time comes back. A video that has
  // already been tried to the limit comes back *held* rather than running, so
  // one heavy clip cannot put the page into a crash-and-reload loop.
  useEffect(() => {
    let cancelled = false
    void loadPendingJobs().then((pending) => {
      if (cancelled || pending.length === 0) return
      const restored: Job[] = pending.map((p) => {
        const held = p.attempts >= MAX_ATTEMPTS
        return {
          id: p.id,
          name: p.fileName,
          file: null,
          settings: p.settings,
          cleanSpeech: p.cleanSpeech,
          wantCaptions: p.wantCaptions,
          status: p.failed ? ('failed' as const) : held ? ('held' as const) : ('queued' as const),
          phase: 'cutting' as const,
          progress: 0,
          lastPhase: p.lastPhase,
          kept: p.hasVideo,
          ...(p.failed ? { error: p.failed } : held ? { error: HELD_TEXT } : {}),
        }
      })
      setJobs((current) => [...restored, ...current])
      const held = restored.filter((j) => j.status === 'held').length
      const back = restored.filter((j) => j.status !== 'failed').length
      const note = held > 0 ? heldNotice(held) : back > 0 ? pickedUpNotice(back) : ''
      // Alongside anything already said - a video lost mid-pick - not over it.
      if (note) setNotice((current) => (current ? `${current} ${note}` : note))
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
    let phase: Job['phase'] = 'reading'
    const setPhase = (entered: Job['phase'], progress: number) => {
      phase = entered
      patch({ status: 'working', phase, progress })
      // Written to disk, not just React state, so it survives the tab being
      // killed outright rather than only a graceful failure - see
      // recordPhase's own comment.
      if (progress === 0) void recordPhase(next.id, phase)
    }

    // The video in hand, for the report when it fails - a restored video
    // has none on its row.
    let loaded: File | null = null
    void (async () => {
      try {
        // A stuck save never holds a video up: it is cut from the copy in
        // hand either way.
        await within(persisting.current.get(next.id) ?? Promise.resolve(), 60_000, undefined)
        persisting.current.delete(next.id)
        // Counted before any work happens, so a tab that dies mid-cut still
        // remembers it tried.
        const allowed = await claimAttempt(next.id)
        if (!allowed) {
          patch({ status: 'held', error: HELD_TEXT })
          return
        }

        const file = next.file ?? (await loadJobFile(next.id))
        loaded = file
        if (!file) {
          // A video brought back from a previous visit whose copy was never
          // kept - too big for the space left, or let go so the cut would
          // fit - and the page closed before it was done.
          patch({
            status: 'failed',
            error: 'The page closed while this was being cut and no copy of it was kept. Add it again.',
          })
          // Storage stalling on the delete never holds the queue - see within.ts.
          await within(forgetJob(next.id), 5000, undefined)
          return
        }

        // The cut is written into the space this site is allowed on the
        // phone, and a long video's cut is nearly as big as the video. Short
        // of room, the write fails deep inside the encoder with nothing that
        // reads as "out of space", so it is checked here and said plainly.
        // The kept copy of the video is only let go when the cut would not
        // fit otherwise - with it kept, a tab killed mid-cut brings the video
        // back for its second go. A video brought back after a restart has
        // no other copy: deleting it here deleted the file mid-read.
        let { free } = await spaceOnDevice()
        const needed = file.size * 1.2
        if (next.file && free !== null && free < needed) {
          await within(forgetFile(next.id), 5000, undefined)
          free += file.size
        }
        if (free !== null && free < needed) {
          throw new SilenceCutError(
            `This video needs about ${Math.ceil(needed / 1e6)} MB of space to cut and this phone will only give the app ${Math.floor(free / 1e6)} MB. Clear some space, or cut it in two halves.`,
          )
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
        if (result.recovered) {
          report({
            page: 'cut',
            kind: 'retried',
            phase: 'cutting',
            message: `Decoder gave up ${result.recovered} time(s) mid-video; carried on from the last frame and finished`,
            video: loaded ?? next.file,
          })
        }
        await within(forgetJob(next.id), 5000, undefined)
      } catch (err) {
        // Cut short by the page going away: it comes back on the next load.
        if (pageLeaving()) return
        // Set from the callbacks while the work ran, which TypeScript cannot see.
        const failedIn = phase as Job['phase']
        const why = err instanceof Error ? err.message : String(err)
        // The speech model could not get the memory it needs to start. On a
        // phone that is the page already holding a lot, and it stays that
        // way: every video after this one failed the same way within a
        // second - twelve in a row. So the video is cut anyway, pauses only,
        // and says what it went without.
        let plainWhy = ''
        if (loaded && /speech model/i.test(why) && /out of memory/i.test(why)) {
          try {
            setPhase('reading', 0)
            const result = await cutSilenceFromFile(loaded, (progress) => setPhase('cutting', progress), next.settings, {
              onAnalyseProgress: (progress) => setPhase('reading', progress),
            })
            const without = [next.cleanSpeech ? '"um"s were left in' : '', next.wantCaptions ? 'no captions were written' : '']
              .filter(Boolean)
              .join(' and ')
            patch({
              status: 'done',
              result,
              url: URL.createObjectURL(result.blob),
              note: `The phone had no memory left for the speech model, so only the pauses were cut${without ? ` - ${without}` : ''}. Close other apps, reload this page and add it again to try with it.`,
            })
            report({ page: 'cut', kind: 'fallback', phase: failedIn, message: why, video: loaded })
            await within(forgetJob(next.id), 5000, undefined)
            return
          } catch (plainErr) {
            if (pageLeaving()) return
            plainWhy = ` Cutting it without the speech model failed too (${plainErr instanceof Error ? plainErr.message : String(plainErr)}).`
          }
        }
        // The real reason, not just "something went wrong" - it is the only
        // way to know what failed on a phone nobody can attach a debugger to.
        // The version goes with the report, not into the sentence.
        const message = err instanceof SilenceCutError ? err.message : `Something went wrong while ${PHASE_DOING[failedIn]} (${why}).${plainWhy}`
        // Kept, row and copy, so Try again works - even after a restart. A
        // passing failure used to take the only copy of a restored video.
        const kept = await within(recordFailure(next.id, message), 5000, false)
        patch({ status: 'failed', error: message, kept })
        report({ page: 'cut', kind: 'failed', phase: failedIn, message, video: loaded ?? next.file })
      } finally {
        processing.current = false
        // And then ask for another look. This effect only goes hunting for
        // work when `jobs` changes, and every change this run made - marking
        // the video done, held or failed - happened while the flag above was
        // still set, so each of them was turned away. Without this nudge the
        // queue moves exactly one video per drop: the rest sit at "Waiting"
        // until something unrelated re-renders the list.
        setJobs((js) => [...js])
      }
    })()
  }, [jobs])

  const addFiles = useCallback(
    (incoming: Iterable<File> | null, fromPicker = false) => {
      if (!incoming) return
      // The picker only offers videos, so everything it hands over is kept:
      // a file it names oddly then fails on its row, where he can see it,
      // instead of vanishing.
      const files = fromPicker ? Array.from(incoming) : videoFilesFrom(incoming)
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
      const saving: Promise<unknown>[] = []
      for (const job of added) {
        const saved = persistJob({
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
        persisting.current.set(job.id, saved)
        saving.push(saved)
      }
      void Promise.all(saving).finally(pickSaved)
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

  /** Tries a held or failed video again - without the speech options too,
   *  when asked, since those are what runs a phone out of memory. */
  const retry = useCallback((id: string, dropSpeech = false) => {
    const job = jobsRef.current.find((j) => j.id === id)
    if (!job) return
    const cleanSpeech = dropSpeech ? false : job.cleanSpeech
    const wantCaptions = dropSpeech ? false : job.wantCaptions
    // The count goes back to zero because he asked for this one specifically.
    // Without that it would claim an attempt already spent and hold straight
    // back, and the button would do nothing.
    void resetAttempts(id).finally(() => {
      if (job.status === 'failed' && job.file && !job.kept) {
        // A failed video with no row any more is kept again for the new go.
        persisting.current.set(
          id,
          persistJob({
            id,
            fileBlob: job.file,
            fileName: job.name,
            fileType: job.file.type,
            settings: job.settings,
            cleanSpeech,
            wantCaptions,
          }).catch(() => {}),
        )
      } else if (dropSpeech) {
        void updateJobOptions(id, { cleanSpeech, wantCaptions })
      }
      setJobs((js) =>
        js.map((j) => (j.id === id ? { ...j, status: 'queued', error: undefined, progress: 0, cleanSpeech, wantCaptions } : j)),
      )
    })
  }, [])

  const removeJob = useCallback((id: string) => {
    setJobs((js) => {
      const going = js.find((j) => j.id === id)
      if (going?.url) URL.revokeObjectURL(going.url)
      if (going?.result?.storedAs) void forgetCut(going.result.storedAs)
      return js.filter((j) => j.id !== id)
    })
    void (persisting.current.get(id) ?? Promise.resolve()).then(() => forgetJob(id))
  }, [])

  const clearFinished = useCallback(() => {
    setJobs((current) => {
      for (const j of current) {
        if ((j.status === 'done' || j.status === 'failed') && j.url) URL.revokeObjectURL(j.url)
        if (j.status === 'done' && j.result?.storedAs) void forgetCut(j.result.storedAs)
        if (j.status === 'failed' && j.kept) void forgetJob(j.id)
      }
      return current.filter((j) => j.status !== 'done' && j.status !== 'failed')
    })
  }, [])

  const finished = useMemo(() => jobs.filter((j) => j.status === 'done' && j.result), [jobs])
  const anyFinished = jobs.some((j) => j.status === 'done' || j.status === 'failed')

  const summary = useMemo(() => {
    if (jobs.length === 0) return ''
    const failed = jobs.filter((j) => j.status === 'failed').length
    const saved = finished.reduce(
      (sum, j) => sum + (j.result!.originalDurationSec - j.result!.newDurationSec),
      0,
    )
    let text = `${finished.length} of ${jobs.length} done`
    if (failed > 0) text += ` · ${failed} failed`
    if (saved >= 0.5) text += ` · ${formatTime(saved)} of dead air removed`
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

  const onPicked = (picked: File[]) => {
    const problem = pickArrived(picked)
    if (problem) setNotice(problem)
    else addFiles(picked, true)
  }

  return (
    <main>
      <header>
        <h1>Silence Cutter</h1>
        <span className="hint">Runs on this phone. Videos never leave it.</span>
      </header>

      <UpdateBanner safeToReload={safeToReloadWith(jobs)} />

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
              <div className="seg" role="group" aria-label="Pacing">
                {PRESET_ORDER.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    aria-pressed={settings.preset === preset}
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
                  Words getting clipped? Lower the silence level. A noisy room not being cut? Raise it. Applies
                  to videos you add next.
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
                    <span className="label">Cut "um"s and stumbles</span>
                    <span className="hint">
                      English only. Leaves one in rather than clip a word.
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
                    <span className="label">Write captions (.srt)</span>
                    <span className="hint">
                      English only. Check the words before you import them.
                    </span>
                  </span>
                </label>
              </>
            ) : null}
          </section>

          {jobs.length > 0 && !dragging ? (
            // With a list to look at, adding more is one button, not half the
            // screen.
            <VideoPicker className="btn add-more" label="Add videos" tip onFiles={onPicked}>
              <UploadIcon /> Add videos
            </VideoPicker>
          ) : (
            <VideoPicker className={dragging ? 'drop over' : 'drop'} label="Add videos" tip onFiles={onPicked}>
              <span className="icon">
                <UploadIcon />
              </span>
              <span className="big">{dragging ? 'Drop them anywhere' : 'Add videos'}</span>
              <span className="hint">MP4, MOV and more</span>
            </VideoPicker>
          )}

          {jobs.length > 0 ? (
            <>
              <div className="toolbar">
                <div className="hint">{summary}</div>
                <div className="actions">
                  {anyFinished ? (
                    <button type="button" className="btn" onClick={clearFinished}>
                      Clear finished
                    </button>
                  ) : null}
                  {canShareAll ? <SendAll files={shareAll} /> : null}
                </div>
              </div>

              <div className="jobs">
                {jobs.map((job) => (
                  <JobCard key={job.id} job={job} onRetry={retry} onRemove={removeJob} />
                ))}
              </div>
            </>
          ) : null}
        </>
      )}

      <p className="footnote">Version {__APP_VERSION__}</p>
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
        aria-valuetext={format(value)}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <output>{format(value)}</output>
    </label>
  )
}

/** A Send button that says when the sheet did not open and should be tapped
 *  again, and gives way to a plain download only when sharing is not on. */
function SendButton({
  files,
  label,
  primary = true,
  fallback,
  onShared,
}: {
  files: File[]
  label: string
  primary?: boolean
  /** The download link shown when this browser cannot share the files. */
  fallback: { href: string; download: string; label: string } | null
  onShared?: () => void
}) {
  const [outcome, setOutcome] = useState<ShareOutcome>('shared')
  const [busy, setBusy] = useState(false)
  const canSend = useMemo(() => canShareFiles(files), [files])
  if (!canSend || outcome === 'unsupported') {
    return fallback ? (
      <a className="btn" href={fallback.href} download={fallback.download}>
        {fallback.label}
      </a>
    ) : null
  }
  const send = async () => {
    if (busy) return
    setBusy(true)
    const result = await shareFiles(files)
    setBusy(false)
    setOutcome(result)
    if (result === 'shared') onShared?.()
  }
  return (
    <span className="send">
      <button type="button" className={primary ? 'btn primary' : 'btn'} disabled={busy} onClick={() => void send()}>
        {label}
      </button>
      {outcome === 'retry' ? <span className="hint">Tap again</span> : null}
    </span>
  )
}

/** The desktop tool's "Open output folder", in the only form a web page has:
 *  the share sheet, with the whole finished batch in it at once. */
function SendAll({ files }: { files: File[] }) {
  return <SendButton files={files} label={`Share all ${files.length}`} fallback={null} />
}

function JobCard({
  job,
  onRetry,
  onRemove,
}: {
  job: Job
  onRetry: (id: string, dropSpeech?: boolean) => void
  onRemove: (id: string) => void
}) {
  const file = useMemo(
    () => (job.result ? new File([job.result.blob], cutName(job.name), { type: 'video/mp4' }) : null),
    [job.name, job.result],
  )
  const working = job.status === 'working'
  const usesSpeech = job.cleanSpeech || job.wantCaptions
  const hasCaptions = (job.result?.captionCues?.length ?? 0) > 0

  const statusText =
    job.status === 'queued' ? 'Waiting' : job.status === 'held' ? HELD_LINE : job.status === 'done' ? 'Done' : 'Failed'

  return (
    <div className="job">
      <div className="job-top">
        <div className="name">{job.name}</div>
        <div className="right">
          {working ? null : (
            <span
              className={`status${job.status === 'done' ? ' done' : job.status === 'failed' || job.status === 'held' ? ' failed' : ''}`}
            >
              {statusText}
            </span>
          )}
          {working ? null : (
            <button type="button" className="linkbtn" onClick={() => onRemove(job.id)}>
              Remove
            </button>
          )}
        </div>
      </div>

      {working ? (
        <>
          <div className="working">
            <span className="status">{PHASE[job.phase]}</span>
            <span className="status">{Math.round(job.progress * 100)}%</span>
          </div>
          <div className="bar">
            <div style={{ width: `${Math.round(job.progress * 100)}%` }} />
          </div>
        </>
      ) : null}

      {job.status === 'held' ? (
        <>
          <div className="error">
            {job.error ?? HELD_TEXT}
            {job.lastPhase ? ` It got as far as ${PHASE_DOING[job.lastPhase]}.` : ''}
          </div>
          <div className="result">
            <span className="hint">{usesSpeech ? 'Without "um"s and captions it needs far less memory.' : ''}</span>
            <div className="actions">
              <button type="button" className="btn" onClick={() => onRetry(job.id)}>
                Try again
              </button>
              {usesSpeech ? (
                <button type="button" className="btn" onClick={() => onRetry(job.id, true)}>
                  Try without "um"s and captions
                </button>
              ) : null}
            </div>
          </div>
        </>
      ) : null}

      {job.status === 'done' && job.result && job.url ? (
        <>
          <div className="result">
            <span className="pill">
              {formatTime(job.result.originalDurationSec)} → {formatTime(job.result.newDurationSec)} ·{' '}
              {count(job.result.cuts, 'pause')}
              {job.result.fillerWords ? `, ${count(job.result.fillerWords, '"um"', '"um"s')}` : ''}
              {job.result.stutters ? `, ${count(job.result.stutters, 'stumble')}` : ''} removed
            </span>
            {job.note ? <span className="hint">{job.note}</span> : null}
            {hasCaptions || !file ? null : (
              <SendButton files={[file]} label="Share" fallback={{ href: job.url, download: cutName(job.name), label: 'Save video' }} />
            )}
          </div>
          {job.wantCaptions && !hasCaptions ? (
            <div className="hint">No words were heard, so there are no captions.</div>
          ) : null}
          {hasCaptions && file ? (
            <CaptionsEditor cues={job.result.captionCues!} videoName={job.name} videoFile={file} videoUrl={job.url} />
          ) : null}
        </>
      ) : null}

      {job.status === 'failed' ? (
        <>
          <div className="error">
            {job.error}
            {job.lastPhase ? ` Before the page reloaded, it got as far as ${PHASE_DOING[job.lastPhase]}.` : ''}
          </div>
          {job.file || job.kept ? (
            <div className="result">
              <span className="hint">{usesSpeech ? 'Without "um"s and captions it needs far less memory.' : ''}</span>
              <div className="actions">
                <button type="button" className="btn" onClick={() => onRetry(job.id)}>
                  Try again
                </button>
                {usesSpeech ? (
                  <button type="button" className="btn" onClick={() => onRetry(job.id, true)}>
                    Try without "um"s and captions
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
        </>
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
  videoFile: File
  videoUrl: string
}) {
  const [cues, setCues] = useState(initialCues)
  const [captionsSaved, setCaptionsSaved] = useState(false)
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
  const srtFiles = useMemo(() => [srtFile], [srtFile])
  const videoFiles = useMemo(() => [videoFile], [videoFile])

  const updateText = (i: number, text: string) => {
    setCues((cs) => cs.map((c, idx) => (idx === i ? { ...c, text } : c)))
    setCaptionsSaved(false)
  }
  const removeCue = (i: number) => {
    setCues((cs) => cs.filter((_, idx) => idx !== i))
    setCaptionsSaved(false)
  }

  // No page can hand a file to a named app, and one share goes to one place,
  // so the captions and the video are two shares: the captions to Files, the
  // video to the editor.
  return (
    <div className="captions">
      <details>
        <summary>
          {count(cues.length, 'caption line')} - check them before saving
        </summary>
        <div className="caption-list">
          {cues.map((cue, i) => (
            <div className="caption-row" key={i}>
              <span className="caption-time">
                {formatTime(cue.start)}–{formatTime(cue.end)}
              </span>
              <input
                type="text"
                value={cue.text}
                aria-label={`Caption ${i + 1}`}
                onChange={(e) => updateText(i, e.target.value)}
              />
              <button type="button" className="iconbtn" aria-label="Remove this line" onClick={() => removeCue(i)}>
                <CloseIcon />
              </button>
            </div>
          ))}
        </div>
      </details>
      <div className="steps">
        <SendButton
          files={srtFiles}
          label={captionsSaved ? 'Captions saved' : 'Save captions'}
          primary={!captionsSaved}
          fallback={srtUrl ? { href: srtUrl, download: fileName, label: captionsSaved ? 'Captions saved' : 'Save captions' } : null}
          onShared={() => setCaptionsSaved(true)}
        />
        <SendButton
          files={videoFiles}
          label="Share video"
          primary={captionsSaved}
          fallback={{ href: videoUrl, download: cutName(videoName), label: 'Save video' }}
        />
      </div>
    </div>
  )
}
