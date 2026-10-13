// The music bank: songs kept on this phone for every campaign, each with a
// name he gives it - so the Music pickers say "Sad piano" rather than
// "random text.mp4", and each can be played to check the vibe first.
//
// A song can come as audio or as a video (a TikTok sound saved as an MP4):
// from a video only the sound is kept, so a 60 MB clip becomes a 1 MB track.
// Files are kept like the Batch tab's, a few MB at a time (store.ts
// saveBankFile); the list is one row of meta. Never shared: his own files.

import { ALL_FORMATS, BlobSource, BufferTarget, Conversion, Input, Mp4OutputFormat, Output, QUALITY_HIGH } from 'mediabunny'
import { useEffect, useState } from 'react'

import type { BankFile } from './batch'
import { fingerprint } from './fingerprint'
import { deleteBankFile, getMeta, loadBankFile, saveBankFile, setMeta } from './store'

const KEY = 'music:bank'
/** A song as audio. */
const MAX_AUDIO_MB = 30
/** A video to take a song from: only its sound is kept. */
const MAX_VIDEO_MB = 500

const listeners = new Set<(bank: BankFile[]) => void>()

export async function loadMusicBank(): Promise<BankFile[]> {
  try {
    const raw = await getMeta(KEY)
    return raw ? (JSON.parse(raw) as BankFile[]) : []
  } catch {
    return []
  }
}

export async function saveMusicBank(bank: BankFile[]): Promise<void> {
  await setMeta(KEY, JSON.stringify(bank))
  for (const listener of listeners) listener(bank)
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
  if (added.length > 0) await saveMusicBank([...(await loadMusicBank()), ...added])
  return { added, skipped, failed }
}

export async function renameSong(id: string, name: string): Promise<void> {
  const bank = await loadMusicBank()
  await saveMusicBank(bank.map((f) => (f.id === id ? { ...f, name } : f)))
}

export async function removeSong(id: string): Promise<void> {
  const bank = await loadMusicBank()
  await saveMusicBank(bank.filter((f) => f.id !== id))
  await deleteBankFile(id).catch(() => {})
}

/** A song from the bank, named as he named it - or null when it is gone. */
export async function songFile(song: BankFile): Promise<File | null> {
  const file = await loadBankFile(song)
  return file ? new File([file], song.name, { type: song.type }) : null
}

/** A copy of a bank song under a new id, for a list that deletes its own
 *  files (the Batch tab's), so taking it out there leaves the bank's alone. */
export async function copySong(song: BankFile): Promise<BankFile> {
  const file = await loadBankFile(song)
  if (!file) throw new Error(`${song.name} is no longer on this phone.`)
  const id = crypto.randomUUID()
  await saveBankFile(id, file)
  return { ...song, id }
}
