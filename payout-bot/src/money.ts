// Money is kept in whole cents everywhere so totals never pick up float drift.

const MAX_CENTS = 100_000_000_00 // $100M: anything above is a typo, not a payout

/** "$1,250" - whole dollars, for nicknames and leaderboards. */
export function formatDollars(cents: number): string {
  const dollars = Math.round(cents / 100)
  const sign = dollars < 0 ? '-' : ''
  return `${sign}$${Math.abs(dollars).toLocaleString('en-US')}`
}

/** "$1,250.50", or "$1,250" when there are no cents - for approval cards. */
export function formatExact(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(Math.round(cents))
  const whole = Math.floor(abs / 100).toLocaleString('en-US')
  const rest = abs % 100
  return rest === 0 ? `${sign}$${whole}` : `${sign}$${whole}.${String(rest).padStart(2, '0')}`
}

/**
 * Reads an amount a mod typed: "500", "$1,250.50", "1.2k", "1 250".
 * Returns cents, or null when it is not a usable positive amount.
 */
export function parseAmount(input: string): number | null {
  const match = /^\$?\s*(\d[\d,\s]*(?:\.\d+)?)\s*([kK])?\s*(?:usd|USD|\$)?$/.exec(input.trim())
  if (!match) return null
  const number = Number(match[1].replace(/[,\s]/g, ''))
  if (!Number.isFinite(number)) return null
  const cents = Math.round(number * (match[2] ? 1000 : 1) * 100)
  if (cents <= 0 || cents > MAX_CENTS) return null
  return cents
}

/** Turns a decimal amount (as the screenshot reader reports it) into cents. */
export function toCents(amount: number): number | null {
  if (!Number.isFinite(amount) || amount <= 0) return null
  const cents = Math.round(amount * 100)
  return cents > MAX_CENTS ? null : cents
}
