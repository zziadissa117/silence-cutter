import { describe, expect, it } from 'vitest'
import { boardLines, leaderboardEmbeds } from './board.ts'
import { decidedCard, parseCustomId, pendingCard, quickApproveCents } from './card.ts'
import { ConfigError, loadConfig } from './config.ts'
import { dayIn, prettyDay, previousDay } from './day.ts'
import type { Payout } from './db.ts'
import { formatDollars, formatExact, parseAmount, toCents } from './money.ts'
import { buildNickname, stripTotal, totalInName } from './nickname.ts'
import { poolConfig } from './pool.ts'

describe('money', () => {
  it('formats whole dollars for names and boards', () => {
    expect(formatDollars(125_000)).toBe('$1,250')
    expect(formatDollars(80_049)).toBe('$800')
    expect(formatDollars(0)).toBe('$0')
    expect(formatDollars(1_250_000_00)).toBe('$1,250,000')
  })

  it('shows cents only when there are some', () => {
    expect(formatExact(125_050)).toBe('$1,250.50')
    expect(formatExact(50_000)).toBe('$500')
    expect(formatExact(5)).toBe('$0.05')
  })

  it('reads what a mod types', () => {
    expect(parseAmount('500')).toBe(50_000)
    expect(parseAmount('$1,250.50')).toBe(125_050)
    expect(parseAmount('1.2k')).toBe(120_000)
    expect(parseAmount('1 250')).toBe(125_000)
    expect(parseAmount('500 USD')).toBe(50_000)
    expect(parseAmount(' $ 75 ')).toBe(7_500)
  })

  it('refuses what is not a positive amount', () => {
    for (const bad of ['', 'abc', '0', '-5', '5-', '1e5', '$', '12.3.4', '999999999999']) {
      expect(parseAmount(bad), bad).toBeNull()
    }
  })

  it('turns decimal amounts into cents', () => {
    expect(toCents(1250.5)).toBe(125_050)
    expect(toCents(0.1 + 0.2)).toBe(30)
    expect(toCents(0)).toBeNull()
    expect(toCents(Number.NaN)).toBeNull()
  })
})

describe('nicknames', () => {
  it('finds and strips a money tag in the usual spellings', () => {
    const cases: [string, string, number | null][] = [
      ['Ziad | $800', 'Ziad', 80_000],
      ['Ziad - $1,250', 'Ziad', 125_000],
      ['Ziad $1.2k', 'Ziad', 120_000],
      ['Ziad | 800$', 'Ziad', 80_000],
      ['Ziad•$300', 'Ziad', 30_000],
      ['Ziad', 'Ziad', null],
      ['Player 2', 'Player 2', null],
      ['$500', '', 50_000],
    ]
    for (const [name, stripped, cents] of cases) {
      expect(stripTotal(name), name).toBe(stripped)
      expect(totalInName(name), name).toBe(cents)
    }
  })

  it('adds the total, replacing any old one', () => {
    expect(buildNickname('Ziad', 30_000)).toBe('Ziad | $300')
    expect(buildNickname('Ziad | $300', 80_000)).toBe('Ziad | $800')
    expect(buildNickname('Ziad | $99,999', 80_000)).toBe('Ziad | $800')
  })

  it('takes the tag off when the total is zero', () => {
    expect(buildNickname('Ziad | $300', 0)).toBe('Ziad')
    expect(buildNickname('Ziad', 0)).toBe('Ziad')
  })

  it("shortens the name, never the amount, to fit Discord's 32 characters", () => {
    const name = buildNickname('Bartholomew Montgomery-Smithson the Third', 1_234_567_00)
    expect(name.length).toBeLessThanOrEqual(32)
    expect(name.endsWith(' | $1,234,567')).toBe(true)
  })

  it('still shows the amount when there is no name left', () => {
    expect(buildNickname('', 50_000)).toBe('$500')
  })
})

describe('days', () => {
  it("rolls over at midnight New York time, in winter and in summer", () => {
    const ny = 'America/New_York'
    expect(dayIn(new Date('2026-11-18T04:59:00Z'), ny)).toBe('2026-11-17') // 11:59pm EST
    expect(dayIn(new Date('2026-11-18T05:00:00Z'), ny)).toBe('2026-11-18') // midnight EST
    expect(dayIn(new Date('2026-07-01T03:59:00Z'), ny)).toBe('2026-06-30') // 11:59pm EDT
    expect(dayIn(new Date('2026-07-01T04:00:00Z'), ny)).toBe('2026-07-01') // midnight EDT
  })

  it('steps back across months and years', () => {
    expect(previousDay('2026-03-01')).toBe('2026-02-28')
    expect(previousDay('2026-01-01')).toBe('2025-12-31')
  })

  it('names a day', () => {
    expect(prettyDay('2026-11-17')).toBe('Tuesday, Nov 17')
  })
})

describe('leaderboard', () => {
  it('gives medals to the top three and numbers the rest', () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ name: `S${i + 1}`, cents: (12 - i) * 10_000 }))
    const lines = boardLines(rows).split('\n')
    expect(lines).toHaveLength(10)
    expect(lines[0]).toBe('🥇 S1 — **$1,200**')
    expect(lines[1].startsWith('🥈 S2')).toBe(true)
    expect(lines[2].startsWith('🥉 S3')).toBe(true)
    expect(lines[3]).toBe('` 4.` S4 — $900')
    expect(lines[9]).toBe('`10.` S10 — $300')
  })

  it("shows what someone added today on the all-time board", () => {
    expect(boardLines([{ name: 'Ziad', cents: 80_000, todayCents: 50_000 }])).toBe(
      '🥇 Ziad — **$800**  *(+$500 today)*',
    )
  })

  it('stops names turning into formatting', () => {
    expect(boardLines([{ name: '*star*_x_', cents: 100 }])).toContain('\\*star\\*\\_x\\_')
  })

  it('makes a today board and an all-time board', () => {
    const [today, allTime] = leaderboardEmbeds('2026-11-17', [], [{ name: 'Ziad', cents: 100 }], true)
    expect(today.title).toBe('🏆 Top earners — Tuesday, Nov 17')
    expect(today.description).toBe('No payouts approved this day.')
    expect(allTime.title).toBe('💰 All-time leaderboard')
    const [soFar] = leaderboardEmbeds('2026-11-17', [], [], false)
    expect(soFar.title).toContain('so far')
  })
})

const basePayout: Payout = {
  id: 7,
  guildId: 'g',
  userId: 'student',
  messageId: 'm',
  channelId: 'c',
  status: 'pending',
  kind: 'payout',
  amountCents: null,
  readCents: 50_000,
  readCurrency: 'USD',
  readNote: 'PayPal: $500 from Glow',
  cardChannelId: null,
  cardMessageId: null,
  replyMessageId: null,
  decidedBy: null,
}

const context = {
  studentId: 'student',
  studentName: 'Ziad',
  messageUrl: 'https://discord.com/channels/g/c/m',
  imageUrl: 'https://cdn.example/x.png',
  currentTotalCents: 30_000,
}

describe('approval card', () => {
  it('reads its button ids back', () => {
    expect(parseCustomId('payout:approve:42')).toEqual({ action: 'payout:approve', id: 42 })
    expect(parseCustomId('something:else')).toBeNull()
  })

  it('offers one-press approval only for a dollar amount', () => {
    expect(quickApproveCents(basePayout)).toBe(50_000)
    expect(quickApproveCents({ readCents: 50_000, readCurrency: 'EUR' })).toBeNull()
    expect(quickApproveCents({ readCents: null, readCurrency: null })).toBeNull()
  })

  it('puts the amount on the Approve button', () => {
    const card = pendingCard(basePayout, context)
    const [approve, edit, reject] = card.components[0].toJSON().components as { label: string; disabled?: boolean }[]
    expect(approve.label).toBe('Approve $500')
    expect(approve.disabled).toBe(false)
    expect(edit.label).toBe('Change amount')
    expect(reject.label).toBe('Reject')
    expect(card.embeds[0].description).toContain('Read **$500** from the screenshot.')
    expect(card.embeds[0].image?.url).toBe(context.imageUrl)
  })

  it('makes a mod type the amount when it is not in dollars', () => {
    const card = pendingCard({ ...basePayout, readCents: 45_000, readCurrency: 'EUR' }, context)
    const [approve] = card.components[0].toJSON().components as { disabled?: boolean }[]
    expect(approve.disabled).toBe(true)
    expect(card.embeds[0].description).toContain('450 EUR')
  })

  it('shows the result and drops the buttons once decided', () => {
    const approved = decidedCard(undefined, { ...basePayout, status: 'approved', amountCents: 50_000, decidedBy: 'mod' }, 80_000)
    expect(approved.components).toEqual([])
    expect(approved.embeds[0].description).toContain('**+$500**')
    expect(approved.embeds[0].description).toContain('**$800**')
    const rejected = decidedCard(undefined, { ...basePayout, status: 'rejected', decidedBy: 'mod' }, 30_000)
    expect(rejected.embeds[0].description).toContain('Rejected')
  })
})

describe('config', () => {
  const env = {
    DISCORD_TOKEN: 't',
    GUILD_ID: 'g',
    PAYOUT_CHANNEL_ID: 'p',
    DATABASE_URL: 'postgres://x',
  }

  it('posts everything in the payout channel and uses New York time unless told otherwise', () => {
    const config = loadConfig(env)
    expect(config.approvalChannelId).toBe('p')
    expect(config.leaderboardChannelId).toBe('p')
    expect(config.timeZone).toBe('America/New_York')
    expect(config.claudeModel).toBe('claude-opus-5-5')
  })

  it('names every missing setting', () => {
    expect(() => loadConfig({})).toThrow(/DISCORD_TOKEN, GUILD_ID, PAYOUT_CHANNEL_ID, DATABASE_URL/)
  })

  it('refuses a time zone that does not exist', () => {
    expect(() => loadConfig({ ...env, TIME_ZONE: 'New York' })).toThrow(ConfigError)
  })
})

describe('database connection', () => {
  it('uses SSL for hosted databases even when the link asks for strict checking', () => {
    const config = poolConfig('postgresql://u:p@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require')
    expect(config.ssl).toEqual({ rejectUnauthorized: false })
    expect(config.connectionString).not.toContain('sslmode')
  })

  it("skips SSL on Railway's private network and locally", () => {
    expect(poolConfig('postgresql://u:p@postgres.railway.internal:5432/railway').ssl).toBe(false)
    expect(poolConfig('postgresql://u:p@localhost:5432/db').ssl).toBe(false)
    expect(poolConfig('postgresql://u:p@db.example.com/db?sslmode=disable').ssl).toBe(false)
  })
})
