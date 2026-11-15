// A quick look at every clip of a talking head format (his ask, 2026-11-15:
// "make an option where I can check all, meaning it opens the page and
// automatically plays the full video ... An arrow that goes to next and an
// arrow that goes to previous ... a way to remove that video from the batch,
// or a way to reedit ... or a button that replaces that video with another
// video that we have on our phone ... A button where we can mirror it or
// unmirror it. Just a very quick check ... no captions needed").
//
// Each clip plays whole from its start, in the page (not full screen), over
// and over; the arrows go through them all, step by step. Mirror is saved at
// once; Remove takes it out of the batch; Re-edit opens the full check (where
// it goes, captions, Mirror) on it; Replace edits a video from the phone the
// way the drop-in does and it takes this one's place once he approves it.

import { useEffect, useMemo, useRef, useState } from 'react'

import { VideoPicker } from '../VideoPicker'
import type { BankFile, BatchBank, BatchStep } from './batch'
import { clipsOfFormat, HOOK, placed, withClip, type PlacedClip } from './dropQueue'
import { ChevronLeft, ChevronRight } from './icons'
import { loadBankFile, retireBankFiles, saveBankFile } from './store'
import { keptWords } from './talkCaptions'
import { downloadFile } from './talkLink'

export function QuickCheck({
  formatId,
  steps,
  hooks,
  getBank,
  keep,
  onReedit,
  onReplace,
  onClose,
}: {
  formatId: string
  /** This format's product steps, in order. */
  steps: BatchStep[]
  /** Its hooks (the clips of him at the start). */
  hooks: BankFile[]
  getBank: () => BatchBank | null
  keep: (bank: BatchBank) => void
  /** The full check on this clip: where it goes, its captions. */
  onReedit: (clip: PlacedClip) => void
  /** A video from the phone, edited, to take this clip's place - false when it couldn't be started. */
  onReplace: (file: File, clip: PlacedClip) => boolean
  onClose: () => void
}) {
  const clips = useMemo(() => clipsOfFormat(steps, hooks, keptWords), [steps, hooks])
  const [at, setAt] = useState(0)
  const index = Math.min(at, Math.max(0, clips.length - 1))
  const clip = clips[index] ?? null
  const [blob, setBlob] = useState<{ id: string; file: Blob | null } | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [muted, setMuted] = useState(false)
  const video = useRef<HTMLVideoElement>(null)

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

  // Played whole from its start, with its sound when the phone lets it -
  // muted otherwise, with a tap for the sound.
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

  const stepAt = steps.findIndex((s) => s.id === clip.place)
  const where = clip.place === HOOK ? 'Hook' : stepAt >= 0 ? `${stepAt + 1} · ${steps[stepAt].name}` : ''
  const go = (by: number) => {
    setNote(null)
    setAt((i) => Math.min(clips.length - 1, Math.max(0, i + by)))
  }
  const mirror = () => {
    const bank = getBank()
    if (bank) keep(withClip(bank, clip.file.id, { mirror: clip.file.mirror ? undefined : true }))
  }
  const remove = () => {
    const bank = getBank()
    if (!bank || !window.confirm(`Take ${clip.file.name} out of the batch?`)) return
    keep(placed(bank, formatId, clip.file, null))
    void retireBankFiles([clip.file.id]).catch(() => {})
    setNote(null)
    // The next one comes to this place; at the end, the one before.
    if (index >= clips.length - 1) setAt(Math.max(0, index - 1))
  }

  return (
    <div className={`drop-check-screen clip-viewer${clip.file.mirror ? ' mirrored' : ''}`}>
      <section className="screen review">
        <div className="clip-viewer-head">
          <button type="button" className="back" onClick={onClose}>
            <ChevronLeft /> Batch
          </button>
          <span className="row-name">
            {index + 1} / {clips.length}
          </span>
        </div>
        <span className="clip-viewer-where">{where}</span>
        <div className="clip-viewer-frame">
          {url ? (
            // One player for every clip: once he taps for sound, an iPhone lets
            // it keep playing with sound from clip to clip.
            <video ref={video} className="drop-check-video" src={url} playsInline loop onLoadedData={start} onClick={start} aria-label={clip.file.name} />
          ) : blob && blob.id === clip.file.id && !blob.file ? (
            <p className="hint warn-text">This clip is no longer on this phone or your server.</p>
          ) : (
            <p className="hint">Getting the clip…</p>
          )}
          {muted && url ? (
            <button type="button" className="btn small clip-viewer-sound" onClick={start}>
              Tap for sound
            </button>
          ) : null}
        </div>
        <div className="clip-viewer-nav">
          <button type="button" className="tl-round" aria-label="Previous clip" disabled={index === 0} onClick={() => go(-1)}>
            <ChevronLeft />
          </button>
          <button type="button" className={`btn small${clip.file.mirror ? ' primary' : ''}`} aria-pressed={Boolean(clip.file.mirror)} onClick={mirror}>
            {clip.file.mirror ? 'Mirrored' : 'Mirror'}
          </button>
          <button type="button" className="tl-round" aria-label="Next clip" disabled={index >= clips.length - 1} onClick={() => go(1)}>
            <ChevronRight />
          </button>
        </div>
        <div className="clip-viewer-actions">
          <button type="button" className="btn small" onClick={() => onReedit(clip)}>
            Re-edit
          </button>
          <VideoPicker
            className="btn small"
            label="Replace with a video from your phone"
            onFiles={(files) => {
              if (files.length === 0) return
              setNote(
                onReplace(files[0], clip)
                  ? `${files[0].name} is being edited - it takes this clip's place once you approve it on the check.`
                  : "Couldn't start it - open this format on the Batch tab and try again.",
              )
            }}
          >
            Replace
          </VideoPicker>
          <button type="button" className="btn small danger" onClick={remove}>
            Remove
          </button>
        </div>
        {note ? <p className="hint">{note}</p> : null}
      </section>
    </div>
  )
}
