// One sound in an angle: which sound, when it plays, and how loud - with a
// play button and a meter, so he hears it and sees its level before it goes
// into a single video. Tapping a sound to choose it also plays it.

import { useEffect, useRef, useState } from 'react'

import { BUILT_IN_SOUNDS, LIMITS, type AngleSound, type BuiltInSound } from './look'
import { peakDb, play, type Playing } from './listen'

/** The meter's range: 40 dB below full scale up to full scale. */
const FLOOR_DB = -40

export function SoundRow({
  index,
  sound,
  wordsText,
  hasBrand,
  onWordsText,
  onChange,
  onRemove,
}: {
  index: number
  sound: AngleSound
  wordsText: string
  /** Whether the campaign has a brand name for "when I say the brand". */
  hasBrand: boolean
  onWordsText: (text: string) => void
  onChange: (fields: Partial<AngleSound>) => void
  onRemove: () => void
}) {
  const filePicker = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [peak, setPeak] = useState<number | null>(null)
  const [live, setLive] = useState<number | null>(null)
  const playing = useRef<Playing | null>(null)

  useEffect(() => {
    let cancelled = false
    setError(null)
    peakDb(sound.source, sound.volumeDb)
      .then((db) => !cancelled && setPeak(db))
      .catch((e: unknown) => {
        if (cancelled) return
        setPeak(null)
        setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [sound.source, sound.volumeDb])

  useEffect(() => () => playing.current?.stop(), [])

  const hear = async (source = sound.source) => {
    setError(null)
    try {
      const now = await play(source, sound.volumeDb)
      playing.current = now
      // The meter follows the sound as it plays - unless he has asked for
      // less motion, when it just shows the peak.
      const animate = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
      let frame = 0
      const tick = () => {
        setLive(now.level())
        frame = requestAnimationFrame(tick)
      }
      if (animate) tick()
      await now.ended
      cancelAnimationFrame(frame)
      if (playing.current === now) setLive(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setLive(null)
    }
  }

  const choose = (name: BuiltInSound) => {
    const source = { kind: 'built-in' as const, name }
    onChange({ source })
    void hear(source)
  }

  const shown = live ?? peak
  const fraction = shown === null ? 0 : Math.max(0, Math.min(1, (shown - FLOOR_DB) / -FLOOR_DB))
  const peakFraction = peak === null ? 0 : Math.max(0, Math.min(1, (peak - FLOOR_DB) / -FLOOR_DB))
  const tooLoud = peak !== null && peak > -1

  return (
    <div className="sound">
      <div className="row">
        <span className="label">Sound {index + 1}</span>
        <button type="button" className="linkbtn" onClick={onRemove}>
          Remove
        </button>
      </div>

      <input
        ref={filePicker}
        type="file"
        accept="audio/*,.mp3,.m4a,.wav,.aac"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) {
            const source = { kind: 'file' as const, name: file.name, audio: file }
            onChange({ source })
            void hear(source)
          }
          e.target.value = ''
        }}
      />
      <div className="seg chips" role="group" aria-label="Which sound">
        {BUILT_IN_SOUNDS.map((s) => (
          <button
            key={s.name}
            type="button"
            className={sound.source.kind === 'built-in' && sound.source.name === s.name ? 'active' : ''}
            onClick={() => choose(s.name)}
          >
            {s.label}
          </button>
        ))}
        <button
          type="button"
          className={sound.source.kind === 'file' ? 'active file' : 'file'}
          onClick={() => filePicker.current?.click()}
        >
          {sound.source.kind === 'file' ? sound.source.name : 'Your file…'}
        </button>
      </div>

      <label className="field">
        <span className="label">Plays</span>
        <select
          value={sound.trigger.kind}
          onChange={(e) => {
            const kind = e.target.value
            if (kind === 'start') onChange({ trigger: { kind: 'start' } })
            else if (kind === 'brand') onChange({ trigger: { kind: 'brand' } })
            else if (kind === 'picture') onChange({ trigger: { kind: 'picture' } })
            else onWordsText(wordsText)
          }}
        >
          <option value="start">At the start</option>
          {hasBrand || sound.trigger.kind === 'brand' ? <option value="brand">When I say the brand</option> : null}
          <option value="words">When I say…</option>
          <option value="picture">When a picture comes up</option>
        </select>
      </label>
      {sound.trigger.kind === 'words' ? (
        <input
          type="text"
          className="words"
          value={wordsText}
          placeholder="the word, e.g. Sydney"
          autoCapitalize="off"
          aria-label="Words it plays on"
          onChange={(e) => onWordsText(e.target.value)}
        />
      ) : null}

      <label className="slider">
        <span>Volume</span>
        <input
          type="range"
          min={LIMITS.volumeDb.min}
          max={LIMITS.volumeDb.max}
          step={1}
          value={sound.volumeDb}
          onChange={(e) => onChange({ volumeDb: Number(e.target.value) })}
        />
        <output>{`${sound.volumeDb > 0 ? '+' : ''}${sound.volumeDb} dB`}</output>
      </label>
      <div className="meter-row">
        <button type="button" className="btn play" aria-label={`Play sound ${index + 1}`} onClick={() => void hear()}>
          <svg viewBox="0 0 24 24" aria-hidden fill="currentColor">
            <path d="M8 5.5v13l10.5-6.5z" />
          </svg>
        </button>
        <div className="meter" aria-hidden>
          <div className={`meter-fill${tooLoud ? ' loud' : ''}`} style={{ width: `${fraction * 100}%` }} />
          {live !== null && peak !== null ? <div className="meter-peak" style={{ left: `${peakFraction * 100}%` }} /> : null}
        </div>
        <span className={`meter-read${tooLoud ? ' loud' : ''}`}>
          {peak === null ? '–' : `${peak > 0 ? '+' : ''}${Math.round(peak)} dB`}
        </span>
      </div>
      <div className={`hint${tooLoud ? ' loud' : ''}`}>
        {peak === null
          ? ' '
          : tooLoud
            ? 'Too loud - at this volume it will distort. Turn it down a little.'
            : `At its loudest it reaches ${Math.round(peak)} dB. 0 dB is the most a video can take.`}
      </div>

      {error ? <div className="error">{error}</div> : null}
    </div>
  )
}
