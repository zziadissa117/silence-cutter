// Fixing a batch video after it was made, while its footage is still on the
// phone: the headline and the track. Making it again replaces its post when
// that has not gone out. (The reaction and product clips are the bank's; a
// different pair is a different video.)

import { useState } from 'react'

import type { BankFile } from './batch'
import { ChevronLeft } from './icons'
import { LIMITS } from './look'
import { ensureSong, useMusicBank } from './musicBank'
import { loadBankFile } from './store'
import { PlayButton } from './TrackPlayer'

export function BatchEdit({
  name,
  headline,
  music,
  options,
  posted,
  onMake,
  onCancel,
}: {
  name: string
  headline: string
  music: BankFile | null
  /** The tracks in the campaign's bank, plus the one it has now. */
  options: BankFile[]
  /** Already posted: the edit goes out as a new post. */
  posted: boolean
  onMake: (fields: { headline: string; music: BankFile | null }) => void
  onCancel: () => void
}) {
  const [text, setText] = useState(headline)
  const [track, setTrack] = useState(music?.id ?? '')
  const bank = useMusicBank()
  const fromBank = bank.filter((song) => !options.some((o) => o.id === song.id))
  const chosen = [...options, ...fromBank].find((o) => o.id === track)
  // A song from the shared bank may still be on the server only.
  const inBank = fromBank.some((o) => o.id === track)
  const [getting, setGetting] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  return (
    <section className="screen" aria-label={`Edit ${name}`}>
      <button type="button" className="back" onClick={onCancel}>
        <ChevronLeft /> Posts
      </button>
      <h1>Edit this video</h1>
      <p className="hint">{name}</p>
      {posted ? <p className="hint warn-text">It already posted, so the edited one goes out as a new post.</p> : null}
      <label className="field">
        <span className="label">Headline</span>
        <input type="text" value={text} maxLength={LIMITS.headlineChars} placeholder="No headline" onChange={(e) => setText(e.target.value)} />
      </label>
      <label className="field">
        <span className="label">Music</span>
        <div className="music-pick">
          <select value={track} onChange={(e) => setTrack(e.target.value)}>
            {options.length > 0 ? (
              <optgroup label="This campaign's Batch music">
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {fromBank.length > 0 ? (
              <optgroup label="Music bank">
                {fromBank.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </optgroup>
            ) : null}
            <option value="">No music</option>
          </select>
          {chosen ? <PlayButton name={chosen.name} load={() => (inBank ? ensureSong(chosen) : loadBankFile(chosen))} /> : null}
        </div>
      </label>
      <button
        type="button"
        className="btn primary wide"
        disabled={getting}
        onClick={() => {
          if (!chosen || !inBank) return onMake({ headline: text.trim(), music: chosen ?? null })
          setGetting(true)
          setProblem(null)
          void ensureSong(chosen)
            .then((file) => (file ? onMake({ headline: text.trim(), music: chosen }) : setProblem(`${chosen.name} couldn't be brought to this phone - try again with signal.`)))
            .finally(() => setGetting(false))
        }}
      >
        {getting ? 'Getting the song…' : 'Make it again'}
      </button>
      {problem ? <p className="error">{problem}</p> : null}
    </section>
  )
}
