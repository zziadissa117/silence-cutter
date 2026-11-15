// The fast lane of a talking head format's check (his ask, 2026-11-15: "the
// way to check captions right now on the batches ... takes too long ... I
// still need to verify them"): every clip waiting whose heard words line up
// with its step's caption script (captionScript.ts) in one list - its step,
// its captions as they will read, the clip playing at the top when tapped -
// and "Approve all" puts them in the batch at once, captions in the script's
// spelling. One that doesn't look right: Check opens it alone on the full
// check; the clips that differ from their script stay there anyway.

import { useEffect, useMemo, useRef, useState } from 'react'

import type { BankFile, BatchBank, BatchFormat, BatchStep } from './batch'
import type { CaptionWord } from './captions'
import { fitToScript } from './captionScript'
import { filesOfClip } from './clipEdit'
import { fileIn, HOOK, loadQueue, placed, saveQueue, type ToCheck } from './dropQueue'
import { ChevronRight, CloseIcon } from './icons'
import { learned } from './stepMatch'
import { loadBankFile, retireBankFiles, saveBankFile } from './store'
import { downloadFile } from './talkLink'

/** A clip waiting for his check that matches its step's script, with its
 *  captions as they will read. */
export interface ScriptMatch {
  item: ToCheck
  step: BatchStep
  words: CaptionWord[]
}

/** The clips waiting in a format's check that match their step's caption
 *  script word for word (once lined up): heard, with captions, in a step
 *  that has a script. */
export function scriptMatches(queue: readonly ToCheck[], steps: readonly BatchStep[]): ScriptMatch[] {
  return queue.flatMap((item) => {
    if (item.noCaptions || item.unheard || item.words.length === 0 || !item.place || item.place === HOOK) return []
    const step = steps.find((st) => st.id === item.place)
    const script = step?.script?.trim()
    if (!step || !script) return []
    const fit = fitToScript(item.words, script)
    return fit.matches ? [{ item, step, words: fit.words }] : []
  })
}

/** The bank with these clips approved where they wait to go, each with its
 *  captions - as the full check approves one - and the files to let go of
 *  (clips they take the place of). */
export function approveMatches(bank: BatchBank, formatId: string, matches: readonly ScriptMatch[]): { bank: BatchBank; retire: string[] } {
  let next = bank
  const retire: string[] = []
  for (const { item, words } of matches) {
    // Looked at again: the clip as it is in the batch now.
    const now = item.recheck ? fileIn(next, item.file.id) : item.file
    if (!now || !item.place) continue
    const source = item.source ?? now.source
    const clip: BankFile = {
      ...now,
      ...(item.recheck || now.ownCut ? {} : { edited: true }),
      captions: words,
      ...(source ? { source } : {}),
      mirror: now.mirror || undefined,
      checked: true,
    }
    const replaced = item.replaces ? fileIn(next, item.replaces) : null
    next = placed(next, formatId, clip, item.place, item.replaces)
    const text = words.map((w) => w.text).join(' ')
    if (text) next = { ...next, steps: (next.steps ?? []).map((st) => (st.id === item.place ? { ...st, heard: learned(st.heard, text) } : st)) }
    if (item.replaces) retire.push(...(replaced ? filesOfClip(replaced).filter((id) => id !== source?.fileId) : [item.replaces]))
  }
  return { bank: next, retire }
}

export function ScriptCheck({
  format,
  steps,
  getBank,
  keep,
  onCheckOne,
  onClose,
}: {
  format: BatchFormat
  /** This format's product steps, in order. */
  steps: BatchStep[]
  getBank: () => BatchBank | null
  keep: (bank: BatchBank) => void
  /** One clip on the full check instead. */
  onCheckOne: (fileId: string) => void
  onClose: () => void
}) {
  const [queue] = useState(() => loadQueue(format.id))
  const matches = useMemo(() => scriptMatches(queue, steps), [queue, steps])
  const [at, setAt] = useState(0)
  const playing = matches[at] ?? null
  const [blob, setBlob] = useState<{ id: string; file: Blob | null } | null>(null)
  const video = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (!playing) return
    let alive = true
    void (async () => {
      let file: Blob | null = await loadBankFile(playing.item.file).catch(() => null)
      if (!file) {
        file = await downloadFile(playing.item.file.id).catch(() => null)
        if (file) await saveBankFile(playing.item.file.id, file).catch(() => {})
      }
      if (alive) setBlob({ id: playing.item.file.id, file })
    })()
    return () => {
      alive = false
    }
  }, [playing?.item.file.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const shown = blob && playing && blob.id === playing.item.file.id ? blob.file : null
  const url = useMemo(() => (shown ? URL.createObjectURL(shown) : null), [shown])
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url])

  const approveAll = () => {
    const bank = getBank()
    if (!bank || matches.length === 0) return
    const { bank: next, retire } = approveMatches(bank, format.id, matches)
    keep(next)
    if (retire.length > 0) void retireBankFiles(retire).catch(() => {})
    const done = new Set(matches.map((m) => m.item.file.id))
    saveQueue(format.id, loadQueue(format.id).filter((q) => !done.has(q.file.id)))
    onClose()
  }

  const stepNumber = (st: BatchStep) => steps.findIndex((s) => s.id === st.id) + 1

  return (
    <div className={`drop-check-screen clip-viewer script-check${playing?.item.file.mirror ? ' mirrored' : ''}`}>
      <section className="screen review">
        <div className="clip-editor-head">
          <span className="clip-editor-title">
            <span className="row-name">
              {matches.length} clip{matches.length === 1 ? '' : 's'} match{matches.length === 1 ? 'es' : ''} their caption script
            </span>
            <span className="hint">Tap one to play it. Its captions will read exactly as shown.</span>
          </span>
          <button type="button" className="clip-editor-close" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        {matches.length === 0 ? (
          <p className="empty">None right now - the clips waiting differ from their step&rsquo;s script, or their step has none yet.</p>
        ) : (
          <>
            <div className="script-check-player">
              {url ? (
                <video ref={video} className="drop-check-video" src={url} playsInline loop autoPlay muted={false} onClick={() => video.current?.play()} aria-label={playing?.item.name} />
              ) : blob && playing && blob.id === playing.item.file.id && !blob.file ? (
                <p className="hint warn-text">This clip is no longer on this phone or your server.</p>
              ) : (
                <p className="hint">Getting the clip…</p>
              )}
            </div>
            <ul className="script-check-list">
              {matches.map((m, i) => (
                <li key={m.item.file.id} className={i === at ? 'on' : ''}>
                  <button type="button" className="script-check-row" onClick={() => setAt(i)}>
                    <span className="step-num">{stepNumber(m.step)}</span>
                    <span className="script-check-text">
                      <span className="script-check-step">{m.step.name}</span>
                      <span>{m.words.map((w) => w.text).join(' ')}</span>
                    </span>
                  </button>
                  <button type="button" className="linkbtn" onClick={() => onCheckOne(m.item.file.id)}>
                    Check <ChevronRight />
                  </button>
                </li>
              ))}
            </ul>
            <div className="editor-foot sticky">
              <button type="button" className="btn primary wide" onClick={approveAll}>
                Approve all {matches.length}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  )
}
