// Fixing a batch video after it was made, while its footage is still on the
// phone: the headline and the track. Making it again replaces its post when
// that has not gone out. (The reaction and product clips are the bank's; a
// different pair is a different video.)

import { useState } from 'react'

import type { BankFile } from './batch'
import { ChevronLeft } from './icons'
import { LIMITS } from './look'

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
        <select value={track} onChange={(e) => setTrack(e.target.value)}>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
          <option value="">No music</option>
        </select>
      </label>
      <button
        type="button"
        className="btn primary wide"
        onClick={() => onMake({ headline: text.trim(), music: options.find((o) => o.id === track) ?? null })}
      >
        Make it again
      </button>
    </section>
  )
}
