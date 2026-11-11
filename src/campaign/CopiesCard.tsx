// The Batch tab's "One video, new songs" (batch.CopySource): he puts in a
// video and how many copies; the batch posts it again that many times, the
// picture exactly as it is, each copy with another of the batch's songs.

import { useState } from 'react'

import { VideoPicker } from '../VideoPicker'
import type { BatchBank, CopySource } from './batch'

export function CopiesCard({
  bank,
  busy,
  onAdd,
  onChange,
}: {
  bank: BatchBank
  busy: boolean
  /** Keeps the videos and puts them in, `count` copies each. */
  onAdd: (files: File[], count: number) => void
  onChange: (copies: CopySource[]) => void
}) {
  const songs = bank.music.length
  const [count, setCount] = useState(5)
  const copies = bank.copies ?? []
  const most = Math.max(1, songs)
  const wanted = Math.min(count, most)
  const change = (id: string, patch: Partial<CopySource>) => onChange(copies.map((c) => (c.id === id ? { ...c, ...patch } : c)))

  return (
    <div className="group copies">
      <div className="bank-head">
        <span className="group-title">
          One video, new songs <span className="bank-count">{copies.length}</span>
        </span>
        <VideoPicker className="btn small" label="Add a video to copy" onFiles={(files) => onAdd(files, wanted)}>
          + Add
        </VideoPicker>
      </div>
      <p className="hint tip bank-hint">
        A video that did well, posted again: the picture exactly as it is, each copy with another of the songs above. If you
        talk in it, your voice stays and the song goes quietly under it. The copies take the batch's next free times.
      </p>
      {songs === 0 ? (
        <p className="hint rejected">Add songs to Music first - each copy gets a different one.</p>
      ) : (
        <div className="field">
          <span className="label">Copies of each</span>
          <div className="stepper">
            <button type="button" className="btn small icon-btn" aria-label="Fewer copies" disabled={wanted <= 1} onClick={() => setCount(wanted - 1)}>
              −
            </button>
            <span className="stepper-value" aria-label="Copies of each">
              {wanted}
            </span>
            <button type="button" className="btn small icon-btn" aria-label="More copies" disabled={wanted >= most} onClick={() => setCount(wanted + 1)}>
              +
            </button>
          </div>
          {count > most ? <span className="hint">{songs} songs, so {songs} copies at most.</span> : null}
        </div>
      )}
      {copies.length > 0 ? (
        <ul className="bank-list">
          {copies.map((c) => {
            const made = bank.copiesMade?.[c.id]?.length ?? 0
            const goal = Math.min(c.count, made + Math.max(0, songs - made))
            const done = made >= goal
            return (
              <li key={c.id} className="bank-item copy-item">
                <span className="bank-name">{c.clip.name}</span>
                <span className="hint">
                  {made} of {goal} made{done ? '' : c.stopped ? ' · stopped' : ''}
                </span>
                <button
                  type="button"
                  className="linkbtn"
                  disabled={busy}
                  aria-label={c.talks ? 'Your voice is kept - tap if you do not talk in it' : 'The song replaces its sound - tap if you talk in it'}
                  onClick={() => change(c.id, { talks: !c.talks })}
                >
                  {c.talks ? 'Your voice + song under' : 'Song only'}
                </button>
                {done ? null : (
                  <button type="button" className="linkbtn" disabled={busy} onClick={() => change(c.id, { stopped: c.stopped ? undefined : true })}>
                    {c.stopped ? 'Go on' : 'Stop'}
                  </button>
                )}
                <span className="stepper">
                  <button type="button" className="btn small icon-btn" aria-label="One copy fewer" disabled={busy || c.count <= Math.max(1, made)} onClick={() => change(c.id, { count: c.count - 1 })}>
                    −
                  </button>
                  <button type="button" className="btn small icon-btn" aria-label="One copy more" disabled={busy || c.count >= songs} onClick={() => change(c.id, { count: c.count + 1 })}>
                    +
                  </button>
                </span>
                <button
                  type="button"
                  className="btn small icon-btn"
                  aria-label={`Take out ${c.clip.name}`}
                  disabled={busy}
                  onClick={() => onChange(copies.filter((x) => x.id !== c.id))}
                >
                  ✕
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
