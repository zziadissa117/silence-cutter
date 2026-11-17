import { formatDollars } from './money.ts'

const MAX_NICKNAME = 32 // Discord's limit
const SEPARATOR = ' | '

// A money tag at the end of a name: "Ziad | $800", "Ziad - $1,250", "Ziad $1.2k", "Ziad | 800$".
const TRAILING_TOTAL =
  /\s*(?:[|·•\-–—:]\s*)?(?:\$\s?(\d[\d,]*(?:\.\d+)?)\s?([kKmM])?|(\d[\d,]*(?:\.\d+)?)\s?([kKmM])?\s?\$)\s*$/

/** The name without any money tag on the end. */
export function stripTotal(name: string): string {
  return name.replace(TRAILING_TOTAL, '').trim()
}

/** The money tag at the end of a name, in cents, or null if there is none. */
export function totalInName(name: string): number | null {
  const match = TRAILING_TOTAL.exec(name)
  if (!match) return null
  const digits = match[1] ?? match[3]
  const suffix = (match[2] ?? match[4] ?? '').toLowerCase()
  const amount = Number(digits.replace(/,/g, ''))
  if (!Number.isFinite(amount) || amount <= 0) return null
  const scale = suffix === 'k' ? 1_000 : suffix === 'm' ? 1_000_000 : 1
  return Math.round(amount * scale * 100)
}

/**
 * "Ziad | $800". The name is shortened, never the amount, so the tag always fits
 * Discord's 32 characters. A total of zero means no tag at all.
 */
export function buildNickname(name: string, totalCents: number): string {
  const base = stripTotal(name)
  if (totalCents <= 0) return base.slice(0, MAX_NICKNAME)
  const tag = formatDollars(totalCents)
  const room = MAX_NICKNAME - tag.length - SEPARATOR.length
  if (room < 1 || base.length === 0) return tag
  const short = base.length > room ? base.slice(0, room).trimEnd() : base
  return `${short}${SEPARATOR}${tag}`
}
