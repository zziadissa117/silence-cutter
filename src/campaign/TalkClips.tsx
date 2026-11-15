// A talking head format's clips on its card (his ask, 2026-11-15: "rework the
// whole UI for the talking head batch ... it's very, very hard to understand.
// And make sure I can easily go to any clip and just modify it"): every clip
// in the order a video plays them - his hooks, then each product step - a tap
// on one opens it (ClipEditor.tsx). Above them the format's speed, which every
// clip is made at in the background, one at a time (clipEdit.ts).

import { useEffect, useRef, useState } from 'react'

import { VideoPicker } from '../VideoPicker'
import type { BankFile, BatchBank, BatchFormat, BatchStep } from './batch'
import { CLIP_SPEEDS, clipsToSpeed, leftBehind, oneAtATime, remakeClip, speedLabel, speedOfClip, swapClip, wantedSpeed } from './clipEdit'
import { ChevronRight } from './icons'
import { formatTime } from './jobs'
import { retireBankFiles } from './store'

/** The format's speed: one tap for every clip. */
export function SpeedRow({ format, onSpeed }: { format: BatchFormat; onSpeed: (speed: number | undefined) => void }) {
  const now = format.speed ?? 1
  return (
    <div className="talk-speed">
      <span className="row-name">Speed</span>
      <div className="seg full" role="radiogroup" aria-label="Speed of every clip">
        {CLIP_SPEEDS.map((sp) => (
          <button key={sp} type="button" role="radio" aria-checked={now === sp} className={now === sp ? 'active' : ''} onClick={() => onSpeed(sp === 1 ? undefined : sp)}>
            {speedLabel(sp)}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Every clip of the format brought to the speed wanted, one at a time,
 *  while the card is open - with how many are left, and Stop. */
export function SpeedRunner({ format, clips, getBank, keep }: { format: BatchFormat; clips: BankFile[]; getBank: () => BatchBank | null; keep: (bank: BatchBank) => void }) {
  const [stopped, setStopped] = useState(false)
  const [doing, setDoing] = useState<{ name: string; fraction: number } | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const failed = useRef(new Set<string>())
  const running = useRef(false)
  const due = clipsToSpeed(clips, format).filter((f) => !failed.current.has(f.id))
  const next = due[0]

  useEffect(() => {
    if (stopped || running.current || !next) return
    running.current = true
    const speed = wantedSpeed(next, format)
    setDoing({ name: next.name, fraction: 0 })
    void oneAtATime(() => remakeClip(next, { speed }, (fraction) => setDoing({ name: next.name, fraction })))
      .then((made) => {
        const bank = getBank()
        // Changed meanwhile (moved, taken out, made again by hand): left as it is.
        if (!bank || ![...bank.reactions, ...(bank.steps ?? []).flatMap((s) => s.files)].some((f) => f.id === next.id)) {
          void retireBankFiles(leftBehind(next, made)).catch(() => {})
          return
        }
        keep(swapClip(bank, next.id, made))
        void retireBankFiles(leftBehind(next, made)).catch(() => {})
      })
      .catch((error: unknown) => {
        failed.current.add(next.id)
        setProblem(`${next.name}: couldn't make it ${speedLabel(speed)} (${error instanceof Error ? error.message : String(error)}).`)
      })
      .finally(() => {
        running.current = false
        setDoing(null)
      })
  }, [next?.id, stopped]) // eslint-disable-line react-hooks/exhaustive-deps

  if (due.length === 0 && !problem) return null
  return (
    <div className="talk-speeding">
      {due.length > 0 ? (
        <>
          <span className="row-name">
            {stopped ? `${due.length} clip${due.length === 1 ? '' : 's'} not at ${speedLabel(format.speed ?? 1)} yet` : `Making your clips ${speedLabel(format.speed ?? 1)}… ${due.length} left`}
          </span>
          {doing && !stopped ? (
            <div className="bar">
              <div style={{ width: `${Math.round(doing.fraction * 100)}%` }} />
            </div>
          ) : null}
          <span className="hint">{stopped ? 'They play at their old speed until then.' : 'Keep this open - each clip is made again from your recording.'}</span>
          <button type="button" className="linkbtn" onClick={() => setStopped(!stopped)}>
            {stopped ? 'Go on' : 'Stop'}
          </button>
        </>
      ) : null}
      {problem ? <span className="hint warn-text">{problem}</span> : null}
    </div>
  )
}

/** One group of clips: his hooks, or a product step. */
function Group({
  title,
  num,
  files,
  onOpen,
  onAdd,
  addLabel,
  extra,
}: {
  title: string
  num?: number
  files: BankFile[]
  onOpen: (id: string) => void
  onAdd?: (files: File[]) => void
  addLabel: string
  extra?: React.ReactNode
}) {
  return (
    <div className="talk-group">
      <div className="talk-group-head">
        {num ? <span className="step-num">{num}</span> : null}
        <span className="talk-group-title">{title}</span>
        <span className="bank-count">{files.length}</span>
        {onAdd ? (
          <VideoPicker className="btn small" label={addLabel} onFiles={onAdd}>
            + Add
          </VideoPicker>
        ) : null}
      </div>
      {extra}
      {files.length === 0 ? (
        <p className="hint warn-text talk-empty">No clips yet</p>
      ) : (
        <ul className="talk-clips">
          {files.map((f) => {
            const speed = speedOfClip(f)
            return (
              <li key={f.id}>
                <button type="button" className="talk-clip" onClick={() => onOpen(f.id)}>
                  <span className="talk-clip-name">{f.name}</span>
                  <span className="talk-clip-meta">
                    {f.seconds ? formatTime(f.seconds) : ''}
                    {speed !== 1 ? ` · ${speedLabel(speed)}` : ''}
                    {f.mirror ? ' · mirrored' : ''}
                  </span>
                  <ChevronRight />
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/** Every clip, in the order a video plays them. */
export function TalkClips({
  hooks,
  steps,
  rawHooks,
  onOpen,
  onAddHooks,
  onAddToStep,
  hookNote,
}: {
  hooks: BankFile[]
  steps: BatchStep[]
  rawHooks: boolean
  onOpen: (id: string) => void
  onAddHooks: (files: File[]) => void
  onAddToStep: (stepId: string, files: File[]) => void
  hookNote?: React.ReactNode
}) {
  return (
    <div className="talk-list">
      <Group title={rawHooks ? 'Hook - as filmed' : 'Hook'} files={hooks} onOpen={onOpen} onAdd={onAddHooks} addLabel="Add hooks" extra={hookNote} />
      {steps.map((st, i) => (
        <Group key={st.id} num={i + 1} title={st.name} files={st.files} onOpen={onOpen} onAdd={(files) => onAddToStep(st.id, files)} addLabel={`Add clips for ${st.name}`} />
      ))}
    </div>
  )
}
