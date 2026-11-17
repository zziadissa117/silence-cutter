import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  LabelBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type APIEmbed,
} from 'discord.js'
import { formatDollars, formatExact } from './money.ts'
import type { Payout } from './db.ts'

// Custom ids carry the payout id, so a button still works after a restart.
export const APPROVE = 'payout:approve'
export const EDIT = 'payout:edit'
export const REJECT = 'payout:reject'
export const AMOUNT_MODAL = 'payout:amount'
export const AMOUNT_FIELD = 'amount'

export function parseCustomId(customId: string): { action: string; id: number } | null {
  const match = /^(payout:[a-z]+):(\d+)$/.exec(customId)
  return match ? { action: match[1], id: Number(match[2]) } : null
}

/** The amount the Approve button would count, or null if a mod must type one. */
export function quickApproveCents(p: Pick<Payout, 'readCents' | 'readCurrency'>): number | null {
  return p.readCents !== null && p.readCurrency === 'USD' ? p.readCents : null
}

function readLine(p: Pick<Payout, 'readCents' | 'readCurrency'>): string {
  if (p.readCents === null) return 'No amount found — use **Change amount** to enter it.'
  if (p.readCurrency !== 'USD') {
    const amount = (p.readCents / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })
    return `Read **${amount} ${p.readCurrency}** — not dollars, so use **Change amount** to enter the USD value.`
  }
  return `Read **${formatExact(p.readCents)}** from the screenshot.`
}

export interface CardContext {
  studentId: string
  studentName: string
  messageUrl: string
  imageUrl: string | null
  currentTotalCents: number
}

const BLURPLE = 0x5865f2
const GREEN = 0x2ecc71
const RED = 0xe74c3c

export function pendingCard(p: Pick<Payout, 'id' | 'readCents' | 'readCurrency' | 'readNote'>, c: CardContext) {
  const quick = quickApproveCents(p)
  const embed: APIEmbed = {
    author: { name: `Payout from ${c.studentName}` },
    description: [
      readLine(p),
      p.readNote ? `> ${p.readNote}` : null,
      '',
      `<@${c.studentId}> is at **${formatDollars(c.currentTotalCents)}** now.`,
      `[Open their message](${c.messageUrl})`,
    ]
      .filter((line) => line !== null)
      .join('\n'),
    color: BLURPLE,
    footer: { text: `Payout #${p.id} · waiting for a mod` },
  }
  if (c.imageUrl) embed.image = { url: c.imageUrl }

  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${APPROVE}:${p.id}`)
      .setStyle(ButtonStyle.Success)
      .setLabel(quick === null ? 'Approve' : `Approve ${formatExact(quick)}`)
      .setDisabled(quick === null),
    new ButtonBuilder().setCustomId(`${EDIT}:${p.id}`).setStyle(ButtonStyle.Secondary).setLabel('Change amount'),
    new ButtonBuilder().setCustomId(`${REJECT}:${p.id}`).setStyle(ButtonStyle.Danger).setLabel('Reject'),
  )
  return { embeds: [embed], components: [buttons] }
}

/** The card once a mod has decided. Buttons are removed so it cannot be pressed again. */
export function decidedCard(previous: APIEmbed | undefined, p: Payout, newTotalCents: number) {
  const base: APIEmbed = { ...(previous ?? {}) }
  if (p.status === 'approved' && p.amountCents !== null) {
    base.color = GREEN
    base.footer = {
      text: `Payout #${p.id} · approved +${formatExact(p.amountCents)} · total now ${formatDollars(newTotalCents)}`,
    }
    base.description = `✅ Approved by <@${p.decidedBy}>: **+${formatExact(p.amountCents)}** → <@${p.userId}> is now at **${formatDollars(newTotalCents)}**`
  } else {
    base.color = RED
    base.footer = { text: `Payout #${p.id} · rejected` }
    base.description = `❌ Rejected by <@${p.decidedBy}> — not counted.`
  }
  return { embeds: [base], components: [] }
}

export function amountModal(p: Pick<Payout, 'id' | 'readCents' | 'readCurrency'>) {
  const input = new TextInputBuilder()
    .setCustomId(AMOUNT_FIELD)
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('500')
    .setRequired(true)
    .setMaxLength(20)
  if (p.readCents !== null && p.readCurrency === 'USD') input.setValue((p.readCents / 100).toFixed(2).replace(/\.00$/, ''))
  return new ModalBuilder()
    .setCustomId(`${AMOUNT_MODAL}:${p.id}`)
    .setTitle('Approve payout')
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Amount in US dollars')
        .setDescription('This is what gets added to their total.')
        .setTextInputComponent(input),
    )
}
