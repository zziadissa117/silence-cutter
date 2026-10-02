// Join recordings first: he picks the recordings of one video - the selfie
// camera, then the back camera, then another take - in the order they go,
// and they are put together into one video before anything else. It then
// goes on like any video he drops in: heard, sorted, its captions checked,
// its headline set. The recordings are only offered to be joined after
// they have been heard when he drops them in with the rest; this is for
// when he knows before he starts.

import { useEffect, useRef, useState } from 'react'

import { VideoPicker } from '../VideoPicker'
import { pickArrived, pickSaved } from '../pickWatch'
import { filmingOf } from './filming'
import { formatTime } from './jobs'

interface Picked {
  key: string
  file: File
  seconds?: number
}

let nextKey = 0

export function JoinPicker({
  onJoin,
  onBack,
  onNotice,
}: {
  onJoin: (files: File[]) => void
  onBack: () => void
  onNotice: (message: string) => void
}) {
  const [parts, setParts] = useState<Picked[]>([])
  const alive = useRef(true)
  useEffect(
    () => () => {
      alive.current = false
    },
    [],
  )

  const add = (files: File[]) => {
    const problem = pickArrived(files)
    if (problem) {
      onNotice(problem)
      return
    }
    const added = files.map((file) => ({ key: `join-${nextKey++}`, file }))
    setParts((current) => [...current, ...added])
    pickSaved()
    for (const part of added) {
      void filmingOf(part.file).then(({ seconds }) => {
        if (!alive.current || seconds === undefined) return
        setParts((current) => current.map((p) => (p.key === part.key ? { ...p, seconds } : p)))
      })
    }
  }

  const move = (from: number, to: number) =>
    setParts((current) => {
      if (to < 0 || to >= current.length) return current
      const next = [...current]
      const [part] = next.splice(from, 1)
      next.splice(to, 0, part)
      return next
    })

  const known = parts.every((p) => p.seconds !== undefined)
  const total = parts.reduce((sum, p) => sum + (p.seconds ?? 0), 0)

  return (
    <div className="chooser montage">
      <div className="chooser-head">
        <span className="label">Join recordings · one video</span>
        <button type="button" className="linkbtn" onClick={onBack}>
          Back
        </button>
      </div>

      {parts.length > 0 ? (
        <ol className="montage-clips" aria-label="Recordings, in order">
          {parts.map((part, i) => (
            <li key={part.key} className="montage-clip">
              <span className="montage-n">{i + 1}</span>
              <span className="montage-text">
                <span className="montage-name">{part.file.name}</span>
                <span className="hint">{part.seconds !== undefined ? formatTime(part.seconds) : '…'}</span>
              </span>
              <button type="button" className="btn small icon-btn" aria-label={`Move ${part.file.name} up`} disabled={i === 0} onClick={() => move(i, i - 1)}>
                ↑
              </button>
              <button
                type="button"
                className="btn small icon-btn"
                aria-label={`Move ${part.file.name} down`}
                disabled={i === parts.length - 1}
                onClick={() => move(i, i + 1)}
              >
                ↓
              </button>
              <button
                type="button"
                className="btn small icon-btn"
                aria-label={`Take out ${part.file.name}`}
                onClick={() => setParts((current) => current.filter((p) => p.key !== part.key))}
              >
                ✕
              </button>
            </li>
          ))}
        </ol>
      ) : null}
      <VideoPicker className={parts.length > 0 ? 'btn add-more' : 'btn add-more primary'} label="Add recordings" onFiles={add}>
        {parts.length > 0 ? '+ Add another recording' : '+ Add the recordings, in order'}
      </VideoPicker>

      <button
        type="button"
        className="btn primary"
        disabled={parts.length < 2}
        onClick={() => {
          onJoin(parts.map((p) => p.file))
          setParts([])
        }}
      >
        {parts.length < 2
          ? 'Join them'
          : `Join ${parts.length} recordings${known ? ` · ${formatTime(total)}` : ''}`}
      </button>
      <p className="hint montage-for">
        {parts.length === 1
          ? 'Add at least one more to join.'
          : "They're put together first, then heard and sorted like any video - captions, headline and all."}
      </p>
    </div>
  )
}
