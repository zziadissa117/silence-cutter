import { describe, expect, it } from 'vitest'

import { SERVER_FROM, popsSaid, talkFileId, toServer } from './talkOrder'

describe('talking videos on the Cutter server', () => {
  it('goes to the server from three videos at once, when it is up', () => {
    expect(SERVER_FROM).toBe(3)
    expect(toServer({ waiting: 2, onServer: 0, serverUp: true })).toBe(false)
    expect(toServer({ waiting: 3, onServer: 0, serverUp: true })).toBe(true)
    expect(toServer({ waiting: 5, onServer: 0, serverUp: false })).toBe(false)
    // More pasted while some are already there: they join them.
    expect(toServer({ waiting: 1, onServer: 2, serverUp: true })).toBe(true)
  })

  it('names files the way the server takes them', () => {
    expect(talkFileId('t', '1730000000000-3')).toBe('t-1730000000000-3')
    expect(talkFileId('ov', 'job 1', 'pic/2')).toBe('ov-job_1-pic_2')
    expect(talkFileId('clip', 'x'.repeat(200))).toHaveLength(80)
  })

  it('sends only the bank videos the video says the words of', () => {
    const videos = [
      { id: 'a', words: ['Claude'], seconds: 2, width: 1080, height: 1920 },
      { id: 'b', words: ['chat gpt'], seconds: 2, width: 1080, height: 1920 },
      { id: 'c', words: ['Gemini'], seconds: 2, width: 1080, height: 1920 },
    ]
    const said = popsSaid(videos, [{ text: 'I asked' }, { text: 'Claude,' }, { text: 'then' }, { text: 'Chat' }, { text: 'GPT' }])
    expect(said.map((v) => v.id)).toEqual(['a', 'b'])
  })
})

describe('how many the server does at once', async () => {
  const { atOnce } = await import('./serverTalk')
  it('from its memory: more on a bigger plan, never none', () => {
    expect(atOnce(8)).toEqual({ listen: 4, make: 2 })
    expect(atOnce(4)).toEqual({ listen: 1, make: 1 })
    expect(atOnce(2)).toEqual({ listen: 1, make: 1 })
    expect(atOnce(null)).toEqual({ listen: 4, make: 2 })
  })
})
