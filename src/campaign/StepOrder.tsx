// Set order: a campaign's product showcase as steps - "Claude", "The app",
// "The prompt" - in the order every batch video shows them after the
// reaction. Each step then gets its own clips in the Batch tab; every video
// takes one clip per step and plays the moment something happens in it
// (stepPiece.ts). Names and order are all he sets - never seconds.

import { useState } from 'react'

import type { BatchStep } from './batch'

interface Draft {
  id: string
  name: string
  clips: number
}

const draftOf = (step: BatchStep): Draft => ({ id: step.id, name: step.name, clips: step.files.length })

const blank = (n: number): Draft => ({ id: crypto.randomUUID(), name: `Step ${n}`, clips: 0 })

export function StepOrder({
  campaignName,
  steps,
  onSave,
  onClose,
}: {
  campaignName: string
  steps: BatchStep[]
  /** The steps as they now are; a step taken out goes with its clips. */
  onSave: (steps: BatchStep[]) => void
  onClose: () => void
}) {
  const [drafts, setDrafts] = useState<Draft[]>(() => (steps.length > 0 ? steps.map(draftOf) : [blank(1), blank(2), blank(3)]))
  const change = (id: string, fields: Partial<Draft>) => setDrafts((all) => all.map((d) => (d.id === id ? { ...d, ...fields } : d)))
  const move = (index: number, by: number) =>
    setDrafts((all) => {
      const to = index + by
      if (to < 0 || to >= all.length) return all
      const next = [...all]
      ;[next[index], next[to]] = [next[to], next[index]]
      return next
    })

  const save = () => {
    const byId = new Map(steps.map((s) => [s.id, s]))
    onSave(
      drafts.map((d, i) => ({
        id: d.id,
        name: d.name.trim() || `Step ${i + 1}`,
        files: byId.get(d.id)?.files ?? [],
      })),
    )
    onClose()
  }

  return (
    <div className="group step-order">
      <div className="group-title">Product showcase order · {campaignName}</div>
      <p className="hint">
        The steps every video shows after the reaction, always in this order. Each step gets its own clips below; every video takes
        one clip per step and plays the moment something happens in it - a short clip plays whole.
      </p>
      <ol className="step-list">
        {drafts.map((d, i) => (
          <li key={d.id} className="step-row">
            <span className="step-n">{i + 1}</span>
            <input
              type="text"
              className="find step-name"
              aria-label={`Step ${i + 1} name`}
              value={d.name}
              maxLength={40}
              onChange={(e) => change(d.id, { name: e.target.value })}
            />
            <span className="step-tools">
              <button type="button" className="btn small icon-btn" aria-label={`Move ${d.name} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                ↑
              </button>
              <button
                type="button"
                className="btn small icon-btn"
                aria-label={`Move ${d.name} down`}
                disabled={i === drafts.length - 1}
                onClick={() => move(i, 1)}
              >
                ↓
              </button>
              <button
                type="button"
                className="btn small icon-btn"
                aria-label={`Take out ${d.name}`}
                onClick={() => {
                  if (d.clips > 0 && !window.confirm(`Take out ${d.name} and its ${d.clips} clip${d.clips === 1 ? '' : 's'}?`)) return
                  setDrafts((all) => all.filter((x) => x.id !== d.id))
                }}
              >
                ✕
              </button>
            </span>
          </li>
        ))}
      </ol>
      <div className="actions-row">
        <button type="button" className="btn small" disabled={drafts.length >= 10} onClick={() => setDrafts((all) => [...all, blank(all.length + 1)])}>
          + Add step
        </button>
      </div>
      {drafts.length === 0 ? <p className="hint">No steps: the product showcases go back to one list, each played whole.</p> : null}
      <div className="actions-row">
        <button type="button" className="btn primary" onClick={save}>
          Save order
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  )
}
