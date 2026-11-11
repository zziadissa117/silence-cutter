import { describe, expect, it } from 'vitest'

import { liftMusic, soloMusicGain } from './montageRender'
import { MusicBed, trackLoudness } from './music'
import { noSpeechIn, songForReaction } from './noTalk'

const RATE = 8000

/** A tone `seconds` long at `amplitude`, as stereo. */
const tone = (seconds: number, amplitude: number) => {
  const plane = new Float32Array(seconds * RATE)
  for (let i = 0; i < plane.length; i++) plane[i] = amplitude * Math.sin((2 * Math.PI * 440 * i) / RATE)
  return [plane, plane.slice()]
}

describe('a reaction (no talking): the music is its only sound', () => {
  it('is told apart from a talking video by what is heard', () => {
    expect(noSpeechIn([{ text: 'you' }])).toBe(true)
    expect(noSpeechIn('so here is what I learned today'.split(' ').map((text) => ({ text })))).toBe(false)
  })

  it('plays a quiet song and a loud song at the same normal level, the whole video long', () => {
    for (const amplitude of [0.03, 0.6]) {
      const song = tone(4, amplitude)
      const lift = soloMusicGain(trackLoudness(song, RATE))
      liftMusic(song, lift, RATE)
      // A 10-second reaction over a 4-second song: muted clip (silence),
      // the song in it, starting again so it never stops.
      const video = [new Float32Array(10 * RATE), new Float32Array(10 * RATE)]
      new MusicBed(song, RATE, video[0].length, 1, Infinity, true).mixInto(video, 0)
      const middle = video.map((p) => p.subarray(1 * RATE, 8 * RATE))
      expect(trackLoudness(middle, RATE)).toBeGreaterThan(-16)
      expect(trackLoudness(middle, RATE)).toBeLessThan(-12)
      // Still playing near the end, after the song started over.
      expect(Math.max(...video[0].subarray(8 * RATE, 8.2 * RATE))).toBeGreaterThan(0.05)
      // Never past full scale.
      expect(Math.max(...video[0].map(Math.abs))).toBeLessThanOrEqual(1)
    }
  })

  it('gets a song from his music bank when none was picked - the same one for the same video', () => {
    const songs = [
      { id: 'a', name: 'Song A' },
      { id: 'b', name: 'Whoosh', sfx: true as const },
      { id: 'c', name: 'Song C' },
    ]
    const first = songForReaction(songs, 'job-1')
    expect(first?.sfx).toBeUndefined()
    expect(songForReaction(songs, 'job-1')).toBe(first)
    expect(songForReaction([{ id: 'b', sfx: true as const }], 'job-1')).toBeNull()
    expect(songForReaction([], 'job-1')).toBeNull()
  })
})
