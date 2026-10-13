// The video bank: clips kept on this phone for every campaign, each with the
// words that bring it up - say "Claude Code" and the screen recording of it
// pops up over him and plays to its end (popVideo.ts). Like the picture
// bank, any angle that uses the bank gets them.
//
// Each clip is checked when it comes in: that this phone can play it, how
// long it is, its shape, and a small still to show it by. Files are kept
// like the Batch tab's, a few MB at a time (store.ts saveBankFile); the list
// is one row of meta. Never shared: his own footage.

import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny'
import { useEffect, useState } from 'react'

import type { BankFile } from './batch'
import type { PopCue } from './look'
import { fingerprint } from './fingerprint'
import { songName } from './musicBank'
import { deleteBankFile, getMeta, loadBankFile, saveBankFile, setMeta } from './store'

export interface BankVideo extends BankFile {
  /** What brings it up, e.g. "Claude Code". */
  words: string[]
  seconds: number
  width: number
  height: number
  /** A small still of it, kept like the clip. */
  poster?: { id: string; size: number }
}

const KEY = 'video:bank'
const MAX_MB = 200
/** The still's width: enough for a thumbnail and the caption check's box. */
const POSTER_WIDTH = 360

const listeners = new Set<(bank: BankVideo[]) => void>()

export async function loadVideoBank(): Promise<BankVideo[]> {
  try {
    const raw = await getMeta(KEY)
    return raw ? (JSON.parse(raw) as BankVideo[]) : []
  } catch {
    return []
  }
}

export async function saveVideoBank(bank: BankVideo[]): Promise<void> {
  await setMeta(KEY, JSON.stringify(bank))
  for (const listener of listeners) listener(bank)
}

export function useVideoBank(): BankVideo[] {
  const [bank, setBank] = useState<BankVideo[]>([])
  useEffect(() => {
    let alive = true
    void loadVideoBank().then((b) => alive && setBank(b))
    const listener = (b: BankVideo[]) => setBank(b)
    listeners.add(listener)
    return () => {
      alive = false
      listeners.delete(listener)
    }
  }, [])
  return bank
}

export interface Probed {
  seconds: number
  width: number
  height: number
  poster: Blob | null
}

async function toJpeg(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<Blob | null> {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 })
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8))
}

/** What the clip is: its length and shape, and a still from near its start -
 *  or an error he can act on when this phone can't play it. */
export async function probeVideo(file: Blob, name: string): Promise<Probed> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
  try {
    const track = await input.getPrimaryVideoTrack().catch(() => null)
    if (!track) throw new Error("it isn't a video this app can open")
    if (!(await track.canDecode())) throw new Error("this phone can't play it here - save it again from Photos, or export it as an MP4")
    const [seconds, width, height] = await Promise.all([input.computeDuration(), track.getDisplayWidth(), track.getDisplayHeight()])
    if (!(seconds > 0.2)) throw new Error('it is too short')
    let poster: Blob | null = null
    try {
      const still = await new CanvasSink(track, { width: POSTER_WIDTH }).getCanvas(Math.min(0.3, seconds / 2))
      if (still) poster = await toJpeg(still.canvas)
    } catch {
      // A clip with no still is still a clip.
    }
    return { seconds, width, height, poster }
  } catch (error) {
    throw new Error(`${name}: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    input.dispose()
  }
}

/** Keeps clips in the bank, each once; the same recording again is skipped
 *  and named. */
export async function addVideos(
  files: File[],
  onStep?: (message: string) => void,
  probe: (file: Blob, name: string) => Promise<Probed> = probeVideo,
): Promise<{ added: BankVideo[]; skipped: string[]; failed: string[] }> {
  const bank = await loadVideoBank()
  const added: BankVideo[] = []
  const skipped: string[] = []
  const failed: string[] = []
  for (const [i, file] of files.entries()) {
    try {
      if (file.size > MAX_MB * 1e6) throw new Error(`${file.name}: over ${MAX_MB} MB - trim it in Photos first`)
      const fp = await fingerprint(file)
      if ([...bank, ...added].some((v) => v.fp === fp)) {
        skipped.push(file.name)
        continue
      }
      onStep?.(`Checking ${file.name}${files.length > 1 ? ` (${i + 1} of ${files.length})` : ''}…`)
      const probed = await probe(file, file.name)
      const id = crypto.randomUUID()
      await saveBankFile(id, file)
      let poster: BankVideo['poster']
      if (probed.poster) {
        const posterId = crypto.randomUUID()
        await saveBankFile(posterId, probed.poster)
        poster = { id: posterId, size: probed.poster.size }
      }
      added.push({
        id,
        name: songName(file.name),
        type: file.type || 'video/mp4',
        size: file.size,
        fp,
        words: [],
        seconds: probed.seconds,
        width: probed.width,
        height: probed.height,
        ...(poster ? { poster } : {}),
      })
    } catch (error) {
      failed.push(error instanceof Error ? error.message : String(error))
    }
  }
  if (added.length > 0) await saveVideoBank([...(await loadVideoBank()), ...added])
  return { added, skipped, failed }
}

export async function updateVideo(id: string, fields: Partial<Pick<BankVideo, 'name' | 'words'>>): Promise<void> {
  const bank = await loadVideoBank()
  await saveVideoBank(bank.map((v) => (v.id === id ? { ...v, ...fields } : v)))
}

export async function removeVideo(id: string): Promise<void> {
  const bank = await loadVideoBank()
  const gone = bank.find((v) => v.id === id)
  await saveVideoBank(bank.filter((v) => v.id !== id))
  await deleteBankFile(id).catch(() => {})
  if (gone?.poster) await deleteBankFile(gone.poster.id).catch(() => {})
}

/** What a video's look needs of a bank video (look.ts PopCue). */
export function popCue(video: BankVideo): PopCue {
  return { id: video.id, words: video.words, seconds: video.seconds, width: video.width, height: video.height }
}

/** The clip itself, or null when it is no longer on the phone. */
export function videoFile(video: BankVideo): Promise<File | null> {
  return loadBankFile(video)
}

/** Its still, or null. */
export async function posterOf(video: BankVideo): Promise<Blob | null> {
  if (!video.poster) return null
  return loadBankFile({ id: video.poster.id, name: 'still.jpg', type: 'image/jpeg', size: video.poster.size })
}
