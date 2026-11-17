import type { APIEmbed } from 'discord.js'
import { prettyDay } from './day.ts'
import { formatDollars } from './money.ts'

export const BOARD_SIZE = 10

export interface NamedRow {
  name: string
  cents: number
  /** For the all-time board: what they added on the day being shown. */
  todayCents?: number
}

const MEDALS = ['🥇', '🥈', '🥉']
const GOLD = 0xf5b301
const GREEN = 0x2ecc71

/** Stops a name like "*star*" or "__x__" turning into Discord formatting. */
export function escapeName(name: string): string {
  return name.replace(/([\\*_~`|>#[\]()-])/g, '\\$1')
}

export function boardLines(rows: NamedRow[]): string {
  return rows
    .slice(0, BOARD_SIZE)
    .map((row, i) => {
      const place = MEDALS[i] ?? `\`${String(i + 1).padStart(2, ' ')}.\``
      const amount = i < 3 ? `**${formatDollars(row.cents)}**` : formatDollars(row.cents)
      const gained = row.todayCents ? `  *(+${formatDollars(row.todayCents)} today)*` : ''
      return `${place} ${escapeName(row.name)} — ${amount}${gained}`
    })
    .join('\n')
}

/**
 * The two leaderboards for a day: what was made that day, and the all-time
 * totals. `final` is the midnight post; otherwise it is the board so far.
 */
export function leaderboardEmbeds(
  day: string,
  today: NamedRow[],
  allTime: NamedRow[],
  final: boolean,
): APIEmbed[] {
  const dayLabel = prettyDay(day)
  return [
    {
      title: final ? `🏆 Top earners — ${dayLabel}` : `🏆 Top earners today so far — ${dayLabel}`,
      description: today.length ? boardLines(today) : 'No payouts approved this day.',
      color: GOLD,
    },
    {
      title: '💰 All-time leaderboard',
      description: allTime.length ? boardLines(allTime) : 'No payouts yet.',
      color: GREEN,
    },
  ]
}
