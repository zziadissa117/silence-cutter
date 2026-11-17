import type Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it } from 'vitest'
import { makeReader, toReading } from './reader.ts'

describe('turning the answer into a reading', () => {
  it('reads a dollar payout', () => {
    expect(toReading({ is_payout: true, amount: 1250.5, currency: 'usd', description: 'PayPal $1,250.50' })).toEqual({
      cents: 125_050,
      currency: 'USD',
      note: 'PayPal $1,250.50',
    })
  })

  it('assumes dollars when no currency is given', () => {
    expect(toReading({ is_payout: true, amount: 500, currency: null, description: 'x' }).currency).toBe('USD')
  })

  it('keeps other currencies so a mod can convert them', () => {
    expect(toReading({ is_payout: true, amount: 450, currency: 'EUR', description: 'x' })).toMatchObject({
      cents: 45_000,
      currency: 'EUR',
    })
  })

  it('has no amount when the image is not a payout', () => {
    expect(toReading({ is_payout: false, amount: null, currency: null, description: 'A selfie' })).toEqual({
      cents: null,
      currency: null,
      note: 'A selfie',
    })
    expect(toReading({ is_payout: true, amount: 0, currency: 'USD', description: 'x' }).cents).toBeNull()
  })
})

function fakeClient(response: unknown) {
  const calls: Record<string, unknown>[] = []
  const client = {
    beta: {
      messages: {
        parse: async (params: Record<string, unknown>) => {
          calls.push(params)
          return response
        },
      },
    },
  } as unknown as Anthropic
  return { client, calls }
}

describe('asking Claude', () => {
  it('sends every screenshot and what the student wrote', async () => {
    const { client, calls } = fakeClient({
      stop_reason: 'end_turn',
      parsed_output: { is_payout: true, amount: 500, currency: 'USD', description: 'Stripe $500' },
    })
    const read = makeReader(client, 'claude-opus-5-5')
    const reading = await read(
      [
        { data: 'AAA', mediaType: 'image/png' },
        { data: 'BBB', mediaType: 'image/jpeg' },
      ],
      'just got paid!',
    )
    expect(reading).toEqual({ cents: 50_000, currency: 'USD', note: 'Stripe $500' })

    const [params] = calls
    expect(params.model).toBe('claude-opus-5-5')
    expect(params.fallbacks).toBe('default')
    expect(params.betas).toEqual(['server-side-fallback-2026-07-01'])
    const content = (params.messages as { content: { type: string; text?: string }[] }[])[0].content
    expect(content.map((b) => b.type)).toEqual(['image', 'image', 'text'])
    expect(content[2].text).toContain('just got paid!')
  })

  it('hands it to a mod when Claude declines', async () => {
    const { client } = fakeClient({ stop_reason: 'refusal', parsed_output: null })
    const reading = await makeReader(client, 'm')([{ data: 'A', mediaType: 'image/png' }], '')
    expect(reading.cents).toBeNull()
    expect(reading.note).toMatch(/check it by eye/)
  })
})
