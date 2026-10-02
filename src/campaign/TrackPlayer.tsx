// A small play/stop button for a track in the batch bank, and a rename. The
// name is only a label he gives it (the file itself is untouched), so a track
// called "IMG_0042.m4a" can be told apart from the one he liked.

import { useEffect, useRef, useState } from 'react'

import type { BankFile } from './batch'
import { loadBankFile } from './store'

export function TrackPlayer({ file }: { file: BankFile }) {
  const audio = useRef<HTMLAudioElement | null>(null)
  const url = useRef<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const stop = () => {
    audio.current?.pause()
    setPlaying(false)
  }

  useEffect(
    () => () => {
      audio.current?.pause()
      if (url.current) URL.revokeObjectURL(url.current)
    },
    [],
  )

  const toggle = async () => {
    if (playing) return stop()
    setError(null)
    try {
      if (!audio.current) {
        const stored = await loadBankFile(file)
        if (!stored) throw new Error('This track is no longer on the phone.')
        url.current = URL.createObjectURL(stored)
        const element = new Audio(url.current)
        element.onended = () => setPlaying(false)
        audio.current = element
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
      <button type="button" className="btn small icon-btn" aria-label={playing ? `Stop ${file.name}` : `Play ${file.name}`} onClick={() => void toggle()}>
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
