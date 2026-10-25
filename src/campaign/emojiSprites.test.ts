// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { checkPictures, drawLine, emojisIn, emojiSpritesFor, graphemes, measureLine, spriteId, useEmojiSprites, type EmojiSprite } from './emojiSprites'

const sprite = (text: string, over: Partial<EmojiSprite> = {}): EmojiSprite => ({
  id: spriteId(text),
  name: `${spriteId(text)}.png`,
  type: 'image/png',
  size: 10,
  text,
  advance: 1.2,
  left: 0.05,
  top: -0.9,
  width: 1.1,
  height: 1.1,
  ...over,
})

/** A canvas that writes down what it is asked to draw; each letter 10 px wide. */
function fakeCtx() {
  const calls: string[] = []
  const ctx = {
    textAlign: 'center' as CanvasTextAlign,
    measureText: (s: string) => ({ width: [...s].length * 10 }),
    fillText: (s: string, x: number, y: number) => calls.push(`fill "${s}" ${x} ${y}`),
    strokeText: (s: string, x: number, y: number) => calls.push(`stroke "${s}" ${x} ${y}`),
    drawImage: (_i: unknown, x: number, y: number, w: number, h: number) => calls.push(`picture ${[x, y, w, h].map((n) => Math.round(n * 100) / 100).join(' ')}`),
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls }
}

afterEach(() => useEmojiSprites([]))

describe('the emoji of his headlines', () => {
  it('finds each different emoji once - skin tones, flags and keycaps whole, letters like ™ left alone', () => {
    expect(graphemes('a👍🏽b')).toEqual(['a', '👍🏽', 'b'])
    expect(emojisIn(['POV: it works 😂🔥 👍🏽 ™', 'again 😂 1️⃣ 🇫🇷'])).toEqual(['😂', '🔥', '👍🏽', '1️⃣', '🇫🇷'])
    expect(emojisIn(['no emoji here, ™ © ®'])).toEqual([])
  })

  it('names each picture the same on every phone, in a name the server takes', () => {
    expect(spriteId('😂')).toBe('emoji-1f602')
    const long = spriteId('👩🏽‍❤️‍💋‍👨🏻')
    expect(long).toMatch(/^[A-Za-z0-9_-]{1,80}$/)
    expect(spriteId('👩🏽‍❤️‍💋‍👨🏻')).toBe(long)
  })

  it('draws a line as it always did when it has no picture', () => {
    const { ctx, calls } = fakeCtx()
    drawLine(ctx, 'hi 😂', 500, 300, 100)
    expect(calls).toEqual(['fill "hi 😂" 500 300'])
    expect(measureLine(ctx, 'hi 😂', 100)).toBe(40)
  })

  it('puts each picture where its emoji goes, at its own advance, the words around it; an outline goes round the words only', () => {
    useEmojiSprites([{ sprite: sprite('😂'), image: {} as CanvasImageSource }])
    const { ctx, calls } = fakeCtx()
    // "hi " 30 + the emoji 1.2 x 100 + " yo" 30.
    expect(measureLine(ctx, 'hi 😂 yo', 100)).toBe(180)
    drawLine(ctx, 'hi 😂 yo', 500, 300, 100)
    expect(calls).toEqual(['fill "hi " 410 300', 'picture 445 210 110 110', 'fill " yo" 560 300'])
    expect(ctx.textAlign).toBe('center')
    calls.length = 0
    drawLine(ctx, 'hi 😂 yo', 500, 300, 100, 'stroke')
    expect(calls).toEqual(['stroke "hi " 410 300', 'stroke " yo" 560 300'])
  })

  it('draws the new emoji once and keeps them; nothing again for ones it has', async () => {
    const draw = vi.fn(async () => ({ blob: new Blob(['png']), advance: 1.25, left: 0.02, top: -0.95, width: 1.2, height: 1.2 }))
    const keep = vi.fn(async () => {})
    const made = await emojiSpritesFor({ headlines: ['wait 😂', 'POV 🔥😂'], steps: [{ name: 'the app 🚀' }] }, keep, draw)
    expect(made?.map((s) => s.text)).toEqual(['😂', '🔥', '🚀'])
    expect(keep.mock.calls.map((c) => (c as unknown[])[0])).toEqual(['emoji-1f602', 'emoji-1f525', 'emoji-1f680'])
    expect(made?.[0]).toMatchObject({ id: 'emoji-1f602', type: 'image/png', advance: 1.25, top: -0.95 })
    expect(await emojiSpritesFor({ headlines: ['wait 😂'], emojis: made! }, keep, draw)).toBeNull()
    expect(await emojiSpritesFor({ headlines: ['no emoji'] }, keep, draw)).toBeNull()
    expect(draw).toHaveBeenCalledTimes(3)
  })
})

describe('never Google emoji in a video again', () => {
  it('the server says when it would draw an emoji with no picture from the phone, once each', () => {
    expect(checkPictures('wait 😂 🔥', true)).toEqual(['😂', '🔥'])
    expect(checkPictures('again 😂', true)).toEqual([])
    useEmojiSprites([{ sprite: sprite('🚀'), image: {} as CanvasImageSource }])
    expect(checkPictures('go 🚀', true)).toEqual([])
    // A phone draws its own: nothing to say.
    expect(checkPictures('wait 🎉', false)).toEqual([])
  })

  it("every headline line is drawn through drawLine, so the phone's pictures are always used", () => {
    const source = readFileSync(path.join(__dirname, 'overlay.ts'), 'utf8')
    // Only inkOf's own scratch canvas (c.) draws text directly.
    expect(source.match(/\bctx\.(fillText|strokeText)\(/g) ?? []).toEqual([])
  })
})
