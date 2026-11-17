import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import { z } from 'zod'
import { toCents } from './money.ts'

/** What the bot believes a screenshot shows. A mod confirms it before it counts. */
export interface Reading {
  /** The amount in cents, in `currency`. Null when no amount could be read. */
  cents: number | null
  /** ISO code such as "USD". Null when no amount could be read. */
  currency: string | null
  /** One line for the mod: what the screenshot shows. */
  note: string
}

export interface Screenshot {
  data: string // base64
  mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
}

export type ReadPayout = (images: Screenshot[], studentText: string) => Promise<Reading>

const PayoutSchema = z.object({
  is_payout: z.boolean(),
  amount: z.number().nullable(),
  currency: z.string().nullable(),
  description: z.string(),
})
export type RawReading = z.infer<typeof PayoutSchema>

const SYSTEM = `You check screenshots that students in a coaching community post as proof of money they were paid: brand deals, UGC platforms, TikTok or YouTube creator payouts, PayPal, Stripe, Whop, bank transfers, paid invoices and similar.

Report how much money the student received in the screenshots.
- If one screenshot shows several separate payments, add them up. If several screenshots show the same payment, count it once.
- Count money received. Do not count views, followers, pending or estimated earnings, or prices of things they bought.
- If the only figure is an account balance or a lifetime total, report it, and say in the description that it is a balance or lifetime total so a moderator can judge.
- amount is the number in the currency shown, without symbols or thousands separators (1250.5, not "$1,250.50"). currency is the ISO 4217 code (USD, EUR, GBP, CAD...). A bare "$" means USD unless the screenshot clearly shows another dollar.
- If there is no payment in the screenshots, set is_payout to false and amount and currency to null.
- description is one short line a moderator can check against the image, for example "PayPal: $500.00 received from Glow Skincare on Nov 12".`

/** Turns the model's answer into a Reading. Kept apart so it can be tested. */
export function toReading(raw: RawReading): Reading {
  const description = raw.description.trim().slice(0, 300)
  if (!raw.is_payout || raw.amount === null) {
    return { cents: null, currency: null, note: description || 'No payout found in the screenshot.' }
  }
  const cents = toCents(raw.amount)
  if (cents === null) return { cents: null, currency: null, note: description }
  const currency = (raw.currency ?? 'USD').trim().toUpperCase().slice(0, 3) || 'USD'
  return { cents, currency, note: description }
}

export function makeReader(client: Anthropic, model: string): ReadPayout {
  return async (images, studentText) => {
    const content: Anthropic.Beta.BetaContentBlockParam[] = images.map((image) => ({
      type: 'image',
      source: { type: 'base64', media_type: image.mediaType, data: image.data },
    }))
    const said = studentText.trim()
    content.push({
      type: 'text',
      text: said ? `The student wrote with the screenshots: "${said.slice(0, 500)}"` : 'The student posted the screenshots without any text.',
    })

    const response = await client.beta.messages.parse({
      model,
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM,
      output_config: { effort: 'low', format: betaZodOutputFormat(PayoutSchema) },
      messages: [{ role: 'user', content }],
    })

    if (response.stop_reason === 'refusal' || !response.parsed_output) {
      return { cents: null, currency: null, note: 'The bot could not read this screenshot - check it by eye.' }
    }
    return toReading(response.parsed_output)
  }
}
