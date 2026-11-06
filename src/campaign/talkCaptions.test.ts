import { beforeEach, describe, expect, it, vi } from 'vitest'

const heard = vi.fn(async () => ({
  duration: 6,
  keep: [{ start: 0, end: 6 }],
  words: [
    { text: 'this', start: 0.5, end: 0.8 },
    { text: 'app', start: 0.9, end: 1.3 },
  ],
  aligned: true,
}))
vi.mock('./pipeline', () => ({ listen: (...args: unknown[]) => heard(...(args as [])) }))

import { keptWords, talkWords } from './talkCaptions'

const clip = { id: 'c1', name: 'talk.mov', type: 'video/quicktime', size: 1, fp: 'fp-talk' }
const settings = {} as never

describe("a talking clip's captions", () => {
  beforeEach(() => {
    localStorage.clear()
    heard.mockClear()
  })

  it('are heard once - the whole clip, never cut - and kept for every later video from it', async () => {
    const first = await talkWords(clip, new Blob(), { settings, names: [] })
    expect(first.map((w) => w.text)).toEqual(['this', 'app'])
    expect(heard).toHaveBeenCalledTimes(1)
    expect((heard.mock.calls[0] as unknown[])[2]).toMatchObject({ keepWhole: true, cleanSpeech: false, align: true })
    // The same take, added again under another id: not heard again.
    await talkWords({ ...clip, id: 'c2' }, new Blob(), { settings, names: [] })
    expect(heard).toHaveBeenCalledTimes(1)
    expect(keptWords(clip)?.length).toBe(2)
  })
})
