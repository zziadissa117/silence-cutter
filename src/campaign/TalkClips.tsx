// A talking head format's clips on its card (his ask, 2026-11-15: "rework the
// whole UI for the talking head batch ... it's very, very hard to understand.
// And make sure I can easily go to any clip and just modify it"): every clip
// in the order a video plays them - his hooks, then each product step - a tap
// on one opens it (ClipEditor.tsx). Above them the format's speed, which every
// clip is made at in the background, one at a time (clipEdit.ts).

import { useEffect, useRef, useState } from 'react'

import { VideoPicker } from '../VideoPicker'
import type { BankFile, BatchBank, BatchFormat, BatchStep } from './batch'
import { CLIP_SPEEDS, clipsToSpeed, clipsToSwitch, cutOrRaw, leftBehind, oneAtATime, remakeClip, speedLabel, speedOfClip, swapClip, wantedSpeed } from './clipEdit'
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

/** Every clip of the format brought to what it should be, one at a time,
 *  while the card is open: first cut or raw as its step says
 *  (BatchStep.clips), then the format's speed - with how many are left, and
 *  Stop. */
export function SpeedRunner({
  format,
  clips,
  steps = [],
  names = [],
  getBank,
  keep,
  paused = false,
}: {
  format: BatchFormat
  /** The clips the speed is for (his hooks kept as filmed left out). */
  clips: BankFile[]
  /** The format's steps, each cut or raw as he set it. */
  steps?: BatchStep[]
  /** The campaign's brand words, heard right when a clip is cut. */
  names?: string[]
  getBank: () => BatchBank | null
  keep: (bank: BatchBank) => void
  /** A clip is open over the tab: the phone is kept free for him (his report, 2026-11-15: he couldn't leave it). */
  paused?: boolean
}) {
  const [stopped, setStopped] = useState(false)
  const [doing, setDoing] = useState<{ name: string; fraction: number } | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const failed = useRef(new Set<string>())
  const running = useRef(false)
  const toSwitch = clipsToSwitch(steps).filter((c) => !failed.current.has(c.file.id))
  const switching = new Set(toSwitch.map((c) => c.file.id))
  const toSpeed = clipsToSpeed(clips, format).filter((f) => !failed.current.has(f.id) && !switching.has(f.id))
  const due = toSwitch.length + toSpeed.length
  // Cut or raw first: making it so puts it back at 1x, the speed after.
  const job = toSwitch[0] ? { file: toSwitch[0].file, cut: toSwitch[0].cut as boolean | null } : toSpeed[0] ? { file: toSpeed[0], cut: null } : null

  useEffect(() => {
    if (stopped || paused || running.current || !job) return
    running.current = true
    const { file, cut } = job
    const speed = wantedSpeed(file, format)
    const progress = (fraction: number) => setDoing({ name: file.name, fraction })
    setDoing({ name: file.name, fraction: 0 })
    const made =
      cut === null
        ? oneAtATime(() => remakeClip(file, { speed }, progress))
        : oneAtATime(() => cutOrRaw(file, { cut, names }, (phase, fraction) => progress(phase === 'cutting' ? 0.5 + fraction / 2 : fraction / 2)).then((r) => r.file))
    void made
      .then((next) => {
        const bank = getBank()
        // Changed meanwhile (moved, taken out, made again by hand): left as it is.
        if (!bank || ![...bank.reactions, ...(bank.steps ?? []).flatMap((s) => s.files)].some((f) => f.id === file.id)) {
          void retireBankFiles(leftBehind(file, next)).catch(() => {})
          return
        }
        keep(swapClip(bank, file.id, next))
        void retireBankFiles(leftBehind(file, next)).catch(() => {})
      })
      .catch((error: unknown) => {
        failed.current.add(file.id)
        const what = cut === null ? speedLabel(speed) : cut ? 'cut' : 'raw'
        const n = failed.current.size
        setProblem(`${n > 1 ? `${n} clips couldn't be changed - the last, ` : ''}${file.name}: couldn't make it ${what} (${error instanceof Error ? error.message : String(error)}).`)
      })
      .finally(() => {
        running.current = false
        setDoing(null)
      })
  }, [job?.file.id, job?.cut, stopped, paused]) // eslint-disable-line react-hooks/exhaustive-deps

  if (due === 0 && !problem) return null
  const what = toSwitch.length > 0 ? (toSpeed.length > 0 ? `cut or raw, then ${speedLabel(format.speed ?? 1)}` : 'cut or raw as their step says') : speedLabel(format.speed ?? 1)
  return (
    <div className="talk-speeding">
      {due > 0 ? (
        <>
          <span className="row-name">
            {stopped ? `${due} clip${due === 1 ? '' : 's'} not ${what} yet` : `Making your clips ${what}… ${due} left`}
          </span>
          {doing && !stopped ? (
            <div className="bar">
              <div style={{ width: `${Math.round(doing.fraction * 100)}%` }} />
            </div>
          ) : null}
          <span className="hint">{stopped ? 'They stay as they are until then.' : 'Keep this open - each clip is made again from your recording.'}</span>
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
  cutChoice,
  script,
}: {
  title: string
  num?: number
  files: BankFile[]
  onOpen: (id: string) => void
  onAdd?: (files: File[]) => void
  addLabel: string
  extra?: React.ReactNode
  /** A product step: its clips cut by the Cutter or kept raw (BatchStep.clips). */
  cutChoice?: { value: 'cut' | 'raw' | undefined; onChange: (value: 'cut' | 'raw') => void }
  /** A product step's caption script (BatchStep.script). */
  script?: { value: string | undefined; onSave: (value: string) => void }
}) {
  const [editing, setEditing] = useState<string | null>(null)
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
      {/* Its caption script: what he says in it, as the captions should read
          (captionScript.ts) - set by him for every step. */}
      {script ? (
        editing !== null ? (
          <div className="talk-script edit">
            <textarea
              rows={2}
              value={editing}
              placeholder="What you say in this step, e.g. Go to ChatGPT and paste this prompt"
              aria-label={`${title}: caption script`}
              onChange={(e) => setEditing(e.target.value)}
            />
            <div className="actions-row">
              <button
                type="button"
                className="btn small primary"
                onClick={() => {
                  script.onSave(editing.trim())
                  setEditing(null)
                }}
              >
                Save
              </button>
              <button type="button" className="btn small" onClick={() => setEditing(null)}>
                Cancel
              </button>
            </div>
          </div>
        ) : script.value ? (
          <button type="button" className="talk-script" onClick={() => setEditing(script.value ?? '')}>
            <span className="hint">Captions</span>
            <span className="talk-script-text">“{script.value}”</span>
          </button>
        ) : (
          <button type="button" className="talk-script missing" onClick={() => setEditing('')}>
            <span className="warn-text">No caption script yet</span>
            <span className="hint">Tap to type what you say in this step</span>
          </button>
        )
      ) : null}
      {cutChoice ? (
        <div className="talk-step-cut">
          <div className="seg" role="radiogroup" aria-label={`${title}: cut or raw`}>
            {(['cut', 'raw'] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={cutChoice.value === v}
                className={cutChoice.value === v ? 'active' : ''}
                onClick={() => cutChoice.value !== v && cutChoice.onChange(v)}
              >
                {v === 'cut' ? 'Cut' : 'Raw'}
              </button>
            ))}
          </div>
          <span className="hint">{cutChoice.value === 'cut' ? 'The Cutter cuts every clip here.' : cutChoice.value === 'raw' ? 'Every clip here as you filmed it.' : 'Each clip as it was dropped in.'}</span>
        </div>
      ) : null}
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
                    {f.ownCut ? ' · raw' : ''}
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
  onStepClips,
  onStepScript,
  hookNote,
}: {
  hooks: BankFile[]
  steps: BatchStep[]
  rawHooks: boolean
  onOpen: (id: string) => void
  onAddHooks: (files: File[]) => void
  onAddToStep: (stepId: string, files: File[]) => void
  /** A step's clips set to be cut or raw, all of them. */
  onStepClips?: (stepId: string, value: 'cut' | 'raw') => void
  /** A step's caption script saved. */
  onStepScript?: (stepId: string, script: string) => void
  hookNote?: React.ReactNode
}) {
  return (
    <div className="talk-list">
      <Group title={rawHooks ? 'Hook - as filmed' : 'Hook'} files={hooks} onOpen={onOpen} onAdd={onAddHooks} addLabel="Add hooks" extra={hookNote} />
      {steps.map((st, i) => (
        <Group key={st.id} num={i + 1} title={st.name} files={st.files} onOpen={onOpen} onAdd={(files) => onAddToStep(st.id, files)} addLabel={`Add clips for ${st.name}`}
          cutChoice={onStepClips ? { value: st.clips, onChange: (v) => onStepClips(st.id, v) } : undefined}
          script={onStepScript ? { value: st.script, onSave: (v) => onStepScript(st.id, v) } : undefined}
        />
      ))}
    </div>
  )
}
