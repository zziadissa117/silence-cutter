// "Drop in all videos" on a talking head format (his ask, 2026-11-13): all
// his short clips at once - each heard, cut, captioned and put in the
// product step whose name he says in it (prepareDrop.ts, stepMatch.ts) - then one
// quick list to check: what he says in each and its step, the unsure ones
// first, a different step or "Leave out" in one tap. What he moves teaches
// the step his wording for next time.

import { useRef, useState } from 'react'

import { VideoPicker } from '../VideoPicker'
import type { BankFile, BatchBank, BatchStep } from './batch'
import { prepareClip, type DropPhase } from './prepareDrop'
import { learned, matchStep } from './stepMatch'
import { retireBankFiles } from './store'

interface Row {
  /** The clip as picked. */
  name: string
  /** The cut clip, kept - absent when it couldn't be used. */
  file?: BankFile
  text: string
  /** Its step; null: not sure which, waiting for his pick. */
  stepId: string | null
  sure: boolean
  failed?: string
}

const PHASE: Record<DropPhase, string> = { model: 'Getting the listening ready', listening: 'Listening', cutting: 'Cutting' }

const OUT = 'out'

export function DropIn({
  steps,
  names,
  getBank,
  keep,
}: {
  /** This format's product steps. */
  steps: BatchStep[]
  /** The campaign's brand words, heard right. */
  names: string[]
  getBank: () => BatchBank | null
  keep: (bank: BatchBank) => void
}) {
  const [rows, setRows] = useState<Row[]>([])
  const [running, setRunning] = useState<{ at: number; of: number; name: string; phase: string } | null>(null)
  const stop = useRef(false)
  const ids = new Set(steps.map((s) => s.id))

  /** The bank with `file` taken out of every step and put in `to` (none: in no step). */
  const placed = (bank: BatchBank, file: BankFile, to: string | null): BatchBank => ({
    ...bank,
    steps: (bank.steps ?? []).map((st) => {
      const without = st.files.filter((f) => f.id !== file.id)
      return st.id === to ? { ...st, files: [...without, file] } : without.length === st.files.length ? st : { ...st, files: without }
    }),
  })

  const run = async (files: File[]) => {
    stop.current = false
    for (const [i, file] of files.entries()) {
      if (stop.current) break
      setRunning({ at: i + 1, of: files.length, name: file.name, phase: PHASE.listening })
      try {
        const clip = await prepareClip(file, { names, onPhase: (phase, p) => setRunning({ at: i + 1, of: files.length, name: file.name, phase: `${PHASE[phase]}${p > 0 && p < 1 ? ` ${Math.round(p * 100)}%` : ''}` }) })
        const bank = getBank()
        if (!bank) break
        const match = matchStep(clip.text, (bank.steps ?? []).filter((s) => ids.has(s.id)))
        if (match.stepId) keep(placed(bank, clip.file, match.stepId))
        setRows((r) => [...r, { name: file.name, file: clip.file, text: clip.text, stepId: match.stepId, sure: match.sure }])
      } catch (error) {
        setRows((r) => [...r, { name: file.name, text: '', stepId: null, sure: false, failed: error instanceof Error ? error.message : String(error) }])
      }
    }
    setRunning(null)
  }

  /** A clip moved to another step, or left out. */
  const move = (row: Row, to: string) => {
    const bank = getBank()
    if (!bank || !row.file) return
    keep(placed(bank, row.file, to === OUT ? null : to))
    if (to === OUT) void retireBankFiles([row.file.id]).catch(() => {})
    setRows((all) => all.map((r) => (r === row ? { ...r, stepId: to === OUT ? null : to, sure: true, failed: to === OUT ? 'Left out' : undefined } : r)))
  }

  /** Checked: each step remembers how he said it; clips left with no step go. */
  const done = () => {
    const bank = getBank()
    if (bank) {
      keep({
        ...bank,
        steps: (bank.steps ?? []).map((st) => {
          const said = rows.filter((r) => r.stepId === st.id && r.file && r.text)
          return said.length > 0 ? { ...st, heard: said.reduce((h, r) => learned(h, r.text), st.heard) } : st
        }),
      })
    }
    const loose = rows.filter((r) => r.file && !r.stepId && r.failed !== 'Left out').map((r) => r.file!.id)
    if (loose.length > 0) void retireBankFiles(loose).catch(() => {})
    setRows([])
  }

  if (steps.length === 0) return null
  const unsure = rows.filter((r) => !r.failed && (!r.sure || !r.stepId))
  const ordered = [...rows].sort((a, b) => Number(a.sure && !a.failed && !!a.stepId) - Number(b.sure && !b.failed && !!b.stepId))
  const nameOf = (id: string | null) => steps.find((s) => s.id === id)?.name ?? 'No step'

  return (
    <div className="drop-in">
      {running ? (
        <div className="drop-in-running">
          <span className="row-name">
            {running.at} of {running.of} · {running.phase}
          </span>
          <span className="hint">{running.name}</span>
          <div className="bar">
            <div style={{ width: `${Math.round(((running.at - 1) / running.of) * 100)}%` }} />
          </div>
          <button type="button" className="linkbtn" onClick={() => (stop.current = true)}>
            Stop after this one
          </button>
        </div>
      ) : (
        <VideoPicker className="btn small primary" label="Drop in all videos" onFiles={(files) => files.length > 0 && void run(files)}>
          Drop in all videos
        </VideoPicker>
      )}
      {!running && rows.length === 0 ? (
        <p className="hint">
          All your clips at once: each is cut like your talking videos (with a little more room), captioned, and put in the step whose name you say in
          it. Name each step with what you say, e.g. &ldquo;Nope, do this instead&rdquo;.
        </p>
      ) : null}
      {rows.length > 0 ? (
        <div className="drop-in-check">
          <div className="group-title">
            Check them · {rows.length} clip{rows.length === 1 ? '' : 's'}
            {unsure.length > 0 ? ` · ${unsure.length} to look at` : ' · all sure'}
          </div>
          <ul className="rows group">
            {ordered.map((row, k) => (
              <li key={`${row.name}-${k}`} className={`drop-in-row${!row.failed && (!row.sure || !row.stepId) ? ' unsure' : ''}`}>
                <div className="row-text">
                  <span className="row-line">{row.failed ? `${row.name}: ${row.failed === 'Left out' ? 'left out' : `couldn't use it (${row.failed})`}` : `“${row.text}”`}</span>
                  {!row.failed && (!row.sure || !row.stepId) ? <span className="hint warn-text">{row.stepId ? `Not sure - looks like ${nameOf(row.stepId)}` : 'Not sure which step'}</span> : null}
                </div>
                {row.file && row.failed !== 'Left out' ? (
                  <select value={row.stepId ?? ''} aria-label={`Step for ${row.name}`} onChange={(e) => e.target.value && move(row, e.target.value)}>
                    {row.stepId ? null : <option value="">Pick a step</option>}
                    {steps.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                    <option value={OUT}>Leave out</option>
                  </select>
                ) : null}
              </li>
            ))}
          </ul>
          {!running ? (
            <button type="button" className="btn primary wide" onClick={done}>
              {rows.some((r) => r.file && !r.stepId && r.failed !== 'Left out') ? 'Done - clips with no step are left out' : 'Looks good'}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
