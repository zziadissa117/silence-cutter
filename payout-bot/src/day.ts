// Days are "YYYY-MM-DD" strings in the server's time zone, so they compare as text.

/** The calendar day a moment falls on in a time zone. */
export function dayIn(moment: Date, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(moment)
}

export function previousDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10)
}

/** "Monday, Nov 17" */
export function prettyDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  }).format(new Date(Date.UTC(y, m - 1, d)))
}
