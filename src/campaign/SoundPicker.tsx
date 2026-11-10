// The edit screen's Add sound (his ask, 2026-11-10: "Add sound, but sound can
// be a sfx"): a sound effect from the bank's sound effects, one of the
// Cutter's own effects, a song from the music bank, or a file from his phone
// (a video's sound is taken out of it). A tap on ▶ plays it; a tap on its name
// puts it on the video at the playhead (CutsEditor).

import { useRef, useState } from 'react'

import type { MotionSound } from './motion/sfx'
import { makeSound } from './motion/sfx'
import { addSongs, isVideoFile, songFile, soundOf, songName, useMusicBank, type Song } from './musicBank'
import { SOUND_DB, type SoundSource } from './manualPictures'
import { PlayButton } from './TrackPlayer'

/** The Cutter's own effects, made from a few lines of maths (motion/sfx.ts). */
export const EFFECTS: { name: MotionSound; label: string }[] = [
  { name: 'whoosh', label: 'Whoosh' },
  { name: 'pop', label: 'Pop' },
  { name: 'ding', label: 'Ding' },
  { name: 'tick', label: 'Click' },
  { name: 'hit', label: 'Boom' },
  { name: 'shutter', label: 'Camera' },
  { name: 'swish', label: 'Swish' },
]

const RATE = 44100

/** One of the Cutter's effects as a WAV file, to hear it in the editor. */
export function effectFile(name: MotionSound): Blob {
  const samples = makeSound(name, RATE)
  const bytes = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(bytes)
  const text = (at: number, s: string) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)))
  text(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, RATE, true)
  view.setUint32(28, RATE * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  text(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 0x7fff, true)
  return new Blob([bytes], { type: 'audio/wav' })
}

/** How long one of the Cutter's effects is, in seconds. */
export function effectSeconds(name: MotionSound): number {
  return makeSound(name, RATE).length / RATE
}

/** How long a sound file plays, from the phone's own player; null when it
 *  can't tell within a few seconds. */
export function soundLength(file: Blob): Promise<number | null> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') return resolve(null)
    const audio = document.createElement('audio')
    const url = URL.createObjectURL(file)
    const done = (seconds: number | null) => {
      window.clearTimeout(timer)
      URL.revokeObjectURL(url)
      audio.removeAttribute('src')
      resolve(seconds !== null && Number.isFinite(seconds) && seconds > 0 ? seconds : null)
    }
    const timer = window.setTimeout(() => done(null), 5000)
    audio.preload = 'metadata'
    audio.onloadedmetadata = () => done(audio.duration)
    audio.onerror = () => done(null)
    audio.src = url
  })
}

/** What he picked: the sound, how long it is when that is known, and the
 *  file when it came from his phone. */
export interface PickedSound {
  source: SoundSource
  length: number | null
  file?: Blob
}

export function SoundPicker({ at, onPick, onClose }: { at: string; onPick: (picked: PickedSound) => void; onClose: () => void }) {
  const effects = useMusicBank('effects')
  const songs = useMusicBank('songs')
  const [busy, setBusy] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const phone = useRef<HTMLInputElement>(null)
  const toBank = useRef<HTMLInputElement>(null)

  const fromBank = async (song: Song) => {
    setBusy(`Getting ${song.name}…`)
    try {
      const file = await songFile(song)
      if (!file) throw new Error(`${song.name} couldn't be read on this phone.`)
      onPick({ source: { kind: 'sound', from: 'bank', ref: song.id, name: song.name, volumeDb: SOUND_DB.start }, length: await soundLength(file) })
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(null)
    }
  }

  /** A file from his phone: only its sound, kept with this video. */
  const fromPhone = async (picked: File) => {
    setBusy(`Keeping ${picked.name}…`)
    try {
      const file = isVideoFile(picked) ? await soundOf(picked) : picked
      onPick({
        source: { kind: 'sound', from: 'phone', ref: '', name: songName(picked.name), type: file.type || 'audio/mp4', volumeDb: SOUND_DB.start },
        length: await soundLength(file),
        file,
      })
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(null)
    }
  }

  /** Into the sound effects bank (every phone gets it), and on this video. */
  const intoBank = async (files: File[]) => {
    setBusy('Keeping it in the sound effects bank…')
    try {
      const { added, skipped, failed } = await addSongs(files, setBusy, { sfx: true })
      if (failed.length > 0) setProblem(`Couldn't keep ${failed.join('; ')}.`)
      else if (skipped.length > 0 && added.length === 0) setProblem(`${skipped.join(', ')} ${skipped.length === 1 ? 'is' : 'are'} in the bank already - pick it below.`)
      const first = added[0]
      if (first) await fromBank(first)
    } finally {
      setBusy(null)
    }
  }

  const row = (key: string, name: string, load: () => Promise<Blob | null>, pick: () => void) => (
    <li key={key} className="sound-pick">
      <PlayButton name={name} load={load} />
      <button type="button" className="sound-pick-name" disabled={busy !== null} onClick={pick}>
        {name}
      </button>
      <button type="button" className="btn small" disabled={busy !== null} aria-label={`Add ${name}`} onClick={pick}>
        Add
      </button>
    </li>
  )

  return (
    <div className="pic-picker sound-picker">
      <div className="group-title">Add a sound at {at}</div>
      {busy ? <p className="hint">{busy}</p> : null}
      {problem ? <p className="hint warn-text">{problem}</p> : null}
      <div className="sound-picker-head">
        <span className="label">Sound effects</span>
        <button type="button" className="linkbtn" disabled={busy !== null} onClick={() => toBank.current?.click()}>
          + Add to the bank
        </button>
      </div>
      <input
        ref={toBank}
        type="file"
        accept="audio/*,video/*,.mp3,.m4a,.wav,.aac,.mp4,.mov"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          e.target.value = ''
          if (files.length > 0) void intoBank(files)
        }}
      />
      <ul className="sound-list">
        {effects.map((song) => row(song.id, song.name, () => songFile(song), () => void fromBank(song)))}
        {EFFECTS.map((e) =>
          row(
            e.name,
            e.label,
            async () => effectFile(e.name),
            () => onPick({ source: { kind: 'sound', from: 'effect', ref: e.name, name: e.label, volumeDb: SOUND_DB.start }, length: effectSeconds(e.name) }),
          ),
        )}
      </ul>
      {songs.length > 0 ? (
        <>
          <span className="label">Music bank</span>
          <ul className="sound-list">{songs.map((song) => row(song.id, song.name, () => songFile(song), () => void fromBank(song)))}</ul>
        </>
      ) : null}
      <button type="button" className="btn wide" disabled={busy !== null} onClick={() => phone.current?.click()}>
        A sound from my phone
      </button>
      <input
        ref={phone}
        type="file"
        accept="audio/*,video/*,.mp3,.m4a,.wav,.aac,.mp4,.mov"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void fromPhone(file)
        }}
      />
      <button type="button" className="linkbtn" onClick={onClose}>
        Cancel
      </button>
    </div>
  )
}
