// A small play/stop button for a track in the batch bank, and a rename. The
// name is only a label he gives it (the file itself is untouched), so a track
// called "IMG_0042.m4a" can be told apart from the one he liked.

import { useEffect, useRef, useState } from 'react'

import type { BankFile } from './batch'
import { loadBankFile } from './store'

export function TrackPlayer({ file }: { file: BankFile }) {
  return <PlayButton name={file.name} load={() => loadBankFile(file)} />
}

/** The one track playing anywhere on the page, and how to tell its button
 *  it stopped. Playing another always stops it first - a track picked while
 *  another played went on under the new one (his report, 2026-11-06). */
let current: { element: HTMLAudioElement; stopped: () => void } | null = null

function stopCurrent(): void {
  if (!current) return
  current.element.pause()
  current.stopped()
  current = null
}

/** Play/stop for whichever track is picked: `load` reads it when he taps,
 *  and a new `name` (another track picked) stops the one playing. Only one
 *  plays at a time, anywhere on the page. */
export function PlayButton({ name, load, disabled = false }: { name: string; load: () => Promise<Blob | null>; disabled?: boolean }) {
  const audio = useRef<HTMLAudioElement | null>(null)
  const url = useRef<string | null>(null)
  /** Bumped by each tap and each track change: a load still going for an
   *  older one never starts playing. */
  const turn = useRef(0)
  const [playing, setPlaying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const release = () => {
    turn.current++
    if (current && current.element === audio.current) stopCurrent()
    audio.current?.pause()
    audio.current = null
    if (url.current) URL.revokeObjectURL(url.current)
    url.current = null
    setPlaying(false)
  }

  // Another track picked, or the button gone: the old one stops and is let go.
  useEffect(() => {
    setError(null)
    return release
  }, [name]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = async () => {
    const mine = ++turn.current
    if (playing) {
      if (current && current.element === audio.current) stopCurrent()
      else audio.current?.pause()
      setPlaying(false)
      return
    }
    setError(null)
    // Whatever plays elsewhere stops now, not once this one has loaded.
    stopCurrent()
    try {
      if (!audio.current) {
        const stored = await load()
        if (turn.current !== mine) return
        if (!stored) throw new Error('This track is no longer on the phone.')
        url.current = URL.createObjectURL(stored)
        const element = new Audio(url.current)
        element.onended = () => {
          if (current?.element === element) current = null
          setPlaying(false)
        }
        audio.current = element
      }
      const element = audio.current
      stopCurrent()
      current = { element, stopped: () => setPlaying(false) }
      element.currentTime = 0
      await element.play()
      if (turn.current !== mine) {
        element.pause()
        return
      }
      setPlaying(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <>
      <button
        type="button"
        className="btn small icon-btn"
        disabled={disabled}
        aria-label={playing ? `Stop ${name}` : `Play ${name}`}
        onClick={() => void toggle()}
      >
        {playing ? '■' : '▶'}
      </button>
      {error ? <span className="hint warn-text">{error}</span> : null}
    </>
  )
}

/** The track's name, tap to rename. Empty keeps the old name. */
export function TrackName({ name, onRename }: { name: string; onRename: (name: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(name)
  if (!editing) {
    return (
      <button
        type="button"
        className="bank-name as-button"
        title="Tap to rename"
        onClick={() => {
          setValue(name)
          setEditing(true)
        }}
      >
        {name}
      </button>
    )
  }
  const done = () => {
    setEditing(false)
    const next = value.trim()
    if (next && next !== name) onRename(next)
  }
  return (
    <input
      className="bank-name"
      autoFocus
      value={value}
      maxLength={80}
      aria-label="Track name"
      onChange={(e) => setValue(e.target.value)}
      onBlur={done}
      onKeyDown={(e) => {
        if (e.key === 'Enter') done()
        if (e.key === 'Escape') setEditing(false)
      }}
    />
  )
}
