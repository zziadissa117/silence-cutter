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
): { place: string | null; sure: boolean } {
  if (to) return { place: to, sure: true }
  const was = replaces && bank ? placeOf(bank, replaces) : null
  if (was) return { place: was, sure: true }
  const match = matchStep(text, steps)
  const place = match.stepId ?? (hooks ? HOOK : null)
  return { place, sure: match.sure && place !== null }
}

/** The bank with `file` in `to` (a step, or HOOK - one of this format's
 *  hooks, his voice kept), out of everywhere else, and the clip it replaces
 *  gone. `to` null: in no place. */
export function placed(bank: BatchBank, formatId: string, file: BankFile, to: string | null, replaces?: string): BatchBank {
  const gone = (f: BankFile) => f.id === file.id || (replaces !== undefined && f.id === replaces)
  const reactions = bank.reactions.filter((r) => !gone(r))
  return {
    ...bank,
    reactions:
      to === HOOK ? [...reactions, { ...file, formats: [formatId], talks: true }] : reactions.length === bank.reactions.length ? bank.reactions : reactions,
    steps: (bank.steps ?? []).map((st) => {
      const without = st.files.filter((f) => !gone(f))
      return st.id === to ? { ...st, files: [...without, file] } : without.length === st.files.length ? st : { ...st, files: without }
    }),
  }
}

/** The clips of a talking head format still as he filmed them: its steps'
 *  and the hooks given (none when he keeps them raw). */
export function notEdited(steps: readonly Pick<BatchStep, 'files'>[], hooks: readonly BankFile[]): BankFile[] {
  return [...steps.flatMap((s) => s.files), ...hooks].filter((f) => !f.edited)
}
