// New post's "Anything Claude should know", read for two things: when the
// videos go out, and what the captions should say. His ask (2026-11-03):
// "I could just set some scheduling rules with Claude, let's say 2 per day
// for the next 14 days" - and caption rules in the same box. The campaign
// stays the first source of truth: its most a day caps whatever the note
// says (the phone, handPlan.ts), and its caption rules come before the
// note's (caption.ts).
//
// Plain TypeScript with no imports, for Deno and the tests.

export const NOTE_SYSTEM = `A creator is posting some finished videos for a brand campaign and wrote a note about them. Split the note into two parts:

1. When the videos should go out, if the note says so: how many a day, from which day, for how many days. Dates are relative to today, given below with its weekday. "Starting tomorrow" is tomorrow's date; "next Monday" is the coming Monday. Leave a field null when the note doesn't say it.
2. Everything else - what the videos are about, how the captions should read, words or hashtags to use - copied as he wrote it, without the scheduling part. Empty when there is nothing else.

Never invent a schedule the note doesn't ask for.`

export const NOTE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['perDay', 'startDate', 'days', 'caption'],
  properties: {
    perDay: { type: ['integer', 'null'] },
    startDate: { type: ['string', 'null'] },
    days: { type: ['integer', 'null'] },
    caption: { type: 'string' },
  },
}

export interface NotePlan {
  /** Videos a day the note asks for; null when it doesn't say. */
  perDay: number | null
  /** The first day ("2026-11-04"); null: today. */
  startDate: string | null
  /** Over how many days; null when it doesn't say. */
  days: number | null
}

export interface ReadNote {
  /** Null when the note says nothing about when. */
  plan: NotePlan | null
  /** The note without its scheduling, for the captions. */
  caption: string
}

/** What Claude is told: today, how many videos, the note. */
export function noteMessage(note: string, today: string, weekday: string, count: number): string {
  return [`Today is ${weekday} ${today}.`, `Videos being posted: ${count}.`, `His note: ${note.slice(0, 2000)}`].join('\n')
}

/** Claude's answer made safe: counts in sane ranges, a real date not in
 *  the past, the caption part as text. A note it couldn't read keeps all its
 *  words for the captions, and no plan. */
export function cleanNote(value: unknown, note: string, today: string): ReadNote {
  if (!value || typeof value !== 'object') return { plan: null, caption: note }
  const v = value as Record<string, unknown>
  const int = (x: unknown, max: number) => (typeof x === 'number' && Number.isInteger(x) && x >= 1 && x <= max ? x : null)
  const perDay = int(v.perDay, 50)
  const days = int(v.days, 365)
  const date = typeof v.startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.startDate) && !Number.isNaN(Date.parse(`${v.startDate}T12:00:00Z`)) ? v.startDate : null
  const startDate = date && date > today ? date : null
  const caption = typeof v.caption === 'string' ? v.caption.trim().slice(0, 2000) : note
  const plan = perDay !== null || startDate !== null || days !== null ? { perDay, startDate, days } : null
  return { plan, caption }
}
