// The music bank, under the pictures: songs for every campaign, the same on
// every phone that uses the Cutter, each played with a tap and named as he
// likes - see musicBank.ts.

import { useEffect, useState } from 'react'

import { addSongs, removeSong, renameSong, songFile, syncSongs, useMusicBank } from './musicBank'
import { PlayButton, TrackName } from './TrackPlayer'

const mb = (bytes: number) => `${(bytes / 1e6).toFixed(1)} MB`

export function MusicBankView() {
  const bank = useMusicBank()
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  // What the others added since, as the screen opens.
  useEffect(() => {
    void syncSongs().catch(() => {})
  }, [])

  const add = async (files: File[]) => {
    setNotice(null)
    setProblem(null)
    setBusy('Keeping it on this phone…')
    try {
      const { added, skipped, failed } = await addSongs(files, setBusy)
      if (skipped.length > 0) setNotice(`${skipped.join(', ')} ${skipped.length === 1 ? 'is' : 'are'} in the bank already.`)
      if (failed.length > 0) setProblem(`Couldn't keep ${failed.join('; ')}.`)
      if (added.length > 0 && failed.length === 0 && skipped.length === 0) {
        setNotice(added.length === 1 ? 'Added. Tap its name to call it something you will recognise.' : `${added.length} added. Tap a name to change it.`)
      }
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="screen" aria-label="Music bank">
      <div className="screen-head">
        <h2>Music</h2>
        <div className="btn small primary picker">
          {busy ? 'Adding…' : 'Add music'}
          <input
            type="file"
            accept="audio/*,video/*,.mp3,.m4a,.wav,.aac,.mp4,.mov"
            multiple
            disabled={busy !== null}
            aria-label="Add music"
            onChange={(e) => {
              const picked = Array.from(e.target.files ?? [])
              e.target.value = ''
              if (picked.length > 0) void add(picked)
            }}
          />
        </div>
      </div>
      <p className="lede tip">
        Songs for every campaign, shared with everyone who uses the Cutter - a song added on one phone shows on all of them.
        Add an MP3 or a video - only its sound is kept. Name each one so you know it when you pick music for a video, and
        tap ▶ to hear it.
      </p>
      {busy ? <p className="hint">{busy}</p> : null}
      {notice ? <p className="hint">{notice}</p> : null}
      {problem ? <div className="error">{problem}</div> : null}
      {bank.length === 0 ? <p className="empty">No songs yet.</p> : null}
      <ul className="bank-list">
        {bank.map((song) => (
          <li key={song.id} className="bank-item">
            <PlayButton name={song.name} load={() => songFile(song)} />
            <TrackName name={song.name} onRename={(name) => void renameSong(song.id, name)} />
            <span className="hint">{mb(song.size)}</span>
            <button
              type="button"
              className="linkbtn"
              aria-label={`Take out ${song.name}`}
              onClick={() => {
                if (window.confirm(`Take ${song.name} out of the music bank - on every phone? Videos already made keep it.`)) void removeSong(song.id)
              }}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
