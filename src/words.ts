// The words both pages use for the same things, so a video is "Waiting" on
// one page and "Waiting" on the other.

export type Phase = 'reading' | 'model' | 'listening' | 'cutting' | 'joining'

/** What a working row says it is doing. Short, so it fits beside a name. */
export const PHASE: Record<Phase, string> = {
  reading: 'Reading the sound',
  model: 'Getting the speech model',
  listening: 'Listening',
  cutting: 'Cutting',
  joining: 'Joining the parts',
}

/** The same, mid-sentence: "Something went wrong while ...". */
export const PHASE_DOING: Record<Phase, string> = {
  reading: 'reading the sound',
  model: 'getting the speech model',
  listening: 'listening',
  cutting: 'cutting',
  joining: 'joining the parts',
}

/** A video left alone after it crashed the app twice. */
export const HELD_LINE = 'Paused after two crashes'
export const HELD_TEXT = 'This video crashed the app twice, so it is paused.'

export function heldNotice(count: number): string {
  return count === 1
    ? '1 video crashed the app twice, so it is paused. Tap Try again or Remove.'
    : `${count} videos crashed the app twice, so they are paused. Tap Try again or Remove.`
}

export function pickedUpNotice(count: number): string {
  return `Picked up ${count} video${count === 1 ? '' : 's'} that hadn't finished.`
}

/** "3 pauses", "1 pause". */
export function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/** How to stop the iPhone picker converting videos before handing them over
 *  (see pickFormat.ts), in words rather than glyphs. */
export const PICKER_CURRENT = 'In the picker, tap the three dots, then Options, Format, Current.'
