// The music bank: songs for every campaign, each with a name he gives it -
// so the Music pickers say "Sad piano" rather than "random text.mp4", and
// each can be played to check the vibe first.
//
// A song can come as audio or as a video (a TikTok sound saved as an MP4):
// from a video only the sound is kept, so a 60 MB clip becomes a 1 MB track.
// Files are kept like the Batch tab's, a few MB at a time (store.ts
// saveBankFile); the list is one row of meta.
//
// Shared by everyone who uses the Cutter (syncSongs): a song added on any
// phone goes to the server - its sound only - and shows on every other
// phone, where its file comes down the first time it is used (ensureSong).
// Local first: adding, renaming and taking out land here at once; the
// server hears of them when there is signal (music:pending).

import { ALL_FORMATS, BlobSource, BufferTarget, Conversion, Input, Mp4OutputFormat, Output, QUALITY_HIGH } from 'mediabunny'
import { useEffect, useState } from 'react'

import type { BankFile } from './batch'
import { CloudError, askShared, currentSession } from './cloud'
import { fingerprint } from './fingerprint'
import { deleteBankFile, getMeta, loadBankFile, saveBankFile, setMeta } from './store'

/** A song in the bank. With `sha` it is shared: on the server, under what is
 *  in it, and on every phone. */
export type Song = BankFile & { sha?: string }

const KEY = 'music:bank'
/** Renames and takings-out still to tell the server. */
const PENDING_KEY = 'music:pending'
/** A song this phone added that the server already had from another phone:
 *  its id here then, and the shared one's - so a video picked with it still
 *  finds it. */
const ALIASES_KEY = 'music:aliases'
/** A song as audio. */
const MAX_AUDIO_MB = 30
/** A video to take a song from: only its sound is kept. */
const MAX_VIDEO_MB = 500

const listeners = new Set<(bank: BankFile[]) => void>()

export async function loadMusicBank(): Promise<Song[]> {
  try {
    const raw = await getMeta(KEY)
    return raw ? (JSON.parse(raw) as Song[]) : []
  } catch {
    return []
  }
}

export async function saveMusicBank(bank: Song[]): Promise<void> {
  await setMeta(KEY, JSON.stringify(bank))
  for (const listener of listeners) listener(bank)
}

/** A song by the id a video was picked with - its own, or the shared one it
 *  became. */
export async function findSong(id: string): Promise<Song | null> {
  const bank = await loadMusicBank()
  const aliases = await readJson<Record<string, string>>(ALIASES_KEY, {})
  return bank.find((s) => s.id === id) ?? bank.find((s) => s.id === aliases[id]) ?? null
}

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await getMeta(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

/** The bank, kept up to date while the screen is open. */
export function useMusicBank(): BankFile[] {
  const [bank, setBank] = useState<BankFile[]>([])
  useEffect(() => {
    let alive = true
    void loadMusicBank().then((b) => alive && setBank(b))
    const listener = (b: BankFile[]) => setBank(b)
    listeners.add(listener)
    return () => {
      alive = false
      listeners.delete(listener)
    }
  }, [])
  return bank
}

/** "Sad piano.mp3" → "Sad piano": the name a song starts with. */
export function songName(fileName: string): string {
  return fileName.replace(/\.[a-z0-9]{2,4}$/i, '').trim() || 'Song'
}

export function isVideoFile(file: File): boolean {
  return file.type.startsWith('video/') || /\.(mp4|mov|m4v)$/i.test(file.name)
}

/** The sound of a video, as an M4A: copied as it is when it is AAC, made
 *  again as AAC when not. */
export async function soundOf(file: File): Promise<File> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
  try {
    const target = new BufferTarget()
    const output = new Output({ format: new Mp4OutputFormat(), target })
    const conversion = await Conversion.init({
      input,
      output,
      showWarnings: false,
      video: { discard: true },
      audio: async (track) => ((await track.getCodec()) === 'aac' ? {} : { codec: 'aac', quality: QUALITY_HIGH }),
    })
    if (!conversion.isValid || !conversion.utilizedTracks.some((t) => t.isAudioTrack())) {
      throw new Error('its sound could not be taken out - save it as an MP3 or M4A and add that')
    }
    await conversion.execute()
    if (!target.buffer || target.buffer.byteLength === 0) throw new Error(`No sound came out of ${file.name}.`)
    return new File([target.buffer], `${songName(file.name)}.m4a`, { type: 'audio/mp4' })
  } finally {
    input.dispose()
  }
}

/** Keeps songs in the bank - the sound only, for a video - each once:
 *  the same recording picked again is skipped and named. */
export async function addSongs(
  files: File[],
  onStep?: (message: string) => void,
): Promise<{ added: BankFile[]; skipped: string[]; failed: string[] }> {
  const bank = await loadMusicBank()
  const added: BankFile[] = []
  const skipped: string[] = []
  const failed: string[] = []
  for (const [i, file] of files.entries()) {
    const counter = files.length > 1 ? ` (${i + 1} of ${files.length})` : ''
    try {
      const video = isVideoFile(file)
      if (file.size > (video ? MAX_VIDEO_MB : MAX_AUDIO_MB) * 1e6) {
        throw new Error(video ? `over ${MAX_VIDEO_MB} MB` : `over ${MAX_AUDIO_MB} MB - pick a shorter one or an MP3`)
      }
      const fp = await fingerprint(file)
      if ([...bank, ...added].some((f) => f.fp === fp)) {
        skipped.push(file.name)
        continue
      }
      onStep?.(video ? `Taking the sound out of ${file.name}${counter}…` : `Keeping ${file.name}${counter}…`)
      const song = video ? await soundOf(file) : file
      const id = crypto.randomUUID()
      await saveBankFile(id, song)
      added.push({ id, name: songName(file.name), type: song.type || 'audio/mpeg', size: song.size, fp })
    } catch (error) {
      failed.push(`${file.name} (${error instanceof Error ? error.message : String(error)})`)
    }
  }
  if (added.length > 0) {
    await saveMusicBank([...(await loadMusicBank()), ...added])
    void syncSongs().catch(() => {})
  }
  return { added, skipped, failed }
}

type Pending = { op: 'rename'; id: string; name: string } | { op: 'remove'; id: string }

async function addPending(op: Pending): Promise<void> {
  const pending = await readJson<Pending[]>(PENDING_KEY, [])
  // A newer rename of the same song replaces the older; a taking-out ends it.
  await setMeta(PENDING_KEY, JSON.stringify([...pending.filter((p) => p.id !== op.id), op]))
  void syncSongs().catch(() => {})
}

export async function renameSong(id: string, name: string): Promise<void> {
  const bank = await loadMusicBank()
  await saveMusicBank(bank.map((f) => (f.id === id ? { ...f, name } : f)))
  if (bank.find((f) => f.id === id)?.sha) await addPending({ op: 'rename', id, name })
}

/** Out of the bank - on every phone, when it is shared. */
export async function removeSong(id: string): Promise<void> {
  const bank = await loadMusicBank()
  await saveMusicBank(bank.filter((f) => f.id !== id))
  await deleteBankFile(id).catch(() => {})
  if (bank.find((f) => f.id === id)?.sha) await addPending({ op: 'remove', id })
}

/** A song's file on this phone - brought down from the server the first
 *  time a song another phone added is used. Null when it can't be had. */
export async function ensureSong(song: Song): Promise<File | null> {
  const here = await loadBankFile(song).catch(() => null)
  if (here) return here
  if (!song.sha) return null
  const answer = await askShared<{ urls: Record<string, string> }>('song-urls', { shas: [song.sha] }).catch(() => null)
  const url = answer?.urls[song.sha]
  if (!url) return null
  const response = await fetch(url).catch(() => null)
  if (!response?.ok) return null
  const bytes = await response.arrayBuffer()
  if ((await sha256(bytes)) !== song.sha) return null
  const file = new File([bytes], song.name, { type: song.type })
  await saveBankFile(song.id, file).catch(() => {})
  return file
}

/** A song from the bank, named as he named it - or null when it is gone. */
export async function songFile(song: Song): Promise<File | null> {
  const file = await ensureSong(song)
  return file ? new File([file], song.name, { type: song.type }) : null
}

/** A copy of a bank song under a new id, for a list that deletes its own
 *  files (the Batch tab's), so taking it out there leaves the bank's alone. */
export async function copySong(song: Song): Promise<BankFile> {
  const file = await ensureSong(song)
  if (!file) throw new Error(`${song.name} couldn't be brought to this phone - try again with signal.`)
  const id = crypto.randomUUID()
  await saveBankFile(id, file)
  const { sha: _shared, ...rest } = song
  return { ...rest, id }
}

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

interface SharedSong {
  id: string
  name: string
  type: string
  size: number
  fp?: string
  sha: string
  addedAt: number
}

/** Puts a song's file where the server said. One already there is the
 *  same file - it is named by what is in it. */
async function putSong(url: string, file: Blob): Promise<void> {
  const form = new FormData()
  form.append('cacheControl', '31536000')
  form.append('', file)
  const response = await fetch(url, { method: 'PUT', body: form, headers: { 'x-upsert': 'false' } })
  if (!response.ok && !/duplicate|already exists/i.test(await response.text().catch(() => ''))) {
    throw new CloudError(`A song could not be sent (${response.status}).`)
  }
}

let syncing: Promise<void> | null = null

/** The bank and the shared one made the same: what this phone did goes up
 *  (renames, takings-out, its songs not shared yet), then what the others
 *  did comes down - their songs listed here at once, each file brought down
 *  when it is first used. One at a time; any failure leaves the rest for
 *  next time. */
export function syncSongs(): Promise<void> {
  if (!currentSession()) return Promise.resolve()
  syncing ??= shareSongs().finally(() => {
    syncing = null
  })
  return syncing
}

async function shareSongs(): Promise<void> {
  // What this phone did since, in order.
  const pending = await readJson<Pending[]>(PENDING_KEY, [])
  const left = [...pending]
  for (const op of pending) {
    if (op.op === 'rename') await askShared('rename-song', { id: op.id, name: op.name })
    else await askShared('remove-song', { id: op.id })
    left.shift()
    await setMeta(PENDING_KEY, left.length > 0 ? JSON.stringify(left) : null)
  }

  // Its own songs the others haven't got yet - one that can't go is left for
  // next time, never holding up the rest.
  for (const song of (await loadMusicBank()).filter((s) => !s.sha)) {
    const file = await loadBankFile(song).catch(() => null)
    if (!file) continue
    const sha = await sha256(await file.arrayBuffer())
    let kept: { song: SharedSong } | null
    try {
      const upload = await askShared<{ url: string | null }>('song-upload', { sha })
      if (upload?.url) await putSong(upload.url, file)
      kept = await askShared<{ song: SharedSong }>('add-song', {
        song: { id: song.id, name: song.name, type: song.type || 'audio/mpeg', size: song.size, sha, ...(song.fp ? { fp: song.fp } : {}) },
      })
    } catch {
      continue
    }
    if (!kept) return
    const bank = await loadMusicBank()
    if (kept.song.id === song.id) {
      await saveMusicBank(bank.map((s) => (s.id === song.id ? { ...s, sha } : s)))
      continue
    }
    // Another phone shared the same song first: this one becomes that one.
    const aliases = await readJson<Record<string, string>>(ALIASES_KEY, {})
    await setMeta(ALIASES_KEY, JSON.stringify({ ...aliases, [song.id]: kept.song.id }))
    if (!bank.some((s) => s.id === kept.song.id)) await saveBankFile(kept.song.id, file)
    const shared: Song = { id: kept.song.id, name: kept.song.name, type: kept.song.type, size: kept.song.size, sha: kept.song.sha, ...(kept.song.fp ? { fp: kept.song.fp } : {}) }
    const next = bank.some((s) => s.id === kept.song.id) ? bank.filter((s) => s.id !== song.id) : bank.map((s) => (s.id === song.id ? shared : s))
    await saveMusicBank(next)
    await deleteBankFile(song.id).catch(() => {})
  }

  // What the others did.
  const answer = await askShared<{ songs: SharedSong[] }>('songs')
  if (!answer) return
  const bank = await loadMusicBank()
  const next = mergeSongs(bank, answer.songs, await readJson<Pending[]>(PENDING_KEY, []))
  if (JSON.stringify(next) === JSON.stringify(bank)) return
  for (const gone of bank.filter((s) => !next.some((n) => n.id === s.id))) await deleteBankFile(gone.id).catch(() => {})
  await saveMusicBank(next)
}

/** This phone's bank after the shared one: songs it hasn't shared yet stay,
 *  shared ones take the server's name (unless a rename of its own is still
 *  going up) or go when another phone took them out, and the others' new
 *  ones come in at the end. */
export function mergeSongs(bank: readonly Song[], shared: readonly SharedSong[], pending: readonly Pending[] = []): Song[] {
  const byId = new Map(shared.map((s) => [s.id, s]))
  const renaming = new Set(pending.filter((p) => p.op === 'rename').map((p) => p.id))
  const removing = new Set(pending.filter((p) => p.op === 'remove').map((p) => p.id))
  const kept: Song[] = []
  for (const song of bank) {
    if (!song.sha) {
      kept.push(song)
      continue
    }
    const there = byId.get(song.id)
    if (!there) continue
    kept.push(renaming.has(song.id) ? song : { ...song, name: there.name })
  }
  const known = new Set(bank.map((s) => s.id))
  for (const s of shared) {
    if (known.has(s.id) || removing.has(s.id)) continue
    kept.push({ id: s.id, name: s.name, type: s.type, size: s.size, sha: s.sha, ...(s.fp ? { fp: s.fp } : {}) })
  }
  return kept
}
