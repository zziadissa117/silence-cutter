import {
  Client,
  Events,
  GatewayIntentBits,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type APIEmbed,
  type Attachment,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Guild,
  type GuildMember,
  type Interaction,
  type Message,
  type MessageMentionOptions,
  type ModalSubmitInteraction,
  type SendableChannels,
} from 'discord.js'
import { BOARD_SIZE, leaderboardEmbeds, type NamedRow } from './board.ts'
import {
  AMOUNT_FIELD,
  AMOUNT_MODAL,
  APPROVE,
  EDIT,
  REJECT,
  amountModal,
  decidedCard,
  parseCustomId,
  pendingCard,
  quickApproveCents,
} from './card.ts'
import type { Config } from './config.ts'
import {
  addApproved,
  advanceDay,
  allTimeBoard,
  approve,
  claimMessage,
  dayBoard,
  getPayout,
  hasHistory,
  initState,
  markPending,
  reject,
  setReply,
  setState,
  totalFor,
  type Db,
  type Payout,
} from './db.ts'
import { dayIn, previousDay } from './day.ts'
import { formatDollars, formatExact, parseAmount } from './money.ts'
import { buildNickname, stripTotal, totalInName } from './nickname.ts'
import type { ReadPayout, Reading, Screenshot } from './reader.ts'

const LAST_BOARD_DAY = 'last_board_day'
const FIRST_RUN_AT = 'first_run_at'
const CATCH_UP_MS = 3 * 24 * 60 * 60 * 1000
const TICK_MS = 60 * 1000
const MAX_IMAGES = 5
// Claude takes images up to 5 MB once base64-encoded, which is about 3.7 MB of file.
const MAX_IMAGE_BYTES = 3_700_000
const SUPPORTED_IMAGES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
const EPHEMERAL = MessageFlags.Ephemeral
const NO_PINGS: MessageMentionOptions = { parse: [] }

const UNREADABLE: Reading = {
  cents: null,
  currency: null,
  note: 'The bot could not read this screenshot - check it by eye.',
}

export interface BotDeps {
  config: Config
  db: Db
  /** Null when no Anthropic key is set: mods then type every amount themselves. */
  readPayout: ReadPayout | null
}

export const commands = [
  new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription("See today's top earners and the all-time leaderboard")
    .setContexts(InteractionContextType.Guild),
  new SlashCommandBuilder()
    .setName('payouts')
    .setDescription('Manage payout totals (mods only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription("Add a payout to a student's total - it counts for today's leaderboard")
        .addUserOption((o) => o.setName('student').setDescription('Who got paid').setRequired(true))
        .addStringOption((o) =>
          o.setName('amount').setDescription('Amount in US dollars, e.g. 500').setRequired(true).setMaxLength(20),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('set')
        .setDescription("Correct a student's all-time total - it does not count for today")
        .addUserOption((o) => o.setName('student').setDescription('Whose total to fix').setRequired(true))
        .addStringOption((o) =>
          o
            .setName('total')
            .setDescription('Their correct all-time total in US dollars, e.g. 1250')
            .setRequired(true)
            .setMaxLength(20),
        ),
    )
    .addSubcommand((s) =>
      s.setName('import').setDescription('Start totals from amounts already in nicknames, like "Name | $300"'),
    )
    .addSubcommand((s) => s.setName('post').setDescription('Post the leaderboard so far in the leaderboard channel now')),
]

export function createBot({ config, db, readPayout }: BotDeps): { client: Client; tick: () => Promise<void> } {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent, // to see the screenshots attached to messages
      GatewayIntentBits.GuildMembers, // to rename students and keep names honest
    ],
  })

  // ---------- helpers ----------

  const guild = (): Promise<Guild> => client.guilds.fetch(config.guildId)

  async function sendable(channelId: string): Promise<SendableChannels> {
    const channel = await client.channels.fetch(channelId)
    if (!channel?.isSendable()) throw new Error(`Channel ${channelId} is not a channel the bot can post in.`)
    return channel
  }

  function isMod(i: ButtonInteraction | ModalSubmitInteraction | ChatInputCommandInteraction): boolean {
    const perms = i.memberPermissions
    if (perms?.has(PermissionFlagsBits.ManageGuild) || perms?.has(PermissionFlagsBits.ManageNicknames)) return true
    const roles = i.member?.roles
    if (!config.modRoleId || !roles) return false
    return Array.isArray(roles) ? roles.includes(config.modRoleId) : roles.cache.has(config.modRoleId)
  }

  /** The name a student goes by, without any money tag. */
  function plainName(member: GuildMember): string {
    return stripTotal(member.displayName) || member.user.username
  }

  /**
   * Puts the true total on the end of a student's name. Returns '' when the name
   * is right, or one line saying why it could not be changed.
   */
  async function syncNickname(member: GuildMember, totalCents: number): Promise<string> {
    const wanted = buildNickname(member.nickname ?? member.user.globalName ?? member.user.username, totalCents)
    if (member.displayName === wanted) return ''
    if (member.id === member.guild.ownerId) {
      return "Discord doesn't let bots rename the server owner, so this name wasn't changed."
    }
    if (!member.manageable) {
      return "Their role is above the bot's, so their name wasn't changed - drag the bot's role higher in Server Settings → Roles."
    }
    try {
      await member.setNickname(wanted, 'Payout total')
      return ''
    } catch (err) {
      console.error(`Could not rename ${member.id}:`, err)
      return "The bot couldn't change their name - check it has the Manage Nicknames permission."
    }
  }

  async function syncById(userId: string, totalCents: number): Promise<string> {
    const member = await (await guild()).members.fetch(userId).catch(() => null)
    if (!member) return "They're not in the server, so their name wasn't changed."
    return syncNickname(member, totalCents)
  }

  // ---------- reading screenshots ----------

  function screenshotsIn(message: Message): Attachment[] {
    return [...message.attachments.values()]
      .filter((a) => a.contentType?.startsWith('image/') || /\.(png|jpe?g|gif|webp|heic|heif)$/i.test(a.name))
      .slice(0, MAX_IMAGES)
  }

  /** Downloads an image in a form Claude takes, shrinking or converting it through Discord if needed. */
  async function download(attachment: Attachment): Promise<Screenshot | null> {
    const type = attachment.contentType?.split(';')[0] ?? ''
    let url = attachment.url
    if (!SUPPORTED_IMAGES.has(type) || attachment.size > MAX_IMAGE_BYTES) {
      if (!attachment.width || !attachment.height) return null
      const scale = Math.min(1, 2000 / Math.max(attachment.width, attachment.height))
      const proxied = new URL(attachment.proxyURL)
      proxied.searchParams.set('format', 'webp')
      proxied.searchParams.set('width', String(Math.round(attachment.width * scale)))
      proxied.searchParams.set('height', String(Math.round(attachment.height * scale)))
      url = proxied.toString()
    }
    const response = await fetch(url)
    if (!response.ok) return null
    const mediaType = response.headers.get('content-type')?.split(';')[0] ?? type
    const bytes = Buffer.from(await response.arrayBuffer())
    if (!SUPPORTED_IMAGES.has(mediaType) || bytes.length > MAX_IMAGE_BYTES) return null
    return { data: bytes.toString('base64'), mediaType: mediaType as Screenshot['mediaType'] }
  }

  async function read(message: Message, attachments: Attachment[]): Promise<Reading> {
    if (!readPayout) return { ...UNREADABLE, note: 'Automatic reading is off - check the screenshot by eye.' }
    try {
      const images = (await Promise.all(attachments.map(download))).filter((s): s is Screenshot => s !== null)
      if (!images.length) return { ...UNREADABLE, note: "The bot can't open this image type - check it by eye." }
      return await readPayout(images, message.content)
    } catch (err) {
      console.error(`Reading screenshot ${message.id} failed:`, err)
      return UNREADABLE
    }
  }

  // ---------- a student posts a screenshot ----------

  async function handlePayoutMessage(message: Message<true>): Promise<void> {
    const attachments = screenshotsIn(message)
    if (!attachments.length) return
    const id = await claimMessage(db, {
      guildId: message.guildId,
      userId: message.author.id,
      messageId: message.id,
      channelId: message.channelId,
    })
    if (id === null) return // already handled
    await message.react('👀').catch(() => {})

    const reading = await read(message, attachments)
    const draft = { id, readCents: reading.cents, readCurrency: reading.currency, readNote: reading.note }
    const total = await totalFor(db, message.guildId, message.author.id)
    const member = message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null))
    const card = pendingCard(draft, {
      studentId: message.author.id,
      studentName: member ? plainName(member) : message.author.username,
      messageUrl: message.url,
      imageUrl: attachments[0].url,
      currentTotalCents: total,
    })

    const cardInPayoutChannel = config.approvalChannelId === message.channelId
    const cardMessage = cardInPayoutChannel
      ? await message.reply({ ...card, allowedMentions: { ...NO_PINGS, repliedUser: false } })
      : await (await sendable(config.approvalChannelId)).send({ ...card, allowedMentions: NO_PINGS })
    await markPending(db, id, {
      readCents: reading.cents,
      readCurrency: reading.currency,
      readNote: reading.note,
      cardChannelId: cardMessage.channelId,
      cardMessageId: cardMessage.id,
    })

    if (!cardInPayoutChannel) {
      const quick = quickApproveCents(draft)
      const ack =
        quick === null
          ? '👀 Got it — a mod will check your screenshot and add it to your total shortly.'
          : `👀 Got it — I read **${formatExact(quick)}**. A mod will confirm it shortly.`
      const reply = await message.reply({ content: ack, allowedMentions: { ...NO_PINGS, repliedUser: false } })
      await setReply(db, id, reply.id)
    }
  }

  /** Marks the student's own message, and edits the bot's reply to it. */
  async function tellStudent(p: Payout, totalCents: number): Promise<void> {
    if (!p.channelId || !p.messageId) return
    try {
      const channel = await client.channels.fetch(p.channelId)
      if (!channel?.isTextBased()) return
      const message = await channel.messages.fetch(p.messageId)
      await message.reactions.cache.get('👀')?.users.remove(client.user!.id).catch(() => {})
      await message.react(p.status === 'approved' ? '✅' : '❌').catch(() => {})
      if (p.replyMessageId) {
        const reply = await channel.messages.fetch(p.replyMessageId)
        await reply.edit(
          p.status === 'approved' && p.amountCents !== null
            ? `✅ **+${formatExact(p.amountCents)}** added — you're now at **${formatDollars(totalCents)}**!`
            : "❌ This screenshot wasn't counted. Ask a mod if you think that's a mistake.",
        )
      }
    } catch (err) {
      console.error(`Could not update the student's message for payout #${p.id}:`, err)
    }
  }

  // ---------- a mod decides ----------

  async function decide(
    i: ButtonInteraction | ModalSubmitInteraction,
    id: number,
    cents: number | null,
    previous: APIEmbed | undefined,
  ): Promise<void> {
    await i.deferUpdate()
    const decided = cents === null ? await reject(db, id, i.user.id) : await approve(db, id, cents, i.user.id)
    if (!decided) {
      await i.followUp({ content: 'Another mod already handled this one.', flags: EPHEMERAL })
      return
    }
    const total = await totalFor(db, decided.guildId, decided.userId)
    const problem = decided.status === 'approved' ? await syncById(decided.userId, total) : ''
    const card = decidedCard(previous, decided, total)
    if (problem) card.embeds[0].description += `\n⚠️ ${problem}`
    await i.editReply(card)
    await tellStudent(decided, total)
  }

  async function onButton(i: ButtonInteraction): Promise<void> {
    const parsed = parseCustomId(i.customId)
    if (!parsed || ![APPROVE, EDIT, REJECT].includes(parsed.action)) return
    if (!isMod(i)) {
      await i.reply({ content: 'Only mods can approve payouts.', flags: EPHEMERAL })
      return
    }
    const payout = await getPayout(db, parsed.id)
    if (!payout || payout.status !== 'pending') {
      await i.reply({ content: 'This payout was already handled.', flags: EPHEMERAL })
      return
    }
    const quick = quickApproveCents(payout)
    if (parsed.action === EDIT || (parsed.action === APPROVE && quick === null)) {
      await i.showModal(amountModal(payout))
      return
    }
    await decide(i, payout.id, parsed.action === REJECT ? null : quick, i.message.embeds[0]?.toJSON())
  }

  async function onModal(i: ModalSubmitInteraction): Promise<void> {
    const parsed = parseCustomId(i.customId)
    if (!parsed || parsed.action !== AMOUNT_MODAL || !i.isFromMessage()) return
    if (!isMod(i)) {
      await i.reply({ content: 'Only mods can approve payouts.', flags: EPHEMERAL })
      return
    }
    const typed = i.fields.getTextInputValue(AMOUNT_FIELD)
    const cents = parseAmount(typed)
    if (cents === null) {
      await i.reply({
        content: `"${typed}" isn't an amount. Type dollars like 500 or 1250.50, then press Change amount again.`,
        flags: EPHEMERAL,
      })
      return
    }
    await decide(i, parsed.id, cents, i.message.embeds[0]?.toJSON())
  }

  // ---------- leaderboards ----------

  /** Names of the given students who are still in the server. */
  async function namesFor(ids: string[]): Promise<Map<string, string>> {
    const names = new Map<string, string>()
    if (!ids.length) return names
    const members = await (await guild()).members.fetch({ user: ids })
    for (const member of members.values()) names.set(member.id, plainName(member))
    return names
  }

  async function boardFor(day: string, final: boolean): Promise<APIEmbed[]> {
    // Fetch extra rows so people who left the server can be skipped.
    const [todayRows, allRows] = await Promise.all([
      dayBoard(db, config.guildId, day, config.timeZone, 100),
      allTimeBoard(db, config.guildId, BOARD_SIZE + 20),
    ])
    const names = await namesFor([...new Set([...todayRows, ...allRows].map((r) => r.userId))])
    const madeToday = new Map(todayRows.map((r) => [r.userId, r.cents]))
    const named = (rows: typeof todayRows, withToday: boolean): NamedRow[] =>
      rows
        .filter((r) => names.has(r.userId))
        .slice(0, BOARD_SIZE)
        .map((r) => ({
          name: names.get(r.userId)!,
          cents: r.cents,
          todayCents: withToday ? madeToday.get(r.userId) : undefined,
        }))
    return leaderboardEmbeds(day, named(todayRows, false), named(allRows, true), final)
  }

  async function postBoard(day: string, final: boolean): Promise<void> {
    const channel = await sendable(config.leaderboardChannelId)
    await channel.send({ embeds: await boardFor(day, final), allowedMentions: NO_PINGS })
  }

  /** Runs every minute; posts the finished day's leaderboard once the day rolls over. */
  async function tick(): Promise<void> {
    const yesterday = previousDay(dayIn(new Date(), config.timeZone))
    // On the very first run, start counting from today rather than posting an empty yesterday.
    const lastPosted = await initState(db, LAST_BOARD_DAY, yesterday)
    if (lastPosted >= yesterday) return
    if (!(await advanceDay(db, LAST_BOARD_DAY, yesterday))) return // another copy of the bot got it
    try {
      await postBoard(yesterday, true)
      console.log(`Posted the leaderboard for ${yesterday}.`)
    } catch (err) {
      console.error(`Posting the leaderboard for ${yesterday} failed; will retry:`, err)
      await setState(db, LAST_BOARD_DAY, lastPosted)
    }
  }

  // ---------- slash commands ----------

  async function onCommand(i: ChatInputCommandInteraction): Promise<void> {
    if (i.commandName === 'leaderboard') {
      await i.deferReply({ flags: EPHEMERAL })
      await i.editReply({ embeds: await boardFor(dayIn(new Date(), config.timeZone), false) })
      return
    }
    if (i.commandName !== 'payouts') return
    if (!isMod(i)) {
      await i.reply({ content: 'Only mods can change payout totals.', flags: EPHEMERAL })
      return
    }

    const sub = i.options.getSubcommand()
    if (sub === 'add' || sub === 'set') {
      const student = i.options.getUser('student', true)
      const typed = i.options.getString(sub === 'add' ? 'amount' : 'total', true)
      const cents = sub === 'set' && /^\$?\s*0+(\.0+)?$/.test(typed.trim()) ? 0 : parseAmount(typed)
      if (cents === null) {
        await i.reply({ content: `"${typed}" isn't an amount. Type dollars like 500 or 1250.50.`, flags: EPHEMERAL })
        return
      }
      await i.deferReply({ flags: EPHEMERAL })
      let message: string
      if (sub === 'add') {
        await addApproved(db, { guildId: config.guildId, userId: student.id, cents, kind: 'payout', by: i.user.id })
        message = `Added **${formatExact(cents)}** for <@${student.id}>.`
      } else {
        const before = await totalFor(db, config.guildId, student.id)
        if (cents !== before) {
          await addApproved(db, {
            guildId: config.guildId,
            userId: student.id,
            cents: cents - before,
            kind: 'adjustment',
            by: i.user.id,
            note: `Total set from ${formatExact(before)} to ${formatExact(cents)}`,
          })
        }
        message = `<@${student.id}>'s total went from **${formatExact(before)}** to **${formatExact(cents)}**.`
      }
      const total = await totalFor(db, config.guildId, student.id)
      const problem = await syncById(student.id, total)
      await i.editReply({
        content: `${message} They're now at **${formatDollars(total)}**.${problem ? `\n⚠️ ${problem}` : ''}`,
        allowedMentions: NO_PINGS,
      })
      return
    }

    if (sub === 'import') {
      await i.deferReply({ flags: EPHEMERAL })
      const members = await (await guild()).members.fetch()
      const imported: string[] = []
      for (const member of members.values()) {
        if (member.user.bot) continue
        const cents = totalInName(member.displayName)
        if (cents === null || (await hasHistory(db, config.guildId, member.id))) continue
        await addApproved(db, {
          guildId: config.guildId,
          userId: member.id,
          cents,
          kind: 'adjustment',
          by: i.user.id,
          note: `Imported from nickname "${member.displayName}"`,
        })
        await syncNickname(member, cents)
        imported.push(`${plainName(member)} — ${formatDollars(cents)}`)
      }
      let reply = imported.length
        ? `Started ${imported.length} total${imported.length === 1 ? '' : 's'} from nicknames:\n${imported.join('\n')}`
        : 'No nicknames with a dollar amount (like "Name | $300") on members without a total yet.'
      if (reply.length > 1900) reply = `${reply.slice(0, 1900)}\n…`
      await i.editReply({ content: reply })
      return
    }

    if (sub === 'post') {
      await i.deferReply({ flags: EPHEMERAL })
      await postBoard(dayIn(new Date(), config.timeZone), false)
      await i.editReply({ content: `Posted in <#${config.leaderboardChannelId}>.` })
    }
  }

  // ---------- events ----------

  client.once(Events.ClientReady, async (ready) => {
    console.log(`Logged in as ${ready.user.tag}.`)
    try {
      const home = await guild()
      await home.commands.set(commands.map((c) => c.toJSON()))
      for (const [label, id] of [
        ['payout', config.payoutChannelId],
        ['approval', config.approvalChannelId],
        ['leaderboard', config.leaderboardChannelId],
      ]) {
        const channel = await client.channels.fetch(id).catch(() => null)
        if (!channel?.isSendable()) console.error(`The ${label} channel (${id}) was not found, or the bot can't post there.`)
      }

      // Catch screenshots posted while the bot was offline (never ones from before its first start).
      const firstRun = Number(await initState(db, FIRST_RUN_AT, String(Date.now())))
      const since = Math.max(firstRun, Date.now() - CATCH_UP_MS)
      const payouts = await sendable(config.payoutChannelId)
      if (payouts.isTextBased() && 'messages' in payouts) {
        const recent = await payouts.messages.fetch({ limit: 50 })
        for (const message of [...recent.values()].reverse()) {
          if (message.author.bot || message.createdTimestamp < since || !message.inGuild()) continue
          await handlePayoutMessage(message).catch((err) => console.error('Catch-up failed:', err))
        }
      }
      console.log(`Watching for payouts. Leaderboard posts at midnight (${config.timeZone}).`)
    } catch (err) {
      console.error('Start-up failed:', err)
    }
    await tick().catch((err) => console.error('Leaderboard check failed:', err))
    setInterval(() => tick().catch((err) => console.error('Leaderboard check failed:', err)), TICK_MS)
  })

  client.on(Events.MessageCreate, (message) => {
    if (!message.inGuild() || message.author.bot) return
    if (message.guildId !== config.guildId || message.channelId !== config.payoutChannelId) return
    handlePayoutMessage(message).catch((err) => console.error(`Handling payout ${message.id} failed:`, err))
  })

  client.on(Events.InteractionCreate, async (i: Interaction) => {
    try {
      if (i.isChatInputCommand()) await onCommand(i)
      else if (i.isButton()) await onButton(i)
      else if (i.isModalSubmit()) await onModal(i)
    } catch (err) {
      console.error('Interaction failed:', err)
      if (i.isRepliable() && !i.replied && !i.deferred) {
        await i.reply({ content: 'Something went wrong — try again.', flags: EPHEMERAL }).catch(() => {})
      }
    }
  })

  // Keeps names honest: if anyone edits the money tag, the bot puts the real total back.
  client.on(Events.GuildMemberUpdate, async (before, after) => {
    if (after.guild.id !== config.guildId || after.user.bot || before.nickname === after.nickname) return
    try {
      await syncNickname(after, await totalFor(db, config.guildId, after.id))
    } catch (err) {
      console.error(`Checking ${after.id}'s nickname failed:`, err)
    }
  })

  // Someone who leaves and comes back gets their total back on their name.
  client.on(Events.GuildMemberAdd, async (member) => {
    if (member.guild.id !== config.guildId || member.user.bot) return
    try {
      const total = await totalFor(db, config.guildId, member.id)
      if (total > 0) await syncNickname(member, total)
    } catch (err) {
      console.error(`Restoring ${member.id}'s total failed:`, err)
    }
  })

  return { client, tick }
}
