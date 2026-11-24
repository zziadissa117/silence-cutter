// Two ways in from the Videos tab, both "add the videos in order" (his ask,
// 2026-11-24):
//  - Join clips: the videos put together in this order, then cut, captioned
//    and named like any of his videos - on the list, nothing else to choose.
//  - Timeline editor: the videos (put together first) opened in the editor as
//    filmed, straight away - not listened to, nothing cut, no captions, not
//    posted (rawEdit.ts). He edits; it is kept on the phone.

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

/** Where a video edited by hand goes (older rows: 'post'). */
export type EditGoes = 'cut' | 'post' | 'keep'

export function JoinPicker({
  kind,
  onJoin,
  onBack,
  onNotice,
}: {
  kind: 'join' | 'editor'
  onJoin: (files: File[]) => void
  onBack: () => void
  onNotice: (message: string) => void
}) {
  const [parts, setParts] = useState<Picked[]>([])
  const alive = useRef(true)
  // Set on every mount, not only at the start: React mounts a screen twice in
  // development (StrictMode), and a flag left false by the first unmount made
  // the picked videos vanish there.
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

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
        <span className="label">{kind === 'join' ? 'Join clips' : 'Timeline editor'}</span>
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

      <button
        type="button"
        className="btn primary"
        disabled={parts.length === 0}
        onClick={() => {
          onJoin(parts.map((p) => p.file))
          setParts([])
        }}
      >
        {kind === 'join'
          ? parts.length < 2
            ? 'Join'
            : `Join ${parts.length} clips${known ? ` · ${formatTime(total)}` : ''}`
          : parts.length === 0
            ? 'Open in the timeline editor'
            : `Open in the timeline editor${parts.length > 1 ? ` · ${parts.length} videos` : ''}${known ? ` · ${formatTime(total)}` : ''}`}
      </button>
      <p className="hint montage-for">
        {kind === 'join'
          ? 'Put together in this order, then the pauses cut, captioned and named like any video - it shows up in your list to approve.'
          : 'Opens as filmed, straight away: nothing listened to, cut or captioned. Edit it your way - cuts, text, pictures, sounds. It is kept on your phone, not posted.'}
      </p>
    </div>
  )
}
