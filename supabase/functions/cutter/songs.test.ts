import { describe, expect, it } from 'vitest'

import { MAX_SONG_BYTES, cleanSong, sameSong, songsFrom } from './songs'

const sha = (c: string) => c.repeat(64)
const song = { id: 's1', name: 'Sad piano', type: 'audio/mp4', size: 900_000, fp: 'fp-a', sha: sha('a'), addedAt: 5 }

describe('a song for the shared music bank', () => {
  it('keeps what a phone sent when it is a sound of a sensible size', () => {
    expect(cleanSong(song)).toEqual(song)
    expect(cleanSong({ ...song, addedAt: undefined }, 99)).toMatchObject({ addedAt: 99 })
  })

  it('turns away anything that is not a song', () => {
    expect(cleanSong({ ...song, type: 'video/mp4' })).toBeNull()
    expect(cleanSong({ ...song, size: MAX_SONG_BYTES + 1 })).toBeNull()
    expect(cleanSong({ ...song, sha: 'not-a-hash' })).toBeNull()
    expect(cleanSong({ ...song, id: '../other' })).toBeNull()
    expect(cleanSong({ ...song, name: '  ' })).toBeNull()
    expect(cleanSong(null)).toBeNull()
  })

  it('finds the same song already there - the same file, or the same recording', () => {
    const there = [song]
    expect(sameSong(there, { sha: sha('a') })).toBe(song)
    expect(sameSong(there, { sha: sha('b'), fp: 'fp-a' })).toBe(song)
    expect(sameSong(there, { sha: sha('b'), fp: 'fp-b' })).toBeNull()
  })

  it('reads the songs from their rows, oldest first, leaving out a bad one', () => {
    const later = { ...song, id: 's2', addedAt: 9 }
    expect(songsFrom([{ value: JSON.stringify(later) }, { value: 'nope' }, { value: JSON.stringify(song) }]).map((s) => s.id)).toEqual(['s1', 's2'])
  })
})
