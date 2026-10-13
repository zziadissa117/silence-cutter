import { beforeEach, describe, expect, it, vi } from 'vitest'

const meta = new Map<string, string>()
const files = new Map<string, Blob>()

vi.mock('./store', () => ({
  getMeta: vi.fn(async (key: string) => meta.get(key) ?? null),
  setMeta: vi.fn(async (key: string, value: string | null) => {
    if (value === null) meta.delete(key)
    else meta.set(key, value)
  }),
  saveBankFile: vi.fn(async (id: string, file: Blob) => {
    files.set(id, file)
  }),
  loadBankFile: vi.fn(async (file: { id: string; name: string; type: string }) => {
    const blob = files.get(file.id)
    return blob ? new File([blob], file.name, { type: file.type }) : null
  }),
  deleteBankFile: vi.fn(async (id: string) => {
    files.delete(id)
  }),
}))

vi.mock('./fingerprint', () => ({ fingerprint: vi.fn(async (file: Blob) => `fp-${await file.text()}`) }))

import { addSongs, copySong, isVideoFile, loadMusicBank, removeSong, renameSong, songFile, songName } from './musicBank'

const song = (name: string, body = name, type = 'audio/mpeg') => new File([body], name, { type })

beforeEach(() => {
  meta.clear()
  files.clear()
})

describe('the music bank', () => {
  it('names a song after its file, without the ending', () => {
    expect(songName('Sad piano.mp3')).toBe('Sad piano')
    expect(songName('random text.mp4')).toBe('random text')
    expect(songName('.mp3')).toBe('Song')
  })

  it('knows a video from a song', () => {
    expect(isVideoFile(song('a.mp4', 'x', 'video/mp4'))).toBe(true)
    expect(isVideoFile(song('a.MOV', 'x', ''))).toBe(true)
    expect(isVideoFile(song('a.mp3'))).toBe(false)
  })

  it('keeps songs once each, with their names', async () => {
    const first = await addSongs([song('Sad piano.mp3', 'piano'), song('Hype.m4a', 'hype', 'audio/mp4')])
    expect(first.added.map((s) => s.name)).toEqual(['Sad piano', 'Hype'])
    const again = await addSongs([song('piano copy.mp3', 'piano')])
    expect(again.added).toEqual([])
    expect(again.skipped).toEqual(['piano copy.mp3'])
    expect((await loadMusicBank()).map((s) => s.name)).toEqual(['Sad piano', 'Hype'])
  })

  it('renames, plays back under its name, and takes a song out', async () => {
    const { added } = await addSongs([song('IMG_0042.m4a', 'beat', 'audio/mp4')])
    await renameSong(added[0].id, 'Late night beat')
    const [renamed] = await loadMusicBank()
    expect(renamed.name).toBe('Late night beat')
    expect((await songFile(renamed))?.name).toBe('Late night beat')
    await removeSong(renamed.id)
    expect(await loadMusicBank()).toEqual([])
    expect(files.size).toBe(0)
  })

  it('gives the Batch tab its own copy, so taking it out there leaves the bank alone', async () => {
    const { added } = await addSongs([song('Sad piano.mp3', 'piano')])
    const copy = await copySong(added[0])
    expect(copy.id).not.toBe(added[0].id)
    expect(copy.name).toBe('Sad piano')
    expect(files.has(added[0].id) && files.has(copy.id)).toBe(true)
  })

  it('says which songs it could not keep', async () => {
    const big = song('huge.wav')
    Object.defineProperty(big, 'size', { value: 31e6 })
    const { added, failed } = await addSongs([big])
    expect(added).toEqual([])
    expect(failed[0]).toMatch(/^huge\.wav \(over 30 MB/)
  })
})
