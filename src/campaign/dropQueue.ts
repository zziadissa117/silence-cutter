// The clips of a talking head format waiting for his check (his report,
// 2026-11-13: "Sometimes it's hearing the words wrong ... It automatically
// assigns some videos to the wrong product steps. Make sure you point out to
// me every single video and add a way to check with me if that video goes in
// the right place"). Every clip the Cutter edits for a batch - dropped in,
// added to a step or a hook by hand, or an older one edited now - waits here,
// out of the batch, until he has looked at it (DropCheck.tsx): where it goes,
// and its captions. Only then is it in the videos.
//
// Kept on the phone per format, so he can check them later - after the
// Cutter server cut them while the app was closed.
//
// Clips already in the batch come here too, to be looked at again (his ask,
// 2026-11-14: "let's say there was a video that was in the wrong product
// step. How do I know? ... make an option to recheck if everything is in the
// right place"): every clip he hasn't checked yet - first the ones whose words
// sound like another step - or every clip again. Those stay where they are in
// the batch until he moves them.

import type { BankFile, BatchBank, BatchStep } from './batch'
import type { CaptionWord } from './captions'
import { matchStep } from './stepMatch'

/** Where a clip goes: a step's id, his hooks, or nowhere yet. */
export const HOOK = 'hook'

export interface ToCheck {
  /** The cut clip. On the phone already, or still coming down from the
   *  Cutter server (DropCheck fetches it). */
  file: BankFile
  /** The clip as he picked it. */
  name: string
  /** What he says in it, and its words on the clip's own clock. */
  text: string
  words: CaptionWord[]
  /** Where it would go: a step, HOOK, or null when no step fits. */
  place: string | null
  /** Clearly that place - not marked "Not sure" on the check. */
  sure: boolean
  /** The clip in the batch it takes the place of: the same recording edited
   *  again, or one he had added as filmed. */
  replaces?: string
  /** A clip already in the batch, looked at again: it stays where it is
   *  until he moves it, and Leave out takes it out of the batch. */
  recheck?: boolean
  /** The step its words sound like, when that is not where it is. */
  hint?: string
  /** What he says in it was never heard: heard on the check. */
  unheard?: boolean
}

const KEY = 'batch.toCheck:'

export function loadQueue(formatId: string): ToCheck[] {
  try {
    const raw = localStorage.getItem(KEY + formatId)
    return raw ? (JSON.parse(raw) as ToCheck[]) : []
  } catch {
    return []
  }
}

export function saveQueue(formatId: string, list: readonly ToCheck[]): void {
  try {
    if (list.length === 0) localStorage.removeItem(KEY + formatId)
    else localStorage.setItem(KEY + formatId, JSON.stringify(list))
  } catch {
    // Kept for this visit only.
  }
  window.dispatchEvent(new CustomEvent(QUEUE_EVENT, { detail: { formatId } }))
}

/** Said whenever a format's clips to check change, for every screen showing them. */
export const QUEUE_EVENT = 'cutter-drop-queue'

/** A clip added to a format's check, after any already there. */
export function addToQueue(formatId: string, item: ToCheck): ToCheck[] {
  const next = [...loadQueue(formatId).filter((q) => q.file.id !== item.file.id), item]
  saveQueue(formatId, next)
  return next
}

/** The check's order: the ones it isn't sure of first, then as they came. */
export function checkOrder(list: readonly ToCheck[]): ToCheck[] {
  return [...list].sort((a, b) => Number(a.sure && a.place !== null) - Number(b.sure && b.place !== null))
}

/** Where a clip of the batch is now: its step, HOOK when it is one of the
 *  format's hooks, else null. */
export function placeOf(bank: BatchBank, fileId: string): string | null {
  const step = (bank.steps ?? []).find((s) => s.files.some((f) => f.id === fileId))
  if (step) return step.id
  return bank.reactions.some((r) => r.id === fileId) ? HOOK : null
}

/** The clip of this format a recording is already in the batch as: cut from
 *  it before (BankFile.from), or added as filmed (its own fingerprint). */
export function sameRecording(bank: BatchBank, formatId: string, from: string): BankFile | null {
  const steps = (bank.steps ?? []).filter((s) => !s.formats || s.formats.includes(formatId))
  const files = [...steps.flatMap((s) => s.files), ...bank.reactions.filter((r) => r.formats?.includes(formatId))]
  return files.find((f) => f.from === from || f.fp === from) ?? null
}

/** Where a clip coming back goes, before he checks it: where he asked (a
 *  step's + Add, his hooks' + Add), where the clip it replaces is, or the
 *  step whose name he says in it - his hooks when no step fits and the
 *  format takes dropped hooks. */
export function suggestPlace(
  bank: BatchBank | null,
  steps: readonly Pick<BatchStep, 'id' | 'name' | 'heard'>[],
  text: string,
  { to, replaces, hooks }: { to?: string | null; replaces?: string; hooks: boolean },
): { place: string | null; sure: boolean; hint?: string } {
  if (to) return { place: to, sure: true }
  // Edited again where it was - marked when its words now say another step.
  const was = replaces && bank ? placeOf(bank, replaces) : null
  if (was) {
    const hint = soundsElsewhere(text, steps, was)
    return hint ? { place: was, sure: false, hint } : { place: was, sure: true }
  }
  const match = matchStep(text, steps)
  const place = match.stepId ?? (hooks ? HOOK : null)
  return { place, sure: match.sure && place !== null }
}

/** The step a clip's words sound like when that isn't where it is (`at`: a
 *  step's id or HOOK) - maybe in the wrong step. Null when they agree with
 *  its place or say no step clearly. A hook may name the product's steps in
 *  passing: only a clear match says it is one. */
export function soundsElsewhere(text: string, steps: readonly Pick<BatchStep, 'id' | 'name' | 'heard'>[], at: string): string | null {
  if (!text.trim()) return null
  const match = matchStep(text, steps)
  if (!match.stepId || match.stepId === at) return null
  if (at === HOOK && !match.sure) return null
  return match.stepId
}

/** A clip of a format as the recheck sees it: where it is, what he says in
 *  it (null: never heard), the step that sounds like instead. */
export interface PlacedClip {
  file: BankFile
  place: string
  words: CaptionWord[] | null
  elsewhere: string | null
}

/** He has looked at where this clip is (DropCheck.tsx). */
export const checkedClip = (file: BankFile): boolean => Boolean(file.checked || file.captions)

/** Every clip of a talking head format: its steps', and the hooks given (his
 *  hooks when dropped clips can be hooks - one may have landed there).
 *  `heard`: what is known of what he says in a clip (talkCaptions.keptWords). */
export function clipsOfFormat(
  steps: readonly Pick<BatchStep, 'id' | 'name' | 'heard' | 'files'>[],
  hooks: readonly BankFile[],
  heard: (file: BankFile) => CaptionWord[] | null,
): PlacedClip[] {
  const seen = new Set<string>()
  const all = [...steps.flatMap((st) => st.files.map((file) => ({ file, place: st.id }))), ...hooks.map((file) => ({ file, place: HOOK }))]
  return all
    .filter(({ file }) => !seen.has(file.id) && Boolean(seen.add(file.id)))
    .map(({ file, place }) => {
      const words = heard(file)
      const text = words ? words.map((w) => w.text).join(' ') : ''
      return { file, place, words, elsewhere: soundsElsewhere(text, steps, place) }
    })
}

/** A clip of the batch, to be looked at again. */
export function recheckOf(clip: PlacedClip): ToCheck {
  return {
    file: clip.file,
    name: clip.file.name,
    text: clip.words ? clip.words.map((w) => w.text).join(' ') : '',
    words: clip.words ?? [],
    place: clip.place,
    sure: !clip.elsewhere,
    recheck: true,
    ...(clip.elsewhere ? { hint: clip.elsewhere } : {}),
    ...(clip.words ? {} : { unheard: true }),
  }
}

/** These clips of the batch added to the format's check, after what is
 *  waiting there - none twice. */
export function queueRecheck(formatId: string, clips: readonly PlacedClip[]): ToCheck[] {
  const list = loadQueue(formatId)
  const there = new Set(list.map((q) => q.file.id))
  const next = [...list, ...clips.filter((c) => !there.has(c.file.id)).map(recheckOf)]
  saveQueue(formatId, next)
  return next
}

/** The clip with this id where it is in the batch now, or null when it is in
 *  no step and no hook any more. */
export function fileIn(bank: BatchBank, id: string): BankFile | null {
  return (bank.steps ?? []).flatMap((s) => s.files).find((f) => f.id === id) ?? bank.reactions.find((r) => r.id === id) ?? null
}

/** The bank with `file` in `to` (a step, or HOOK - one of this format's
 *  hooks, his voice kept), out of everywhere else, and the clip it replaces
 *  gone. `to` null: in no place. */
export function placed(bank: BatchBank, formatId: string, file: BankFile, to: string | null, replaces?: string): BatchBank {
  const gone = (f: BankFile) => f.id === file.id || (replaces !== undefined && f.id === replaces)
  const hook = { ...file, formats: [formatId], talks: true }
  // A hook moved to a step is a step's clip: none of a hook's marks.
  const inStep = bank.reactions.some((r) => r.id === file.id) ? stepClip(file) : file
  // Already there: changed where it is, not moved to the end.
  const hookThere = to === HOOK && bank.reactions.some((r) => r.id === file.id)
  const reactions = hookThere
    ? bank.reactions.filter((r) => r.id === file.id || !gone(r)).map((r) => (r.id === file.id ? hook : r))
    : bank.reactions.filter((r) => !gone(r))
  return {
    ...bank,
    reactions: to === HOOK && !hookThere ? [...reactions, hook] : hookThere || reactions.length !== bank.reactions.length ? reactions : bank.reactions,
    steps: (bank.steps ?? []).map((st) => {
      if (st.id === to && st.files.some((f) => f.id === file.id)) {
        return { ...st, files: st.files.filter((f) => f.id === file.id || !gone(f)).map((f) => (f.id === file.id ? inStep : f)) }
      }
      const without = st.files.filter((f) => !gone(f))
      return st.id === to ? { ...st, files: [...without, inStep] } : without.length === st.files.length ? st : { ...st, files: without }
    }),
  }
}

/** A clip without a hook's marks (the format it is a hook of, his voice kept). */
function stepClip(file: BankFile): BankFile {
  if (file.formats === undefined && file.talks === undefined) return file
  const copy = { ...file }
  delete copy.formats
  delete copy.talks
  return copy
}

/** The clips of a talking head format still as he filmed them: its steps'
 *  and the hooks given (none when he keeps them raw). */
export function notEdited(steps: readonly Pick<BatchStep, 'files'>[], hooks: readonly BankFile[]): BankFile[] {
  return [...steps.flatMap((s) => s.files), ...hooks].filter((f) => !f.edited)
}
