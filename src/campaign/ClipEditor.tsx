// One clip of a talking head format, to look at and change (his ask,
// 2026-11-15: "make sure I can easily go to any clip and just modify it,
// meaning I can modify the length ... maybe you can put in 1.1x speed").
// Replaces the quick look (QuickCheck.tsx): the same clip playing whole, in a
// loop, with ‹ › through every clip of the format, and everything he does to
// a clip on the one screen:
// - Speed: 1× to 1.5× - this clip only; the format's speed is on its card.
// - Length: the clip's timeline (its recording, the parts kept, the arrows) -
//   made again from the recording (clipEdit.ts).
// - Mirror, Move to another step or the hooks, Captions (the full caption
//   check), Replace with a video from the phone, Remove.

import { useEffect, useMemo, useRef, useState } from 'react'

import { VideoPicker } from '../VideoPicker'
import type { Range } from '../media/silenceMath'
import type { BankFile, BatchBank, BatchFormat, BatchStep } from './batch'
import { CLIP_SPEEDS, canLengthen, cutOrRaw, isCut, joinTouching, splitAtPieces, filesOfClip, leftBehind, oneAtATime, remakeClip, sourceOf, speedLabel, speedOfClip, swapClip, wantedSpeed } from './clipEdit'
import { CutsEditor } from './CutsEditor'
import { FullPage } from './FullPage'
import { clipsOfFormat, HOOK, placed, withClip, type ClipSource, type PlacedClip } from './dropQueue'
import { ChevronLeft, ChevronRight, CloseIcon } from './icons'
import { formatTime } from './jobs'
import { loadBankFile, retireBankFiles, saveBankFile } from './store'
import { keptWords } from './talkCaptions'
import { downloadFile } from './talkLink'

export function ClipEditor({
  format,
  steps,
  hooks,
  startWith,
  getBank,
  keep,
  onCaptions,
  onReplace,
  onClose,
  names = [],
}: {
  format: BatchFormat
  /** This format's product steps, in order. */
  steps: BatchStep[]
  /** Its hooks (the clips of him at the start). */
  hooks: BankFile[]
  /** The clip to open on (its file id); absent: the first. */
  startWith?: string
  getBank: () => BatchBank | null
  keep: (bank: BatchBank) => void
  /** The full caption check on this clip. */
  onCaptions: (clip: PlacedClip) => void
  /** A video from the phone, edited, to take this clip's place - false when it couldn't be started. */
  onReplace: (file: File, clip: PlacedClip) => boolean
  /** The campaign's brand words, heard right when a clip is cut again. */
  names?: string[]
  onClose: () => void
}) {
  // In the order a video plays them, as on the card: his hooks, then each step.
  const clips = useMemo(() => {
    const all = clipsOfFormat(steps, hooks, keptWords)
    return [...all.filter((c) => c.place === HOOK), ...all.filter((c) => c.place !== HOOK)]
  }, [steps, hooks])
  // Followed by its id: a clip moved or made again stays on screen.
  const [currentId, setCurrentId] = useState<string | null>(startWith ?? null)
  const [lastAt, setLastAt] = useState(0)
  const found = currentId ? clips.findIndex((c) => c.file.id === currentId) : -1
  const index = found >= 0 ? found : Math.min(lastAt, Math.max(0, clips.length - 1))
  const clip = clips[index] ?? null
  const [blob, setBlob] = useState<{ id: string; file: Blob | null } | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [muted, setMuted] = useState(false)
  /** Being made again: what, and how far. */
  const [busy, setBusy] = useState<{ what: string; fraction: number } | null>(null)
  /** The timeline open: the source and its recording (null while loading, 'missing'). */
  const [timeline, setTimeline] = useState<{ source: ClipSource | null; recording: Blob | null | 'missing' } | null>(null)
  const video = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (clip && clip.file.id !== currentId) setCurrentId(clip.file.id)
    if (found >= 0 && found !== lastAt) setLastAt(found)
  }, [clip?.file.id, found]) // eslint-disable-line react-hooks/exhaustive-deps

  // The clip itself: on the phone, or down from the Cutter server.
  useEffect(() => {
    if (!clip) return
    let alive = true
    void (async () => {
      let file: Blob | null = await loadBankFile(clip.file).catch(() => null)
      if (!file) {
        file = await downloadFile(clip.file.id).catch(() => null)
        if (file) await saveBankFile(clip.file.id, file).catch(() => {})
      }
      if (alive) setBlob({ id: clip.file.id, file })
    })()
    return () => {
      alive = false
    }
  }, [clip?.file.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const shown = blob && clip && blob.id === clip.file.id ? blob.file : null
  const url = useMemo(() => (shown ? URL.createObjectURL(shown) : null), [shown])
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url])

  // Played whole from its start, with its sound when the phone lets it.
  const start = () => {
    const v = video.current
    if (!v) return
    v.currentTime = 0
    v.muted = false
    void v.play().then(
      () => setMuted(false),
      () => {
        v.muted = true
        setMuted(true)
        void v.play().catch(() => {})
      },
    )
  }

  if (!clip) {
    return (
      <div className="drop-check-screen clip-viewer">
        <section className="screen review">
          <button type="button" className="back" onClick={onClose}>
            <ChevronLeft /> Batch
          </button>
          <p className="empty">No clips in this format yet.</p>
        </section>
      </div>
    )
  }

  const file = clip.file
  const go = (by: number) => {
    setNote(null)
    const next = clips[Math.min(clips.length - 1, Math.max(0, index + by))]
    if (next) setCurrentId(next.file.id)
  }

  /** The clip made again (speed, or the parts kept) in its place. */
  /** Cut by the Cutter or kept as filmed, from its recording (clipEdit.cutOrRaw). */
  const switchCut = async (on: boolean) => {
    if (busy) return
    setNote(null)
    const what = on ? 'Cutting it' : 'Putting it back as filmed'
    setBusy({ what, fraction: 0 })
    try {
      const made = await oneAtATime(() => cutOrRaw(file, { cut: on, names }, (phase, fraction) => setBusy({ what: phase === 'cutting' ? what : 'Listening', fraction })))
      const bank = getBank()
      if (!bank) return
      keep(swapClip(bank, file.id, made.file))
      void retireBankFiles(leftBehind(file, made.file)).catch(() => {})
      setCurrentId(made.file.id)
    } catch (error) {
      setNote(`Couldn't make it ${on ? 'cut' : 'raw'} (${error instanceof Error ? error.message : String(error)}). The clip is as it was.`)
    } finally {
      setBusy(null)
    }
  }

  const remake = async (what: string, change: { keep?: Range[]; speed: number }, mark: Partial<BankFile> = {}) => {
    setNote(null)
    setBusy({ what, fraction: 0 })
    try {
      const made = await oneAtATime(() => remakeClip({ ...file, ...mark }, change, (fraction) => setBusy({ what, fraction })))
      const bank = getBank()
      if (!bank) return
      keep(swapClip(bank, file.id, made))
      void retireBankFiles(leftBehind(file, made)).catch(() => {})
      setCurrentId(made.id)
    } catch (error) {
      setNote(`Couldn't make it again (${error instanceof Error ? error.message : String(error)}). The clip is as it was.`)
    } finally {
      setBusy(null)
    }
  }

  const setSpeed = (speed: number) => {
    if (busy) return
    const own = speed === (format.speed ?? 1) ? undefined : speed
    const mark: Partial<BankFile> = { speedSet: own }
    if (Math.abs(speed - speedOfClip(file)) < 0.001) {
      const bank = getBank()
      if (bank) keep(withClip(bank, file.id, mark))
      return
    }
    void remake(`Making it ${speedLabel(speed)}`, { speed }, mark)
  }

  const openTimeline = () => {
    setNote(null)
    setTimeline({ source: null, recording: null })
    void sourceOf(file).then((from) => setTimeline((t) => (t ? (from ? { source: from.source, recording: from.recording } : { source: null, recording: 'missing' }) : t)))
  }

  const mirror = () => {
    const bank = getBank()
    if (bank) keep(withClip(bank, file.id, { mirror: file.mirror ? undefined : true }))
  }
  const move = (to: string) => {
    const bank = getBank()
    if (!bank || to === clip.place) return
    keep(placed(bank, format.id, file, to))
  }
  const remove = () => {
    const bank = getBank()
    if (!bank || !window.confirm(`Take ${file.name} out of the batch?`)) return
    keep(placed(bank, format.id, file, null))
    void retireBankFiles(filesOfClip(file)).catch(() => {})
    setNote(null)
    setCurrentId(null)
  }

  // The timeline over the whole screen: Done makes the clip again.
  if (timeline) {
    const { source, recording } = timeline
    // A clip he didn't have cut is one part on its timeline, not its zoom pieces.
    const shownParts = source ? (file.ownCut ? joinTouching(source.keep) : source.keep) : []
    return (
      <FullPage>
        <CutsEditor
          name={file.name}
          file={recording instanceof Blob ? recording : null}
          missing={recording === 'missing'}
          duration={source?.duration ?? file.seconds ?? 0}
          initial={shownParts}
          words={source?.words ?? []}
          onDone={(kept) => {
            setTimeline(null)
            if (!source || JSON.stringify(kept) === JSON.stringify(shownParts)) return
            // Kept whole: its zoom pieces again inside what he kept.
            const parts = file.ownCut ? splitAtPieces(kept, source.keep) : kept
            void remake('Making it again', { keep: parts, speed: speedOfClip(file) })
          }}
          onCancel={() => setTimeline(null)}
          cutsOnly
        />
      </FullPage>
    )
  }

  const stepAt = steps.findIndex((s) => s.id === clip.place)
  const where = clip.place === HOOK ? 'Hook' : stepAt >= 0 ? `${stepAt + 1} · ${steps[stepAt].name}` : ''
  const speed = speedOfClip(file)
  const wanted = wantedSpeed(file, format)

  return (
    <div className={`drop-check-screen clip-viewer clip-editor${file.mirror ? ' mirrored' : ''}`}>
      <section className="screen review">
        {/* Always in reach, top right: out of the clips (his report,
            2026-11-15: "I cannot leave the page"). */}
        <div className="clip-editor-head">
          <span className="clip-editor-title">
            <span className="row-name">
              Clip {index + 1} of {clips.length}
            </span>
            <span className="clip-viewer-where">
              {where}
              {file.seconds ? <span className="hint"> · {formatTime(file.seconds)}</span> : null}
            </span>
          </span>
          <button type="button" className="clip-editor-close" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        <div className="clip-viewer-frame">
          {/* The previous and next clip, big over each side of the video. */}
          {index > 0 && !busy ? (
            <button type="button" className="clip-editor-arrow left" aria-label="Previous clip" onClick={() => go(-1)}>
              <ChevronLeft />
            </button>
          ) : null}
          {index < clips.length - 1 && !busy ? (
            <button type="button" className="clip-editor-arrow right" aria-label="Next clip" onClick={() => go(1)}>
              <ChevronRight />
            </button>
          ) : null}
          {busy ? (
            <div className="clip-editor-busy">
              <span className="row-name">
                {busy.what}… {Math.round(busy.fraction * 100)}%
              </span>
              <div className="bar">
                <div style={{ width: `${Math.round(busy.fraction * 100)}%` }} />
              </div>
            </div>
          ) : url ? (
            <video ref={video} className="drop-check-video" src={url} playsInline loop onLoadedData={start} onClick={start} aria-label={file.name} />
          ) : blob && blob.id === file.id && !blob.file ? (
            <p className="hint warn-text">This clip is no longer on this phone or your server.</p>
          ) : (
            <p className="hint">Getting the clip…</p>
          )}
          {muted && url && !busy ? (
            <button type="button" className="btn small clip-viewer-sound" onClick={start}>
              Tap for sound
            </button>
          ) : null}
        </div>
        <button type="button" className="btn wide" disabled={busy !== null} onClick={openTimeline}>
          Length
        </button>
        <div className="clip-editor-row">
          <span className="row-name">Cutter</span>
          <div className="seg full" role="radiogroup" aria-label="Cut by the Cutter or kept raw">
            {([true, false] as const).map((on) => (
              <button
                key={String(on)}
                type="button"
                role="radio"
                aria-checked={isCut(file) === on}
                className={isCut(file) === on ? 'active' : ''}
                disabled={busy !== null}
                onClick={() => isCut(file) !== on && void switchCut(on)}
              >
                {on ? 'Cut' : 'Raw'}
              </button>
            ))}
          </div>
        </div>
        <div className="clip-editor-row">
          <span className="row-name">Speed</span>
          <div className="seg full" role="radiogroup" aria-label="This clip's speed">
            {CLIP_SPEEDS.map((sp) => (
              <button key={sp} type="button" role="radio" aria-checked={wanted === sp} className={wanted === sp ? 'active' : ''} disabled={busy !== null} onClick={() => setSpeed(sp)}>
                {speedLabel(sp)}
              </button>
            ))}
          </div>
        </div>
        {wanted !== speed && !busy ? <p className="hint">Being made {speedLabel(wanted)} - it plays at {speedLabel(speed)} until then.</p> : null}
        <div className="clip-editor-row">
          <span className="row-name">In</span>
          <select className="clip-editor-move" value={clip.place} aria-label="Where this clip goes" disabled={busy !== null} onChange={(e) => move(e.target.value)}>
            {steps.map((st, i) => (
              <option key={st.id} value={st.id}>
                {i + 1} · {st.name}
              </option>
            ))}
            {format.dropHooks || clip.place === HOOK || steps.length === 0 ? <option value={HOOK}>Hook</option> : null}
          </select>
        </div>
        <div className="clip-viewer-actions clip-editor-actions">
          <button type="button" className={`btn small${file.mirror ? ' primary' : ''}`} aria-pressed={Boolean(file.mirror)} disabled={busy !== null} onClick={mirror}>
            {file.mirror ? 'Mirrored' : 'Mirror'}
          </button>
          <button type="button" className="btn small" disabled={busy !== null} onClick={() => onCaptions(clip)}>
            Captions
          </button>
          <VideoPicker
            className="btn small"
            label="Replace with a video from your phone"
            onFiles={(files) => {
              if (files.length === 0) return
              setNote(
                onReplace(files[0], clip)
                  ? `${files[0].name} is being edited - it takes this clip's place once you approve it.`
                  : "Couldn't start it - open this format on the Batch tab and try again.",
              )
            }}
          >
            Replace
          </VideoPicker>
          <button type="button" className="btn small danger" disabled={busy !== null} onClick={remove}>
            Remove
          </button>
        </div>
        {!canLengthen(file) ? <p className="hint">Added before recordings were kept: Length can make it shorter, not longer.</p> : null}
        {note ? <p className="hint warn-text">{note}</p> : null}
      </section>
    </div>
  )
}
