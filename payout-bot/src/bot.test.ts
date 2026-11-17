// Drives the bot through Discord events with stand-in Discord objects and a real
// (in-memory) Postgres, to check the whole payout flow end to end.
import { Collection, Events, PermissionFlagsBits, PermissionsBitField } from 'discord.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBot } from './bot.ts'
import type { Config } from './config.ts'
import { getPayout, totalFor, type Db } from './db.ts'
import { memoryDb } from './testDb.ts'
import type { ReadPayout } from './reader.ts'

const G = 'guild'
const PAYOUTS = 'payouts-channel'
const APPROVALS = 'mods-channel'
const BOARD = 'leaderboard-channel'

function config(overrides: Partial<Config> = {}): Config {
  return {
    discordToken: 't',
    guildId: G,
    payoutChannelId: PAYOUTS,
    approvalChannelId: APPROVALS,
    leaderboardChannelId: BOARD,
    modRoleId: null,
    databaseUrl: '',
    timeZone: 'America/New_York',
    claudeModel: 'm',
    ...overrides,
  }
}

interface FakeMember {
  id: string
  nickname: string | null
  user: { id: string; username: string; globalName: string; bot: boolean }
  guild: { id: string; ownerId: string }
  manageable: boolean
  readonly displayName: string
  setNickname: (name: string) => Promise<void>
}

function member(id: string, globalName: string, nickname: string | null = null): FakeMember {
  return {
    id,
    nickname,
    user: { id, username: globalName.toLowerCase(), globalName, bot: false },
    guild: { id: G, ownerId: 'owner' },
    manageable: true,
    get displayName() {
      return this.nickname ?? this.user.globalName
    },
    async setNickname(name: string) {
      this.nickname = name
    },
  }
}

interface Sent {
  channelId: string
  id: string
  content?: string
  embeds?: { title?: string; description?: string }[]
  edits: unknown[]
}

let db: Db
let members: Map<string, FakeMember>
let sent: Sent[]
type StudentMessage = { reactionsAdded: string[]; [key: string]: unknown }
let studentMessages: Map<string, StudentMessage>

function channel(id: string) {
  return {
    id,
    isSendable: () => true,
    isTextBased: () => true,
    send: async (body: Omit<Sent, 'channelId' | 'id' | 'edits'>) => {
      const message: Sent = { channelId: id, id: `sent-${sent.length + 1}`, edits: [], ...body }
      sent.push(message)
      return message
    },
    messages: {
      fetch: async (messageId: string) => {
        const student = studentMessages.get(messageId)
        if (student) return student
        const ours = sent.find((m) => m.id === messageId)
        if (!ours) throw new Error(`no message ${messageId}`)
        return { ...ours, edit: async (body: unknown) => ours.edits.push(body) }
      },
    },
  }
}

const guild = {
  id: G,
  ownerId: 'owner',
  members: {
    fetch: async (arg?: string | { user: string[] }) => {
      if (typeof arg === 'string') {
        const found = members.get(arg)
        if (!found) throw new Error('Unknown Member')
        return found
      }
      const ids = arg ? arg.user : [...members.keys()]
      return new Collection(ids.filter((id) => members.has(id)).map((id) => [id, members.get(id)!]))
    },
  },
}

function studentMessage(id: string, authorId: string, content = '') {
  const reactions: string[] = []
  const message = {
    id,
    guildId: G,
    channelId: PAYOUTS,
    content,
    url: `https://discord.com/channels/${G}/${PAYOUTS}/${id}`,
    createdTimestamp: Date.now(),
    author: { id: authorId, bot: false, username: members.get(authorId)?.user.username ?? 'x' },
    member: members.get(authorId) ?? null,
    guild,
    attachments: new Collection([
      [
        'a',
        {
          name: 'shot.png',
          contentType: 'image/png',
          url: `https://cdn.discordapp.com/attachments/${id}.png`,
          proxyURL: `https://media.discordapp.net/attachments/${id}.png`,
          size: 1000,
          width: 800,
          height: 1600,
        },
      ],
    ]),
    reactions: { cache: new Map() },
    reactionsAdded: reactions,
    inGuild: () => true,
    react: async (emoji: string) => {
      reactions.push(emoji)
    },
    reply: async (body: Omit<Sent, 'channelId' | 'id' | 'edits'>) => {
      const reply: Sent = { channelId: PAYOUTS, id: `sent-${sent.length + 1}`, edits: [], ...body }
      sent.push(reply)
      return reply
    },
  }
  studentMessages.set(id, message)
  return message
}

function button(customId: string, opts: { mod?: boolean; userId?: string; card?: Sent } = {}) {
  const calls = { deferUpdate: 0, editReply: [] as unknown[], reply: [] as unknown[], followUp: [] as unknown[], showModal: [] as unknown[] }
  const interaction = {
    customId,
    user: { id: opts.userId ?? 'mod1' },
    memberPermissions: new PermissionsBitField(opts.mod === false ? 0n : PermissionFlagsBits.ManageNicknames),
    member: { roles: [] },
    message: { embeds: (opts.card?.embeds ?? []).map((e) => ({ toJSON: () => e })) },
    replied: false,
    deferred: false,
    isChatInputCommand: () => false,
    isButton: () => true,
    isModalSubmit: () => false,
    isRepliable: () => true,
    deferUpdate: async () => {
      calls.deferUpdate++
    },
    editReply: async (body: unknown) => calls.editReply.push(body),
    reply: async (body: unknown) => calls.reply.push(body),
    followUp: async (body: unknown) => calls.followUp.push(body),
    showModal: async (body: unknown) => calls.showModal.push(body),
  }
  return { interaction, calls }
}

function start(read: ReadPayout | null, overrides: Partial<Config> = {}) {
  const bot = createBot({ config: config(overrides), db, readPayout: read })
  vi.spyOn(bot.client.guilds, 'fetch').mockResolvedValue(guild as never)
  vi.spyOn(bot.client.channels, 'fetch').mockImplementation(async (id: string) => channel(id) as never)
  return bot
}

const readsFiveHundred: ReadPayout = async () => ({ cents: 50_000, currency: 'USD', note: 'PayPal: $500 from Glow' })

async function payoutRow(messageId: string) {
  const rows = await db.query<{ id: string }>(`select id from payouts where message_id = $1`, [messageId])
  return rows.length ? getPayout(db, Number(rows[0].id)) : null
}

beforeEach(async () => {
  ;({ db } = await memoryDb())
  members = new Map([
    ['ziad', member('ziad', 'Ziad')],
    ['sam', member('sam', 'Sam')],
  ])
  sent = []
  studentMessages = new Map()
  vi.stubGlobal('fetch', async () => new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('a student posts a payout screenshot', () => {
  it('reads it, sends mods a card and tells the student', async () => {
    const { client } = start(readsFiveHundred)
    const message = studentMessage('m1', 'ziad', 'got paid')
    client.emit(Events.MessageCreate, message as never)

    await vi.waitFor(async () => expect((await payoutRow('m1'))?.status).toBe('pending'))
    const card = sent.find((m) => m.channelId === APPROVALS)!
    expect(card.embeds?.[0].description).toContain('Read **$500**')
    const reply = sent.find((m) => m.channelId === PAYOUTS)!
    expect(reply.content).toContain('I read **$500**')
    expect(message.reactionsAdded).toEqual(['👀'])
    expect(await totalFor(db, G, 'ziad')).toBe(0) // nothing counts until a mod approves
  })

  it('ignores other channels, bots and messages without images', async () => {
    const { client } = start(readsFiveHundred)
    client.emit(Events.MessageCreate, { ...studentMessage('m1', 'ziad'), channelId: 'general' } as never)
    client.emit(Events.MessageCreate, { ...studentMessage('m2', 'ziad'), author: { id: 'b', bot: true } } as never)
    client.emit(Events.MessageCreate, { ...studentMessage('m3', 'ziad'), attachments: new Collection() } as never)
    await new Promise((r) => setTimeout(r, 200))
    expect(sent).toEqual([])
  })

  it('makes only one card when the same message arrives twice', async () => {
    const { client } = start(readsFiveHundred)
    const message = studentMessage('m1', 'ziad')
    client.emit(Events.MessageCreate, message as never)
    client.emit(Events.MessageCreate, message as never)
    await vi.waitFor(async () => expect((await payoutRow('m1'))?.status).toBe('pending'))
    await new Promise((r) => setTimeout(r, 200))
    expect(sent.filter((m) => m.channelId === APPROVALS)).toHaveLength(1)
  })

  it('still makes a card when the screenshot cannot be read', async () => {
    const { client } = start(async () => {
      throw new Error('API down')
    })
    client.emit(Events.MessageCreate, studentMessage('m1', 'ziad') as never)
    await vi.waitFor(async () => expect((await payoutRow('m1'))?.status).toBe('pending'))
    expect(sent.find((m) => m.channelId === APPROVALS)?.embeds?.[0].description).toContain('Change amount')
  })

  it('replies with the card itself when there is no separate mod channel', async () => {
    const { client } = start(readsFiveHundred, { approvalChannelId: PAYOUTS })
    client.emit(Events.MessageCreate, studentMessage('m1', 'ziad') as never)
    await vi.waitFor(async () => expect((await payoutRow('m1'))?.status).toBe('pending'))
    expect(sent).toHaveLength(1)
    expect(sent[0].embeds?.[0].description).toContain('Read **$500**')
  })
})

async function postAndWait(client: ReturnType<typeof start>['client'], id: string, who: string) {
  client.emit(Events.MessageCreate, studentMessage(id, who) as never)
  await vi.waitFor(async () => expect((await payoutRow(id))?.status).toBe('pending'))
  const payout = (await payoutRow(id))!
  const card = sent.find((m) => m.id === payout.cardMessageId)!
  return { payout, card }
}

describe('a mod decides', () => {
  it('approving adds to the total, renames the student and tells them', async () => {
    const { client } = start(readsFiveHundred)
    const { payout, card } = await postAndWait(client, 'm1', 'ziad')

    const { interaction, calls } = button(`payout:approve:${payout.id}`, { card })
    client.emit(Events.InteractionCreate, interaction as never)
    await vi.waitFor(() => expect(calls.editReply).toHaveLength(1))

    expect(await totalFor(db, G, 'ziad')).toBe(50_000)
    expect(members.get('ziad')!.nickname).toBe('Ziad | $500')
    const updated = calls.editReply[0] as { embeds: { description: string }[]; components: unknown[] }
    expect(updated.components).toEqual([])
    expect(updated.embeds[0].description).toContain('**+$500**')
    expect(studentMessages.get('m1')!.reactionsAdded).toEqual(['👀', '✅'])
    const reply = sent.find((m) => m.id === payout.replyMessageId)!
    await vi.waitFor(() => expect(reply.edits).toEqual(["✅ **+$500** added — you're now at **$500**!"]))
  })

  it('stacks a second payout on the first: $300 then $500 makes $800', async () => {
    const amounts = [30_000, 50_000]
    const { client } = start(async () => ({ cents: amounts.shift()!, currency: 'USD', note: '' }))
    for (const id of ['m1', 'm2']) {
      const { payout, card } = await postAndWait(client, id, 'ziad')
      const { interaction, calls } = button(`payout:approve:${payout.id}`, { card })
      client.emit(Events.InteractionCreate, interaction as never)
      await vi.waitFor(() => expect(calls.editReply).toHaveLength(1))
    }
    expect(await totalFor(db, G, 'ziad')).toBe(80_000)
    expect(members.get('ziad')!.nickname).toBe('Ziad | $800')
  })

  it('rejecting counts nothing and leaves the name alone', async () => {
    const { client } = start(readsFiveHundred)
    const { payout, card } = await postAndWait(client, 'm1', 'ziad')
    const { interaction, calls } = button(`payout:reject:${payout.id}`, { card })
    client.emit(Events.InteractionCreate, interaction as never)
    await vi.waitFor(() => expect(calls.editReply).toHaveLength(1))
    expect(await totalFor(db, G, 'ziad')).toBe(0)
    expect(members.get('ziad')!.nickname).toBeNull()
    expect(studentMessages.get('m1')!.reactionsAdded).toEqual(['👀', '❌'])
  })

  it('students cannot approve their own payouts', async () => {
    const { client } = start(readsFiveHundred)
    const { payout, card } = await postAndWait(client, 'm1', 'ziad')
    const { interaction, calls } = button(`payout:approve:${payout.id}`, { card, mod: false, userId: 'ziad' })
    client.emit(Events.InteractionCreate, interaction as never)
    await vi.waitFor(() => expect(calls.reply).toHaveLength(1))
    expect(calls.reply[0]).toMatchObject({ content: 'Only mods can approve payouts.' })
    expect(await totalFor(db, G, 'ziad')).toBe(0)
  })

  it('a mod role set in MOD_ROLE_ID can approve without other permissions', async () => {
    const { client } = start(readsFiveHundred, { modRoleId: 'coach' })
    const { payout, card } = await postAndWait(client, 'm1', 'ziad')
    const { interaction, calls } = button(`payout:approve:${payout.id}`, { card, mod: false })
    interaction.member = { roles: ['coach'] as never }
    client.emit(Events.InteractionCreate, interaction as never)
    await vi.waitFor(() => expect(calls.editReply).toHaveLength(1))
    expect(await totalFor(db, G, 'ziad')).toBe(50_000)
  })

  it('asks for the amount when the screenshot was not in dollars', async () => {
    const { client } = start(async () => ({ cents: 45_000, currency: 'EUR', note: '' }))
    const { payout, card } = await postAndWait(client, 'm1', 'ziad')
    const { interaction, calls } = button(`payout:approve:${payout.id}`, { card })
    client.emit(Events.InteractionCreate, interaction as never)
    await vi.waitFor(() => expect(calls.showModal).toHaveLength(1))
    expect(await totalFor(db, G, 'ziad')).toBe(0)
  })

  it('counts the amount a mod types in', async () => {
    const { client } = start(readsFiveHundred)
    const { payout, card } = await postAndWait(client, 'm1', 'ziad')
    const { interaction, calls } = button(`payout:amount:${payout.id}`, { card })
    Object.assign(interaction, {
      isButton: () => false,
      isModalSubmit: () => true,
      isFromMessage: () => true,
      fields: { getTextInputValue: () => '$1,250' },
    })
    client.emit(Events.InteractionCreate, interaction as never)
    await vi.waitFor(() => expect(calls.editReply).toHaveLength(1))
    expect(await totalFor(db, G, 'ziad')).toBe(125_000)
    expect(members.get('ziad')!.nickname).toBe('Ziad | $1,250')
  })

  it('says why when it cannot rename the server owner', async () => {
    members.get('ziad')!.guild.ownerId = 'ziad'
    const { client } = start(readsFiveHundred)
    const { payout, card } = await postAndWait(client, 'm1', 'ziad')
    const { interaction, calls } = button(`payout:approve:${payout.id}`, { card })
    client.emit(Events.InteractionCreate, interaction as never)
    await vi.waitFor(() => expect(calls.editReply).toHaveLength(1))
    expect(await totalFor(db, G, 'ziad')).toBe(50_000)
    const updated = calls.editReply[0] as { embeds: { description: string }[] }
    expect(updated.embeds[0].description).toContain("doesn't let bots rename the server owner")
  })

  it('a second press after approval does nothing', async () => {
    const { client } = start(readsFiveHundred)
    const { payout, card } = await postAndWait(client, 'm1', 'ziad')
    const first = button(`payout:approve:${payout.id}`, { card })
    client.emit(Events.InteractionCreate, first.interaction as never)
    await vi.waitFor(() => expect(first.calls.editReply).toHaveLength(1))
    const second = button(`payout:approve:${payout.id}`, { card, userId: 'mod2' })
    client.emit(Events.InteractionCreate, second.interaction as never)
    await vi.waitFor(() => expect(second.calls.reply).toHaveLength(1))
    expect(await totalFor(db, G, 'ziad')).toBe(50_000)
  })
})

describe('names stay honest', () => {
  it('puts the real total back if a student edits their tag', async () => {
    const { client } = start(readsFiveHundred)
    const { payout, card } = await postAndWait(client, 'm1', 'ziad')
    const { interaction, calls } = button(`payout:approve:${payout.id}`, { card })
    client.emit(Events.InteractionCreate, interaction as never)
    await vi.waitFor(() => expect(calls.editReply).toHaveLength(1))

    const ziad = members.get('ziad')!
    const before = { ...ziad, nickname: ziad.nickname }
    ziad.nickname = 'Ziad | $99,999'
    client.emit(Events.GuildMemberUpdate, before as never, ziad as never)
    await vi.waitFor(() => expect(ziad.nickname).toBe('Ziad | $500'))
  })

  it('takes a made-up tag off someone with no payouts', async () => {
    const { client } = start(readsFiveHundred)
    const sam = members.get('sam')!
    const before = { ...sam, nickname: null }
    sam.nickname = 'Sam | $10,000'
    client.emit(Events.GuildMemberUpdate, before as never, sam as never)
    await vi.waitFor(() => expect(sam.nickname).toBe('Sam'))
  })
})

describe('the midnight leaderboard', () => {
  it('posts the finished day once, at midnight New York time', async () => {
    const { client, tick } = start(readsFiveHundred)
    vi.useFakeTimers({ toFake: ['Date'] })

    vi.setSystemTime(new Date('2026-11-17T15:00:00Z')) // 10am Tuesday in New York
    await tick() // first run: nothing to post yet
    const { payout, card } = await postAndWait(client, 'm1', 'ziad')
    const { interaction, calls } = button(`payout:approve:${payout.id}`, { card })
    client.emit(Events.InteractionCreate, interaction as never)
    await vi.waitFor(() => expect(calls.editReply).toHaveLength(1))

    vi.setSystemTime(new Date('2026-11-18T04:59:00Z')) // 11:59pm
    await tick()
    expect(sent.filter((m) => m.channelId === BOARD)).toHaveLength(0)

    vi.setSystemTime(new Date('2026-11-18T05:00:30Z')) // just past midnight
    await tick()
    await tick()
    const boards = sent.filter((m) => m.channelId === BOARD)
    expect(boards).toHaveLength(1)
    const [today, allTime] = boards[0].embeds!
    expect(today.title).toBe('🏆 Top earners — Tuesday, Nov 17')
    expect(today.description).toBe('🥇 Ziad — **$500**')
    expect(allTime.description).toBe('🥇 Ziad — **$500**  *(+$500 today)*')
  })

  it('leaves people who left the server off the board', async () => {
    const { client, tick } = start(readsFiveHundred)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-17T15:00:00Z'))
    await tick()
    for (const [id, who] of [['m1', 'ziad'], ['m2', 'sam']]) {
      const { payout, card } = await postAndWait(client, id, who)
      const { interaction, calls } = button(`payout:approve:${payout.id}`, { card })
      client.emit(Events.InteractionCreate, interaction as never)
      await vi.waitFor(() => expect(calls.editReply).toHaveLength(1))
    }
    members.delete('sam')
    vi.setSystemTime(new Date('2026-11-18T05:01:00Z'))
    await tick()
    const [today] = sent.filter((m) => m.channelId === BOARD)[0].embeds!
    expect(today.description).toBe('🥇 Ziad — **$500**')
  })
})
