// The timeline editor, straight away (his ask, 2026-11-06: "just open the
// timeline editor ... we click on the videos we want to put in, and we can
// just edit them ourselves ... then we can choose where it goes"): he picks
// one or more videos, in the order they go - put together first when there
// are several - and says where it goes: through the silence cutter as usual,
// edited by hand then posted, or edited by hand and kept to look at. Pictures
// go on in the editor itself (+ Overlay), from the bank or the phone.

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

/** Where a video edited by hand goes. */
export type EditGoes = 'cut' | 'post' | 'keep'

const GOES: { id: EditGoes; label: string; line: string }[] = [
  { id: 'post', label: 'Post it', line: 'Nothing cut by itself: you edit it, then approve and it goes to its campaign like any video.' },
  { id: 'cut', label: 'Cut the silences', line: 'Through the silence cutter as usual - the pauses cut - then the editor for the rest.' },
  { id: 'keep', label: 'Just keep it', line: 'You edit it and it is made, but not posted: save it or send it to Postiz from its row when you like.' },
]
const GOES_KEY = 'campaign.editGoes'
function lastGoes(): EditGoes {
  try {
    const v = localStorage.getItem(GOES_KEY)
    return v === 'cut' || v === 'keep' ? v : 'post'
  } catch {
    return 'post'
  }
}

export function JoinPicker({
  onJoin,
  onBack,
  onNotice,
}: {
  onJoin: (files: File[], goes: EditGoes) => void
  onBack: () => void
  onNotice: (message: string) => void
}) {
  const [parts, setParts] = useState<Picked[]>([])
  const [goes, setGoes] = useState<EditGoes>(lastGoes)
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
        <span className="label">Timeline editor</span>
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
      <VideoPicker className={parts.length > 0 ? 'btn add-more' : 'btn add-more primary'} label="Add videos" onFiles={add}>
        {parts.length > 0 ? '+ Add another video' : '+ Add the videos, in order'}
      </VideoPicker>

      <div className="field">
        <span className="label">Then it</span>
        <div className="seg full" role="radiogroup" aria-label="Where it goes">
          {GOES.map((g) => (
            <button
              key={g.id}
              type="button"
              role="radio"
              aria-checked={goes === g.id}
              className={goes === g.id ? 'active' : ''}
              onClick={() => {
                setGoes(g.id)
                try {
                  localStorage.setItem(GOES_KEY, g.id)
                } catch {
                  // Asked again next time.
                }
              }}
            >
              {g.label}
            </button>
          ))}
        </div>
        <span className="hint">{GOES.find((g) => g.id === goes)!.line}</span>
      </div>

      <button
        type="button"
        className="btn primary"
        disabled={parts.length === 0}
        onClick={() => {
          onJoin(
            parts.map((p) => p.file),
            goes,
          )
          setParts([])
        }}
      >
        {parts.length === 0
          ? 'Open the timeline editor'
          : `Open the timeline editor${parts.length > 1 ? ` · ${parts.length} videos` : ''}${known ? ` · ${formatTime(total)}` : ''}`}
      </button>
      <p className="hint montage-for">
        {parts.length > 1
          ? 'They are put together in this order first. Pictures, words and other videos go on in the editor (+ Overlay, + Text).'
          : 'Pictures, words and other videos go on in the editor (+ Overlay, + Text).'}
      </p>
    </div>
  )
}
