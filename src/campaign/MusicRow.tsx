// An angle's background music: his own track, how far into the background
// it sits, and a play button to check it is the right one. The level itself
// is set against his voice when each video is made - see music.ts - so a
// loud master and a quiet one end up the same.

import { useEffect, useRef, useState } from 'react'

import { play, type Playing } from './listen'
import type { AngleMusic } from './look'
import type { MusicLevel } from './music'
import { songFile, songName, useMusicBank } from './musicBank'
import { TrackName } from './TrackPlayer'

/** Big enough for any song; small enough to share with the other phone. */
const MAX_MB = 30

const LEVELS: { value: MusicLevel; label: string }[] = [
  { value: 'normal', label: 'Background' },
  { value: 'low', label: 'Quieter' },
]

export function MusicRow({ music, onChange }: { music: AngleMusic | null; onChange: (music: AngleMusic | null) => void }) {
  const picker = useRef<HTMLInputElement>(null)
  const playing = useRef<Playing | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const songs = useMusicBank()

  useEffect(() => () => playing.current?.stop(), [])

  const stop = () => {
    playing.current?.stop()
    playing.current = null
    setIsPlaying(false)
  }

  const hear = async () => {
    if (!music) return
    if (isPlaying) {
      stop()
      return
    }
    setError(null)
    try {
      const now = await play({ kind: 'file', name: music.name, audio: music.audio }, 0)
      playing.current = now
      setIsPlaying(true)
      void now.ended.then(() => setIsPlaying(false))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="group">
      <div className="group-title">Background music</div>
      <input
        ref={picker}
        type="file"
        accept="audio/*,.mp3,.m4a,.wav,.aac"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (!file) return
          if (file.size > MAX_MB * 1e6) {
            setError(`That track is over ${MAX_MB} MB - pick a shorter one or an MP3.`)
            return
          }
          stop()
          setError(null)
          onChange({ name: songName(file.name), audio: file, level: music?.level ?? 'normal' })
        }}
      />
      {music ? (
        <>
          <div className="music-track">
            <button type="button" className="btn play" aria-label={isPlaying ? 'Stop' : 'Play the track'} onClick={() => void hear()}>
              {isPlaying ? '■' : '▶'}
            </button>
            <TrackName name={music.name} onRename={(name) => onChange({ ...music, name })} />
          </div>
          <div className="seg full" role="radiogroup" aria-label="Music level">
            {LEVELS.map((l) => (
              <button
                key={l.value}
                type="button"
                role="radio"
                aria-checked={music.level === l.value}
                className={music.level === l.value ? 'active' : ''}
                onClick={() => onChange({ ...music, level: l.value })}
              >
                {l.label}
              </button>
            ))}
          </div>
          <div className="hint">Set under your voice in every video, and dips while you talk.</div>
          <div className="actions-row">
            <button type="button" className="btn small" onClick={() => picker.current?.click()}>
              Change track
            </button>
            <button
              type="button"
              className="linkbtn"
              onClick={() => {
                stop()
                onChange(null)
              }}
            >
              No music
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="hint">No music. Pick a track of your own to play under your voice.</div>
          <div>
            <button type="button" className="btn" onClick={() => picker.current?.click()}>
              Choose a track
            </button>
          </div>
        </>
      )}
      {songs.length > 0 ? (
        <label className="field">
          <span className="label">From the music bank</span>
          <select
            value=""
            aria-label="Pick a song from the music bank"
            onChange={(e) => {
              const song = songs.find((x) => x.id === e.target.value)
              if (!song) return
              stop()
              setError(null)
              void songFile(song).then((audio) =>
                audio ? onChange({ name: song.name, audio, level: music?.level ?? 'normal' }) : setError(`${song.name} is no longer on this phone.`),
              )
            }}
          >
            <option value="">Pick a song…</option>
            {songs.map((song) => (
              <option key={song.id} value={song.id}>
                {song.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {error ? <div className="error">{error}</div> : null}
    </div>
  )
}
