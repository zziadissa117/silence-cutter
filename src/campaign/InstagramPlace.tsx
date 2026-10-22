// The place every Instagram post is tagged with, in Settings, Posting - and
// a campaign's own, in its Posting: paste the place's Facebook page (or its
// Instagram location page, or its ID) once, and every Instagram post carries
// it (supabase/functions/postiz/place.ts). Postiz doesn't hand it on to
// Instagram yet; that is said plainly beside it.

import { useState } from 'react'

import { parsePlace, type Place } from '../../supabase/functions/postiz/place.ts'
import { PostingError } from './posting'

/** Said beside every place until Postiz passes it on. */
export const PLACE_WAITS_ON_POSTIZ =
  "Postiz doesn't pass the place on to Instagram yet - we asked them to. Every post carries it from now on, and it shows on Instagram the day they add it."

const HOW =
  "Paste the place's Facebook page link - or its Instagram location page, or its ID. A page known only by its short name (facebook.com/LosAngeles) has its ID under About, Page transparency."

export function PlaceField({
  place,
  label,
  emptyLine,
  tagged = 'every Instagram post',
  onSave,
}: {
  place: Place | null
  label: string
  /** Which posts it tags. */
  tagged?: string
  /** What it says with no place. */
  emptyLine: string
  onSave: (place: Place | null) => Promise<unknown>
}) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<string | null>(null)

  const save = async (next: Place | null) => {
    setBusy(true)
    setSaid(null)
    try {
      await onSave(next)
      setText('')
    } catch (error) {
      setSaid(error instanceof PostingError ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }
  const add = () => {
    const next = parsePlace(text)
    if (!next) return setSaid(`No place could be read from that. ${HOW}`)
    void save(next)
  }

  return (
    <>
      <div className="setting instagram-place">
        <div className="setting-text">
          <span className="row-name">{label}</span>
          <span className="row-line wrap">{place ? `${place.name} · tagged on ${tagged}` : emptyLine}</span>
          {place ? <span className="row-line wrap hint">{PLACE_WAITS_ON_POSTIZ}</span> : null}
        </div>
        {place ? (
          <button type="button" className="btn small" disabled={busy} onClick={() => void save(null)}>
            Remove
          </button>
        ) : null}
      </div>
      <div className="actions-row buffer-key">
        <input
          type="text"
          className="find"
          inputMode="url"
          aria-label={`${label}: the place's Facebook page`}
          placeholder={place ? 'Another place - its Facebook page link' : "The place's Facebook page link"}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="button" className="btn small" disabled={busy || !text.trim()} onClick={add}>
          {busy ? 'Saving…' : 'Set'}
        </button>
      </div>
      {said ? <p className="hint warn-text">{said}</p> : null}
    </>
  )
}
