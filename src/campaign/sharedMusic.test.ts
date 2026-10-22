// The music bank shared by everyone who uses the Cutter: this phone's songs
// go up, the others' come down (listed at once, their files when first
// used), renames and takings-out reach every phone.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const meta = new Map<string, string>()
const files = new Map<string, Blob>()
const asked: { action: string; body: Record<string, unknown> }[] = []
let server: { songs: Record<string, unknown>[] } = { songs: [] }

vi.mock('./store', () => ({
  getMeta: vi.fn(async (key: string) => meta.get(key) ?? null),
  setMeta: vi.fn(async (key: string, value: string | null) => void (value === null ? meta.delete(key) : meta.set(key, value))),
  saveBankFile: vi.fn(async (id: string, blob: Blob) => void files.set(id, blob)),
  loadBankFile: vi.fn(async (file: { id: string; name: string; type: string }) => {
    const blob = files.get(file.id)
    return blob ? new File([blob], file.name, { type: file.type }) : null
  }),
  deleteBankFile: vi.fn(async (id: string) => void files.delete(id)),
}))

vi.mock('./cloud', async (original) => ({
  ...(await original<typeof import('./cloud')>()),
  currentSession: () => ({ name: 'cutter', token: 't' }),
  askShared: vi.fn(async (action: string, body: Record<string, unknown> = {}) => {
    asked.push({ action, body })
    if (action === 'song-upload') return { url: `https://upload/${String(body.sha)}` }
    if (action === 'add-song') {
      const song = body.song as { fp?: string; sha: string }
      const same = server.songs.find((s) => s.fp === song.fp || s.sha === song.sha)
      if (same) return { song: same }
      server.songs.push({ ...song, addedAt: 1 })
      return { song: { ...song, addedAt: 1 } }
    }
    if (action === 'songs') return { songs: server.songs }
    if (action === 'song-urls') return { urls: Object.fromEntries((body.shas as string[]).map((sha) => [sha, `https://song/${sha}`])) }
    if (action === 'remove-song') {
      server.songs = server.songs.filter((s) => s.id !== body.id)
      return { removed: true }
    }
    if (action === 'rename-song') return { song: null }
    return null
  }),
}))

import { ensureSong, findSong, loadMusicBank, mergeSongs, removeSong, renameSong, syncSongs, type Song } from './musicBank'

async function sha256(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

const piano = new Blob(['piano sounds'], { type: 'audio/mp4' })
const beat = new Blob(['beat sounds'], { type: 'audio/mpeg' })

beforeEach(() => {
  meta.clear()
  files.clear()
  asked.length = 0
  server = { songs: [] }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.startsWith('https://upload/')) return new Response('{}', { status: 200 })
      const sha = url.split('/').pop()
      const blob = (await sha256(piano)) === sha ? piano : beat
      return new Response(await blob.text(), { status: 200 })
    }),
  )
})

describe('the shared music bank', () => {
  it("sends this phone's songs up once - its sound, by what is in it", async () => {
    files.set('s1', piano)
    meta.set('music:bank', JSON.stringify([{ id: 's1', name: 'Sad piano', type: 'audio/mp4', size: piano.size, fp: 'fp-piano' }]))
    await syncSongs()
    const sha = await sha256(piano)
    expect(asked.map((a) => a.action)).toEqual(['song-upload', 'add-song', 'songs'])
    expect(asked[0].body).toEqual({ sha })
    expect((await loadMusicBank())[0]).toMatchObject({ id: 's1', sha })
    // Shared now: the next sync sends nothing again.
    asked.length = 0
    await syncSongs()
    expect(asked.map((a) => a.action)).toEqual(['songs'])
  })

  it("lists another phone's songs at once, and brings a file down the first time it is used", async () => {
    const sha = await sha256(beat)
    server.songs = [{ id: 'other', name: 'Late night beat', type: 'audio/mpeg', size: beat.size, sha, addedAt: 1 }]
    await syncSongs()
    const [song] = await loadMusicBank()
    expect(song).toMatchObject({ id: 'other', name: 'Late night beat', sha })
    expect(files.has('other')).toBe(false)
    const file = await ensureSong(song)
    expect(await file?.text()).toBe('beat sounds')
    expect(files.has('other')).toBe(true)
  })

  it('becomes the shared song when another phone shared the same one first, and a video picked with it still finds it', async () => {
    const sha = await sha256(piano)
    server.songs = [{ id: 'theirs', name: 'Piano', type: 'audio/mp4', size: piano.size, fp: 'fp-piano', sha, addedAt: 1 }]
    files.set('mine', piano)
    meta.set('music:bank', JSON.stringify([{ id: 'mine', name: 'Sad piano', type: 'audio/mp4', size: piano.size, fp: 'fp-piano' }]))
    await syncSongs()
    expect((await loadMusicBank()).map((s) => s.id)).toEqual(['theirs'])
    expect(files.has('theirs')).toBe(true)
    expect(files.has('mine')).toBe(false)
    expect((await findSong('mine'))?.id).toBe('theirs')
  })

  it('takes a song out on every phone, and lets go of one another phone took out', async () => {
    const sha = await sha256(piano)
    server.songs = [{ id: 's1', name: 'Sad piano', type: 'audio/mp4', size: piano.size, sha, addedAt: 1 }]
    await syncSongs()
    await removeSong('s1')
    await vi.waitFor(() => expect(server.songs).toEqual([]))
    expect(await loadMusicBank()).toEqual([])

    server.songs = [{ id: 's2', name: 'Beat', type: 'audio/mpeg', size: beat.size, sha: await sha256(beat), addedAt: 2 }]
    await syncSongs()
    files.set('s2', beat)
    server.songs = []
    await syncSongs()
    expect(await loadMusicBank()).toEqual([])
    expect(files.has('s2')).toBe(false)
  })

  it('keeps its own new name while the rename is still going up', async () => {
    const sha = await sha256(piano)
    meta.set('music:bank', JSON.stringify([{ id: 's1', name: 'Piano', type: 'audio/mp4', size: 1, sha }]))
    await renameSong('s1', 'Sad piano')
    const bank: Song[] = [{ id: 's1', name: 'Sad piano', type: 'audio/mp4', size: 1, sha }]
    const shared = [{ id: 's1', name: 'Piano', type: 'audio/mp4', size: 1, sha, addedAt: 1 }]
    expect(mergeSongs(bank, shared, [{ op: 'rename', id: 's1', name: 'Sad piano' }])[0].name).toBe('Sad piano')
    expect(mergeSongs(bank, shared)[0].name).toBe('Piano')
    await vi.waitFor(() => expect(asked.some((a) => a.action === 'rename-song' && a.body.name === 'Sad piano')).toBe(true))
  })
})
