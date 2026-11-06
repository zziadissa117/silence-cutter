// What one video has joined onto it, set while reviewing it: an Add list -
// videos before and after for now; B-roll and pictures can join it later -
// and a line for each clip in use, to swap it for another clip on the phone,
// take a new one from the phone, or leave it off this video.

import { useEffect, useState } from 'react'

import { VideoPicker } from '../VideoPicker'
import { CLIP_PLACES, clipFile, type AngleClips, type ClipInfo, type ClipPlace } from './clips'
import { formatTime } from './jobs'

const LABEL: Record<ClipPlace, string> = { before: 'Video before', after: 'Video after' }

export const clipName = (clip: ClipInfo) => `${clip.name} · ${formatTime(clip.seconds)}`

export function ClipsField({
  picks,
  angle,
  all,
  compact = false,
  onPick,
  onNew,
  cues = [],
  cuesOff = false,
  onCuesOff,
  muted,
  onMute,
}: {
  /** Whether its clip before or after plays without its sound, and a way to
   *  change it (2026-11-06: with its sound unless he mutes it). */
  muted?: (place: ClipPlace) => boolean
  onMute?: (place: ClipPlace, muted: boolean) => void
  /** This video's own picks: a clip's id, or "none". Absent: the angle's. */
  picks: Partial<Record<ClipPlace, string>>
  /** The clips set on its angle. */
  angle: AngleClips
  /** Every clip on this phone, newest first. */
  all: ClipInfo[]
  /** Tighter, for the caption check screen. */
  compact?: boolean
  /** A clip's id, "none", or "" for the angle's own. */
  onPick: (place: ClipPlace, choice: string) => void
  /** Keeps a clip from the phone and picks it for this video. */
  onNew: (place: ClipPlace, file: File) => Promise<void>
  /** The angle's videos in the middle, and whether this video says each phrase. */
  cues?: { phrase: string; clipName: string; said: boolean }[]
  /** They are left off this video. */
  cuesOff?: boolean
  onCuesOff?: (off: boolean) => void
}) {
  const [added, setAdded] = useState<ClipPlace[]>([])
  const shown = CLIP_PLACES.filter((p) => angle[p] || picks[p] || added.includes(p))
  const free = CLIP_PLACES.filter((p) => !shown.includes(p))

  return (
    <div className={`clips-field${compact ? ' compact' : ''}`}>
      {shown.map((place) => (
        <ClipLine
          key={place}
          place={place}
          pick={picks[place]}
          angleClip={all.find((c) => c.id === angle[place])}
          all={all}
          onPick={(choice) => {
            // Nothing on the angle to fall back to: "none" is the same as
            // never having added it.
            if (choice === 'none' && !angle[place]) {
              setAdded((a) => a.filter((p) => p !== place))
              onPick(place, '')
            } else onPick(place, choice)
          }}
          onNew={(file) => onNew(place, file)}
          onCancel={() => setAdded((a) => a.filter((p) => p !== place))}
          muted={muted?.(place)}
          onMute={onMute ? (m) => onMute(place, m) : undefined}
        />
      ))}
      {cues.length > 0 ? (
        <div className="clip-cues">
          {cues.map((cue, i) => (
            <div key={i} className="clip-line">
              <span className="clip-label">Video in the middle</span>
              <span className="hint">
                After "{cue.phrase}": {cue.clipName}
                {cuesOff ? '' : cue.said ? '' : ' - not said in this video'}
              </span>
            </div>
          ))}
          {onCuesOff ? (
            <label className="clip-cues-off">
              <input type="checkbox" checked={!cuesOff} onChange={(e) => onCuesOff(!e.target.checked)} /> In this video
            </label>
          ) : null}
        </div>
      ) : null}
      {free.length > 0 ? (
        <select
          className="clip-add"
          value=""
          aria-label="Add to this video"
          onChange={(e) => {
            const place = e.target.value as ClipPlace
            if (place) setAdded((a) => [...a, place])
          }}
        >
          <option value="" disabled hidden>
            ＋ Add
          </option>
          {free.map((p) => (
            <option key={p} value={p}>
              {LABEL[p]}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  )
}

function ClipLine({
  place,
  pick,
  angleClip,
  all,
  onPick,
  onNew,
  onCancel,
  muted,
  onMute,
}: {
  muted?: boolean
  onMute?: (muted: boolean) => void
  place: ClipPlace
  pick: string | undefined
  angleClip: ClipInfo | undefined
  all: ClipInfo[]
  onPick: (choice: string) => void
  onNew: (file: File) => Promise<void>
  onCancel: () => void
}) {
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const others = all.filter((c) => c.id !== angleClip?.id)
  const nothingYet = !pick && !angleClip
  // The clip this video gets, to watch here with its sound.
  const chosen = pick === 'none' ? undefined : pick ? all.find((c) => c.id === pick) : angleClip
  const [watching, setWatching] = useState<string | null>(null)
  useEffect(
    () => () => {
      if (watching) URL.revokeObjectURL(watching)
    },
    [watching],
  )
  const watch = async () => {
    if (watching) {
      setWatching(null)
      return
    }
    if (!chosen) return
    const blob = await clipFile(chosen.id).catch(() => null)
    if (blob) setWatching(URL.createObjectURL(blob))
    else setError("This clip isn't on the phone any more. Choose it again.")
  }

  return (
    <div className="clip-line">
      <span className="clip-label">{LABEL[place]}</span>
      {angleClip || others.length > 0 ? (
        <select value={pick ?? ''} aria-label={LABEL[place]} onChange={(e) => onPick(e.target.value)}>
          {angleClip ? (
            <option value="">The angle's: {clipName(angleClip)}</option>
          ) : (
            <option value="" disabled>
              Choose a clip
            </option>
          )}
          {others.map((c) => (
            <option key={c.id} value={c.id}>
              {clipName(c)}
            </option>
          ))}
          <option value="none">None</option>
        </select>
      ) : null}
      {adding ? (
        <span className="hint">Adding…</span>
      ) : (
        <VideoPicker
          className={nothingYet && others.length === 0 ? 'btn small primary' : 'btn small'}
          label={`A new ${LABEL[place].toLowerCase()} from your phone`}
          onFiles={(files) => {
            const file = files[0]
            if (!file) return
            setAdding(true)
            setError(null)
            onNew(file)
              .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
              .finally(() => setAdding(false))
          }}
        >
          {nothingYet && others.length === 0 ? 'Choose from phone' : 'New'}
        </VideoPicker>
      )}
      {nothingYet && !adding ? (
        <button type="button" className="linkbtn" onClick={onCancel}>
          Cancel
        </button>
      ) : null}
      {chosen ? (
        <span className="clip-sound">
          <button type="button" className="btn small" onClick={() => void watch()} aria-label={watching ? 'Close' : `Watch the ${LABEL[place].toLowerCase()}`}>
            {watching ? 'Close' : '▶ Watch'}
          </button>
          {onMute ? (
            <button type="button" className={`btn small${muted ? '' : ' on'}`} aria-pressed={!muted} onClick={() => onMute(!muted)}>
              {muted ? '🔇 Muted' : '🔊 Sound on'}
            </button>
          ) : null}
        </span>
      ) : null}
      {watching ? <video className="clip-watch" src={watching} controls playsInline autoPlay muted={muted} /> : null}
      {error ? <div className="error">{error}</div> : null}
    </div>
  )
}
