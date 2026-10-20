// @vitest-environment node
// A clip trimmed without re-encoding keeps hidden lead-in frames before its
// start (fixtures/trimmed.mov: cut at 1.5 s of a clip with a key frame every
// second, so half a second of them). The picture starts at 0, never in them.
import { readFileSync } from 'node:fs'

import { ALL_FORMATS, BufferSource, Input } from 'mediabunny'
import { describe, expect, it } from 'vitest'

import { firstShown } from './clipParts'

describe('where a trimmed clip starts', () => {
  it('starts at 0, not in the hidden frames before the cut', async () => {
    const bytes = readFileSync(new URL('./fixtures/trimmed.mov', import.meta.url))
    const input = new Input({ source: new BufferSource(bytes), formats: ALL_FORMATS })
    const track = (await input.getPrimaryVideoTrack())!
    // What the file holds: frames from half a second before the start.
    expect(await track.getFirstTimestamp()).toBeCloseTo(-0.5)
    expect(await firstShown(track)).toBe(0)
  })

  it('keeps a start after 0 as it is', async () => {
    expect(await firstShown({ getFirstTimestamp: async () => 0.25 })).toBe(0.25)
  })
})
