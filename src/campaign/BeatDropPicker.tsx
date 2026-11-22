// Marking a song's beat drop for a batch (his ask, 2026-11-23: "you click on
// the song, and you listen to the song until the beat drop happens. You
// click when the beat drop happens, and you select precisely the time frame
// of the beat drop"). The song plays; he taps on the drop; the tap is moved
// onto the hit itself in the sound (beatDrop.snapToHit - a finger is always
// a little late); ± nudges it; Hear it plays the few seconds around it.

import { useEffect, useRef, useState } from 'react'

import type { BankFile } from './batch'
import { loudness, snapToHit } from './beatDrop'
import { FullPage } from './FullPage'
import { CloseIcon } from './icons'
import { loadBankFile } from './store'

const clock = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`

export function BeatDropPicker({ file, drop, onSave, onClose }: { file: BankFile; drop: number | null; onSave: (drop: number | null) => void; onClose: () => void }) {
  const audio = useRef<HTMLAudioElement>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [level, setLevel] = useState<Float32Array | null>(null)
  const [at, setAt] = useState<number | null>(drop)
  const [now, setNow] = useState(0)
  const [length, setLength] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [snapped, setSnapped] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  /** Hear it: where it stops by itself. */
  const stopAt = useRef<number | null>(null)

  useEffect(() => {
    let alive = true
    let made: string | null = null
    void loadBankFile(file).then(async (blob) => {
      if (!alive) return
      if (!blob) return setProblem('This song is no longer on this phone.')
      made = URL.createObjectURL(blob)
      setUrl(made)
      // Its loudness, to snap taps onto the hit (none: taps stay as tapped).
      try {
        const context = new OfflineAudioContext(1, 1, 22050)
        const decoded = await context.decodeAudioData(await blob.arrayBuffer())
        const channels = Array.from({ length: decoded.numberOfChannels }, (_, c) => decoded.getChannelData(c))
        if (alive) setLevel(loudness(channels, decoded.sampleRate))
      } catch {
        // Not decodable here: the tap is used as it is.
      }
    })
    return () => {
      alive = false
      if (made) URL.revokeObjectURL(made)
    }
  }, [file])

  const play = (from?: number) => {
    const el = audio.current
    if (!el) return
    if (from !== undefined) el.currentTime = Math.max(0, from)
    void el.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
  }
  const pause = () => {
    audio.current?.pause()
    setPlaying(false)
    stopAt.current = null
  }

  const tap = () => {
    const el = audio.current
    if (!el) return
    const t = el.currentTime
    const hit = level ? snapToHit(level, t) : t
    setSnapped(level !== null && Math.abs(hit - t) > 0.005)
    setAt(hit)
    pause()
  }
  const nudge = (by: number) => {
    setSnapped(false)
    setAt((a) => (a === null ? a : Math.max(0, Math.round((a + by) * 1000) / 1000)))
  }
  const hear = () => {
    if (at === null) return
    stopAt.current = at + 2
    play(at - 3)
  }

  return (
    <FullPage>
      <div className="beat-drop">
        <div className="clip-editor-head">
          <span className="clip-editor-title">
            <span className="row-name">Beat drop</span>
            <span className="hint">{file.name}</span>
          </span>
          <button type="button" className="clip-editor-close" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        {problem ? <p className="hint warn-text">{problem}</p> : null}
        {url ? (
          <audio
            ref={audio}
            src={url}
            preload="auto"
            onLoadedMetadata={(e) => setLength(e.currentTarget.duration || 0)}
            onTimeUpdate={(e) => {
              const t = e.currentTarget.currentTime
              setNow(t)
              if (stopAt.current !== null && t >= stopAt.current) pause()
            }}
            onEnded={() => setPlaying(false)}
          />
        ) : null}
        <p className="hint tip">Play the song and tap the big button the moment the beat drops. Videos synced to it switch from you to the product right on it.</p>
        <div className="beat-drop-time">{clock(now)}</div>
        <input
          type="range"
          className="beat-drop-seek"
          min={0}
          max={Math.max(1, length)}
          step={0.01}
          value={now}
          aria-label="Where in the song"
          onChange={(e) => {
            const t = Number(e.target.value)
            if (audio.current) audio.current.currentTime = t
            setNow(t)
          }}
        />
        <div className="actions-row">
          <button type="button" className="btn" disabled={!url} onClick={() => (playing ? pause() : play())}>
            {playing ? 'Pause' : 'Play'}
          </button>
        </div>
        <button type="button" className="btn primary beat-drop-tap" disabled={!url || !playing} onClick={tap}>
          Tap on the beat drop
        </button>

        {at !== null ? (
          <div className="beat-drop-mark">
            <span className="row-name">Beat drop at {clock(at)}</span>
            {snapped ? <span className="hint">Moved onto the hit in the sound.</span> : null}
            <div className="actions-row">
              {[-0.1, -0.02, 0.02, 0.1].map((by) => (
                <button key={by} type="button" className="btn small" onClick={() => nudge(by)}>
                  {by > 0 ? '+' : '−'}
                  {Math.abs(by).toFixed(2)} s
                </button>
              ))}
            </div>
            <div className="actions-row">
              <button type="button" className="btn small" onClick={hear}>
                Hear it
              </button>
            </div>
          </div>
        ) : null}

        <div className="editor-foot sticky">
          {drop !== null ? (
            <button
              type="button"
              className="btn danger"
              onClick={() => {
                onSave(null)
                onClose()
              }}
            >
              Remove
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            className="btn primary"
            disabled={at === null}
            onClick={() => {
              onSave(at)
              onClose()
            }}
          >
            Save
          </button>
        </div>
      </div>
    </FullPage>
  )
}
