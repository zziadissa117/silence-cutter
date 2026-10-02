// A video with no talking, put together by hand: the campaign it posts for,
// his clips in order (a reaction, then the product showcase - or however
// many he wants), a headline over the first, and background music, the only
// thing heard. Make it, and it joins the list like any other video: made in
// turn, then sent to Postiz for that campaign.

import { useEffect, useRef, useState } from 'react'

import { VideoPicker } from '../VideoPicker'
import { pickArrived, pickSaved } from '../pickWatch'
import { filmingOf } from './filming'
import { musicTracks } from './JobRow'
import { formatTime, labelOf } from './jobs'
import { LIMITS, type Angle, type Campaign } from './look'

/** Big enough for any song. */
const MAX_SONG_MB = 30

interface Picked {
  key: string
  file: File
  seconds?: number
}

export interface Montage {
  files: File[]
  /** "" for the angle's track, "none", "campaignId:angleId", or "song". */
  music: string
  song: File | null
}

let nextKey = 0

export function ClipsMaker({
  campaigns,
  campaign,
  angle,
  headline,
  onSelect,
  onHeadline,
  onMake,
  onBack,
  onNotice,
}: {
  campaigns: Campaign[]
  campaign: Campaign
  angle: Angle
  headline: string
  onSelect: (campaign: Campaign, angle?: Angle) => void
  onHeadline: (text: string) => void
  onMake: (montage: Montage) => void
  onBack: () => void
  onNotice: (message: string) => void
}) {
  const [clips, setClips] = useState<Picked[]>([])
  const [music, setMusic] = useState('')
  const [song, setSong] = useState<File | null>(null)
  const [songError, setSongError] = useState<string | null>(null)
  const alive = useRef(true)
  useEffect(
    () => () => {
      alive.current = false
    },
    [],
  )

  const add = (files: File[]) => {
    const problem = pickArrived(files)
    if (problem) {
      onNotice(problem)
      return
    }
    const added = files.map((file) => ({ key: `clip-${nextKey++}`, file }))
    setClips((current) => [...current, ...added])
    pickSaved()
    // How long each is, for the total - it never holds adding them up.
    for (const clip of added) {
      void filmingOf(clip.file).then(({ seconds }) => {
        if (!alive.current || seconds === undefined) return
        setClips((current) => current.map((c) => (c.key === clip.key ? { ...c, seconds } : c)))
      })
    }
  }

  const move = (from: number, to: number) =>
    setClips((current) => {
      if (to < 0 || to >= current.length) return current
      const next = [...current]
      const [clip] = next.splice(from, 1)
      next.splice(to, 0, clip)
      return next
    })

  const remove = (key: string) => setClips((current) => current.filter((c) => c.key !== key))

  const known = clips.every((c) => c.seconds !== undefined)
  const total = clips.reduce((sum, c) => sum + (c.seconds ?? 0), 0)
  const others = musicTracks(campaigns).filter((t) => t.value !== `${campaign.id}:${angle.id}`)
  const silent = music === 'none' || (music === '' && !angle.music) || (music === 'song' && !song)

  const make = () => {
    if (clips.length === 0 || (music === 'song' && !song)) return
    onMake({ files: clips.map((c) => c.file), music, song: music === 'song' ? song : null })
    setClips([])
  }

  return (
    <div className="chooser montage">
      <div className="chooser-head">
        <span className="label">Clips + music · no talking</span>
        <button type="button" className="linkbtn" onClick={onBack}>
          Back
        </button>
      </div>

      <select aria-label="Campaign" value={campaign.id} onChange={(e) => {
        const next = campaigns.find((c) => c.id === e.target.value)
        if (next) onSelect(next)
      }}>
        {campaigns.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      {campaign.angles.length > 1 ? (
        <div className="seg chips" role="radiogroup" aria-label="Angle">
          {campaign.angles.map((a) => (
            <button
              key={a.id}
              type="button"
              role="radio"
              aria-checked={a.id === angle.id}
              className={a.id === angle.id ? 'active' : ''}
              onClick={() => onSelect(campaign, a)}
            >
              {a.name}
            </button>
          ))}
        </div>
      ) : null}

      {clips.length > 0 ? (
        <ol className="montage-clips" aria-label="Clips, in order">
          {clips.map((clip, i) => (
            <li key={clip.key} className="montage-clip">
              <span className="montage-n">{i + 1}</span>
              <span className="montage-text">
                <span className="montage-name">{clip.file.name}</span>
                <span className="hint">
                  {clip.seconds !== undefined ? formatTime(clip.seconds) : '…'}
                  {i === 0 && headline.trim() ? ' · headline on this one' : ''}
                </span>
              </span>
              <button type="button" className="btn small icon-btn" aria-label={`Move ${clip.file.name} up`} disabled={i === 0} onClick={() => move(i, i - 1)}>
                ↑
              </button>
              <button
                type="button"
                className="btn small icon-btn"
                aria-label={`Move ${clip.file.name} down`}
                disabled={i === clips.length - 1}
                onClick={() => move(i, i + 1)}
              >
                ↓
              </button>
              <button type="button" className="btn small icon-btn" aria-label={`Take out ${clip.file.name}`} onClick={() => remove(clip.key)}>
                ✕
              </button>
            </li>
          ))}
        </ol>
      ) : null}
      <VideoPicker className={clips.length > 0 ? 'btn add-more' : 'btn add-more primary'} label="Add clips" onFiles={add}>
        {clips.length > 0 ? '+ Add another clip' : '+ Add clips, in order'}
      </VideoPicker>

      <input
        type="text"
        aria-label="Headline on the first clip"
        value={headline}
        maxLength={LIMITS.headlineChars}
        placeholder="Headline on the first clip (none)"
        onChange={(e) => onHeadline(e.target.value)}
      />

      <label className="field">
        <span className="label">Background music</span>
        <select value={music} onChange={(e) => setMusic(e.target.value)}>
          <option value="">{angle.music ? `The angle's: ${angle.music.name}` : "The angle's: none"}</option>
          {others.map((t) => (
            <option key={t.value} value={t.value}>
              {t.name}
            </option>
          ))}
          <option value="song">{song ? `Your song: ${song.name}` : 'A song from your phone…'}</option>
          <option value="none">No music</option>
        </select>
      </label>
      {music === 'song' ? (
        <div className="product-row">
          <span className="product-text">
            <span className="label">Song</span>
            <span className="hint">{song ? song.name : 'An MP3, M4A or WAV from Files'}</span>
          </span>
          <div className={`${song ? 'btn small' : 'btn small primary'} picker`}>
            {song ? 'Change' : 'Choose'}
            <input
              type="file"
              accept="audio/*,.mp3,.m4a,.wav,.aac"
              aria-label="Choose a song"
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (!file) return
                if (file.size > MAX_SONG_MB * 1e6) {
                  setSongError(`That song is over ${MAX_SONG_MB} MB - pick a shorter one or an MP3.`)
                  return
                }
                setSongError(null)
                setSong(file)
              }}
            />
          </div>
          {songError ? <p className="error">{songError}</p> : null}
        </div>
      ) : null}
      <p className="hint">
        {silent ? 'No music picked, so the video will be silent.' : "Only the music is heard - the clips' own sound is left out."}
      </p>

      <button type="button" className="btn primary" disabled={clips.length === 0 || (music === 'song' && !song)} onClick={make}>
        {clips.length === 0
          ? 'Make it'
          : `Make it · ${clips.length} clip${clips.length === 1 ? '' : 's'}${known ? ` · ${formatTime(total)}` : ''}`}
      </button>
      <p className="hint montage-for">For {labelOf(campaign, angle)}</p>
    </div>
  )
}
