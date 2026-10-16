import { describe, expect, it } from 'vitest'

import { cleanEngineUrl, sentKey, stillToSend } from './engine'

describe('the engine', () => {
  it('takes its address as pasted', () => {
    expect(cleanEngineUrl('cutter-engine.up.railway.app/')).toBe('https://cutter-engine.up.railway.app')
    expect(cleanEngineUrl(' https://x.up.railway.app/status ')).toBe('https://x.up.railway.app')
    expect(cleanEngineUrl('http://x.up.railway.app')).toBeNull()
    expect(cleanEngineUrl('')).toBeNull()
  })

  it('is sent only what it does not have', () => {
    const files = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    const sent = { [sentKey('hook', 'camp', 'a')]: 'a.mov', [sentKey('hook', 'camp', 'b')]: 'b.mov' }
    // b was taken off the engine since: sent again.
    expect(stillToSend(files, 'hook', 'camp', ['a.mov'], sent).map((f) => f.id)).toEqual(['b', 'c'])
    // Songs are shared by every campaign.
    expect(sentKey('song', 'camp', 's1')).toBe(sentKey('song', 'other', 's1'))
  })
})
