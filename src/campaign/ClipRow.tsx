// An angle's video before or after: a clip from the phone that every video
// in the angle gets, to watch, change or take off. Kept on this phone only -
// see clips.ts.

import { useEffect, useState } from 'react'

import { VideoPicker } from '../VideoPicker'
import { clipFile, type ClipInfo, type ClipPlace } from './clips'
import { clipName } from './ClipsField'

const TITLE: Record<ClipPlace, string> = { before: 'Video before', after: 'Video after' }
const NONE: Record<ClipPlace, string> = {
  before: 'None. A clip here plays before you in every video of this angle - a hook, say.',
  after: 'None. A clip here plays after you in every video of this angle - a product showcase, say.',
}

export function ClipRow({
  place,
  clipId,
  all,
  onChange,
  onAdd,
}: {
  place: ClipPlace
  clipId: string | undefined
  /** Every clip on this phone, newest first. */
  all: ClipInfo[]
  onChange: (clipId: string | null) => void
  onAdd: (file: File) => Promise<ClipInfo>
}) {
  const clip = all.find((c) => c.id === clipId)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [watching, setWatching] = useState<string | null>(null)
  const others = all.filter((c) => c.id !== clipId)

  // Read from the phone only when he asks to watch it.
  useEffect(() => {
    setWatching(null)
  }, [clipId])
  useEffect(
    () => () => {
      if (watching) URL.revokeObjectURL(watching)
    },
    [watching],
  )

  const watch = async () => {
    if (!clip) return
    const blob = await clipFile(clip.id).catch(() => null)
    if (!blob) {
      setError("This clip isn't on the phone any more. Choose it again.")
      return
    }
    setWatching(URL.createObjectURL(blob))
  }

  const pick = (files: File[]) => {
    const file = files[0]
    if (!file) return
    setAdding(true)
    setError(null)
    onAdd(file)
      .then((added) => onChange(added.id))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setAdding(false))
  }

  return (
    <div className="group">
      <div className="group-title">{TITLE[place]}</div>
      {clip ? (
        <>
          <div className="music-track">
            <button type="button" className="btn play" aria-label="Watch the clip" onClick={() => void watch()}>
              ▶
            </button>
            <span className="music-name">{clipName(clip)}</span>
          </div>
          {watching ? <video className="clip-watch" src={watching} controls autoPlay playsInline /> : null}
        </>
      ) : (
        <div className="hint">{clipId ? "This clip isn't on the phone any more. Choose it again." : NONE[place]}</div>
      )}
      {others.length > 0 ? (
        <label className="field">
          <span className="label">{clip ? 'Or use another clip on this phone' : 'Use a clip on this phone'}</span>
          <select value="" onChange={(e) => e.target.value && onChange(e.target.value)}>
            <option value="" disabled>
              Pick one
            </option>
            {others.map((c) => (
              <option key={c.id} value={c.id}>
                {clipName(c)}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <div className="actions-row product-row">
        {adding ? (
          <span className="hint">Adding…</span>
        ) : (
          <VideoPicker className={clip ? 'btn small' : 'btn'} label={`Choose the ${TITLE[place].toLowerCase()}`} onFiles={pick}>
            {clip ? 'Change clip' : 'Choose a clip'}
          </VideoPicker>
        )}
        {clipId ? (
          <button type="button" className="linkbtn" onClick={() => onChange(null)}>
            No {TITLE[place].toLowerCase()}
          </button>
        ) : null}
      </div>
      {error ? <div className="error">{error}</div> : null}
    </div>
  )
}
