// A small play/stop button for a track in the batch bank, and a rename. The
// name is only a label he gives it (the file itself is untouched), so a track
// called "IMG_0042.m4a" can be told apart from the one he liked.

import { useEffect, useRef, useState } from 'react'

import type { BankFile } from './batch'
import { loadBankFile } from './store'

export function TrackPlayer({ file }: { file: BankFile }) {
  return <PlayButton name={file.name} load={() => loadBankFile(file)} />
}

/** Play/stop for whichever track is picked: `load` reads it when he taps,
 *  and a new `name` (another track picked) stops the one playing. Only one
 *  plays at a time, anywhere on the page. */
export function PlayButton({ name, load, disabled = false }: { name: string; load: () => Promise<Blob | null>; disabled?: boolean }) {
  const audio = useRef<HTMLAudioElement | null>(null)
  const url = useRef<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const release = () => {
    audio.current?.pause()
    audio.current = null
    if (url.current) URL.revokeObjectURL(url.current)
    url.current = null
    setPlaying(false)
  }

  // Another track picked: the old one stops and is let go.
  useEffect(() => {
    setError(null)
    return release
  }, [name])

  const toggle = async () => {
    if (playing) {
      audio.current?.pause()
      setPlaying(false)
      return
    }
    setError(null)
    try {
      if (!audio.current) {
        const stored = await load()
        if (!stored) throw new Error('This track is no longer on the phone.')
        url.current = URL.createObjectURL(stored)
        const element = new Audio(url.current)
        element.onended = () => setPlaying(false)
        audio.current = element
      }
      nowPlaying?.()
      nowPlaying = () => {
        audio.current?.pause()
        setPlaying(false)
      }
      audio.current.currentTime = 0
      await audio.current.play()
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

/** Stops whatever PlayButton is playing, so two never play over each other. */
let nowPlaying: (() => void) | null = null

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
