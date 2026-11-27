import { describe, expect, it } from 'vitest'

import { MAX_SONG_BYTES, cleanSong, sameSong, shareRows, songsBySpace, songsFrom } from './songs'

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

describe('the owner\'s songs shared with every student (his ask, 2026-11-27)', () => {
  const song = (id: string, sha: string) => ({ id, name: id, type: 'audio/mp4', size: 1, sha, addedAt: 0 })
  const sha = (c: string) => c.repeat(64)
  it('adds the song to each login that has not got it, under its own prefix', () => {
    const rows = shareRows(song('new', sha('a')), [
      { id: 'stefan', songs: [song('his', sha('b'))] },
      { id: 'may', songs: [song('same', sha('a'))] },
    ])
    expect(rows.map((r) => r.key)).toEqual(['song@stefan:new'])
  })
  it('reads each login\'s songs from its rows', () => {
    const by = songsBySpace([
      { key: 'song@stefan:x', value: JSON.stringify(song('x', sha('c'))) },
      { key: 'song:owner', value: JSON.stringify(song('o', sha('d'))) },
    ])
    expect([...by.keys()]).toEqual(['stefan'])
  })
})
