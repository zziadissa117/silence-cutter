// A clip of a talking head batch changed after it is in the batch (his ask,
// 2026-11-15: "make sure I can easily go to any clip and just modify it,
// meaning I can modify the length. Because right now I feel like I'm
// speaking too slowly, maybe you can put in 1.1x speed").
//
// Batch-only (AGENTS.md rule zero): the Cutter's own cut is never touched -
// a clip is made again with the same renderer the drop-in and the edit
// screen's Speed use (prepareDrop.recut, render.ts), from:
// - its recording, kept on the phone with the clip since 2026-11-15
//   (BankFile.source) - so a part can be made longer, and the picture is
//   only ever encoded once from the original;
// - or, for a clip from before then, the clip itself (made its own source
//   the first time it changes): it can be made shorter or faster, not longer.
//
// Speed: the format's (BatchFormat.speed, every clip) unless he set this clip
// itself (BankFile.speedSet). What the clip's file plays at is
// BankFile.speed; a clip whose file is not at the speed wanted is made again
// (clipsToSpeed), one at a time, while the Batch tab is open.

import type { Range } from '../media/silenceMath'
import type { BankFile, BatchBank, BatchFormat } from './batch'
import type { CaptionWord } from './captions'
import type { ClipSource } from './dropQueue'
import { NO_EFFECTS } from './effects'
import { filmingOf } from './filming'
import { fingerprint } from './fingerprint'
import { cutName, recut } from './prepareDrop'
import { loadBankFile, saveBankFile } from './store'
import { downloadFile } from './talkLink'

/** The speeds offered for a talking head's clips: around his own pace. */
export const CLIP_SPEEDS = [1, 1.1, 1.2, 1.3, 1.5] as const

/** "1×", "1.1×". */
export const speedLabel = (speed: number): string => `${Math.round(speed * 100) / 100}×`

/** The speed a clip's file plays at now. */
export const speedOfClip = (file: Pick<BankFile, 'speed'>): number => file.speed ?? 1

/** The speed a clip should play at: his own pick for it, else the format's. */
export function wantedSpeed(file: Pick<BankFile, 'speedSet'>, format: Pick<BatchFormat, 'speed'>): number {
  return file.speedSet ?? format.speed ?? 1
}

/** Whether the clip's recording is kept, so it can be made longer. */
export const canLengthen = (file: Pick<BankFile, 'source'>): boolean => Boolean(file.source && !file.source.self)

/** How clips are made again now: 2 since sped-up clips keep the source's
 *  frame rate (render.ts; 1 made them 16.5 fps at 1.1x). A sped-up clip made
 *  before is made again from its source. */
export const CLIP_MADE = 2

/** The clips of a talking head format whose file is not at the speed wanted,
 *  or sped up before CLIP_MADE. */
export function clipsToSpeed(clips: readonly BankFile[], format: Pick<BatchFormat, 'speed'>): BankFile[] {
  return clips.filter((f) => Math.abs(wantedSpeed(f, format) - speedOfClip(f)) > 0.001 || (speedOfClip(f) !== 1 && (f.made ?? 1) < CLIP_MADE))
}

/** The parts kept, every one at `speed`. */
export function atSpeed(keep: readonly Range[], speed: number): Range[] {
  return keep.map(({ start, end }) => (speed === 1 ? { start, end } : { start, end, speed }) as Range)
}

/** His checked captions on the clip's clock when only its speed changes:
 *  every moment comes `from / to` as late. */
export function captionsAtSpeed(words: readonly CaptionWord[], from: number, to: number): CaptionWord[] {
  const k = from / to
  return words.map((w) => ({ ...w, start: w.start * k, end: w.end * k }))
}

/** A file of the batch on this phone, or fetched from the Cutter server. */
async function bankBlob(file: Pick<BankFile, 'id' | 'name' | 'type' | 'size'>): Promise<Blob | null> {
  const here = await loadBankFile(file as BankFile).catch(() => null)
  if (here) return here
  const there = await downloadFile(file.id).catch(() => null)
  if (there) await saveBankFile(file.id, there).catch(() => {})
  return there
}

/** What a clip is made again from: its recording, or the clip itself. */
export async function sourceOf(file: BankFile): Promise<{ source: ClipSource; recording: Blob } | null> {
  if (file.source) {
    const recording = await bankBlob({ id: file.source.fileId, name: file.name, type: file.source.type, size: file.source.size })
    if (recording) return { source: file.source, recording }
    // Its recording is gone: the clip itself, as for an older clip.
  }
  const clip = await bankBlob(file)
  if (!clip) return null
  const duration = file.seconds ?? (await filmingOf(clip).catch(() => null))?.seconds
  if (!duration) return null
  // Its picture and sound as they are now: no zooms or voice added again;
  // its captions as he checked them, at the speed it plays at.
  const speed = speedOfClip(file)
  const words = file.captions ?? []
  return {
    source: {
      fileId: file.id,
      size: clip.size,
      type: clip.type || file.type,
      keep: [{ start: 0, end: duration }],
      words,
      duration,
      effects: NO_EFFECTS,
      brandWords: [],
      voice: false,
      seed: file.from ?? file.fp ?? file.id,
      self: true,
      ...(speed !== 1 ? { baseSpeed: speed } : {}),
    },
    recording: clip,
  }
}

/** The clip made again: `keep` (the parts of its source, on the source's
 *  clock - unchanged when absent) at `speed`. A new file, kept on this phone;
 *  the clip's place, captions and marks carried over. */
export async function remakeClip(
  file: BankFile,
  change: { keep?: Range[]; speed: number },
  onProgress?: (fraction: number) => void,
): Promise<BankFile> {
  return (await remakeWithWords(file, change, onProgress)).file
}

/** remakeClip, with the words heard in it on the new clip's clock (its
 *  captions on the check, DropCheck's Timeline editor). */
export async function remakeWithWords(
  file: BankFile,
  { keep, speed }: { keep?: Range[]; speed: number },
  onProgress?: (fraction: number) => void,
): Promise<{ file: BankFile; words: CaptionWord[] }> {
  const from = await sourceOf(file)
  if (!from) throw new Error('its video is no longer on this phone or your server')
  const { source, recording } = from
  const parts = keep ?? source.keep
  // A clip that is its own source already plays at baseSpeed: what is asked
  // is the speed from now on, so it is sped up by the difference.
  const by = speed / (source.baseSpeed ?? 1)
  const made = await recut(recording, { keep: atSpeed(parts, by), words: source.words, effects: source.effects, brandWords: source.brandWords, voice: source.voice, seed: source.seed, onPhase: onProgress })
  const id = crypto.randomUUID()
  await saveBankFile(id, made.blob)
  const seconds = (await filmingOf(made.blob).catch(() => null))?.seconds
  // Only the speed changed: his own captions, on the new clock. Its length
  // changed: the words as heard, on the new clock.
  const sameParts = !keep || JSON.stringify(keep) === JSON.stringify(source.keep)
  const captions = file.captions ? (sameParts ? captionsAtSpeed(file.captions, speedOfClip(file), speed) : made.words) : undefined
  const next: BankFile = {
    ...file,
    id,
    name: source.self ? file.name : cutName(file.name),
    type: 'video/mp4',
    size: made.blob.size,
    fp: await fingerprint(made.blob),
    from: file.from ?? file.fp,
    source: { ...source, keep: parts },
    ...(seconds ? { seconds } : {}),
    ...(captions ? { captions } : {}),
  }
  if (speed === 1) delete next.speed
  else next.speed = speed
  next.made = CLIP_MADE
  return { file: next, words: captions ?? made.words }
}

/** The bank with the clip `oldId` swapped for `next`, where it is - and the
 *  videos already made with it counted as made with `next`, so "Use each
 *  clip once" and the mixes made still know it. */
export function swapClip(bank: BatchBank, oldId: string, next: BankFile): BatchBank {
  const change = (f: BankFile) => (f.id === oldId ? next : f)
  const rename = (key: string) => {
    const [r, p] = key.split('|')
    const ids = (p ?? '').split('+').map((x) => (x === oldId ? next.id : x))
    return `${r === oldId ? next.id : r}${p === undefined ? '' : `|${ids.join('+')}`}`
  }
  const used = { ...bank.used }
  if (oldId in used) {
    used[next.id] = used[oldId]
    delete used[oldId]
  }
  return {
    ...bank,
    reactions: bank.reactions.map(change),
    steps: bank.steps?.map((s) => (s.files.some((f) => f.id === oldId) ? { ...s, files: s.files.map(change) } : s)),
    used,
    ...(bank.made ? { made: bank.made.map(rename) } : {}),
  }
}

/** The files a clip leaves behind when it is swapped for one made again:
 *  the old file, unless it is the new one's source (an older clip, made its
 *  own source). */
export function leftBehind(old: BankFile, next: BankFile): string[] {
  return next.source?.fileId === old.id ? [] : [old.id]
}

/** The files to let go of when a clip is taken out of the batch: it and its
 *  recording. */
export function filesOfClip(file: BankFile): string[] {
  return file.source && file.source.fileId !== file.id ? [file.id, file.source.fileId] : [file.id]
}

let line: Promise<unknown> = Promise.resolve()

/** Clips made again one at a time on this phone - his own change and the
 *  format's speed never at once. */
export function oneAtATime<T>(work: () => Promise<T>): Promise<T> {
  const run = line.then(work, work)
  line = run.catch(() => {})
  return run
}

/** A clip kept whole and zoomed between his phrases is made of pieces that
 *  touch (prepareDrop.phrasePieces): nothing taken out. On its timeline it
 *  is one part - shown as pieces it looked cut (his report, 2026-11-15). */
export function joinTouching(keep: readonly Range[]): Range[] {
  const out: Range[] = []
  for (const r of keep) {
    const last = out[out.length - 1]
    if (last && Math.abs(r.start - last.end) < 1e-3) last.end = r.end
    else out.push({ start: r.start, end: r.end })
  }
  return out
}

/** The parts he set on the timeline, split again where the clip's zoom
 *  pieces met - so it keeps moving between his phrases as before. */
export function splitAtPieces(kept: readonly Range[], pieces: readonly Range[]): Range[] {
  const cuts = pieces.slice(1).map((p) => p.start)
  return kept.flatMap((r) => {
    const inside = cuts.filter((t) => t > r.start + 0.05 && t < r.end - 0.05)
    const edges = [r.start, ...inside, r.end]
    return edges.slice(1).map((end, i) => ({ start: edges[i], end }))
  })
}
