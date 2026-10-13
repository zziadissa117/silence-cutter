import { beforeEach, describe, expect, it, vi } from 'vitest'

const meta = new Map<string, string>()
const files = new Map<string, Blob>()

vi.mock('./store', () => ({
  getMeta: vi.fn(async (key: string) => meta.get(key) ?? null),
  setMeta: vi.fn(async (key: string, value: string | null) => {
    if (value === null) meta.delete(key)
    else meta.set(key, value)
  }),
  saveBankFile: vi.fn(async (id: string, file: Blob) => void files.set(id, file)),
  loadBankFile: vi.fn(async (file: { id: string; name: string; type: string }) => {
    const blob = files.get(file.id)
    return blob ? new File([blob], file.name, { type: file.type }) : null
  }),
  deleteBankFile: vi.fn(async (id: string) => void files.delete(id)),
}))
vi.mock('./fingerprint', () => ({ fingerprint: vi.fn(async (file: Blob) => `fp-${await file.text()}`) }))

import { addVideos, loadVideoBank, popCue, posterOf, removeVideo, updateVideo, videoFile } from './videoBank'

const clip = (name: string, body = name) => new File([body], name, { type: 'video/mp4' })
const probe = vi.fn(async () => ({ seconds: 4.2, width: 1920, height: 1080, poster: new Blob(['still'], { type: 'image/jpeg' }) }))

beforeEach(() => {
  meta.clear()
  files.clear()
  probe.mockClear()
})

describe('the video bank', () => {
  it('keeps a clip with its length, shape and still, waiting for words', async () => {
    const { added } = await addVideos([clip('claude code demo.mp4', 'a')], undefined, probe)
    expect(added[0]).toMatchObject({ name: 'claude code demo', seconds: 4.2, width: 1920, height: 1080, words: [] })
    expect(await videoFile(added[0])).not.toBeNull()
    expect(await (await posterOf(added[0]))?.text()).toBe('still')
  })

  it('skips the same recording added twice', async () => {
    await addVideos([clip('a.mp4', 'same')], undefined, probe)
    const again = await addVideos([clip('copy of a.mp4', 'same')], undefined, probe)
    expect(again.skipped).toEqual(['copy of a.mp4'])
    expect(await loadVideoBank()).toHaveLength(1)
  })

  it('says why a clip could not be kept, and keeps the rest', async () => {
    const failing = vi.fn(async (_: Blob, name: string) => {
      if (name === 'bad.mov') throw new Error("bad.mov: this phone can't play it here")
      return { seconds: 3, width: 1080, height: 1920, poster: null }
    })
    const { added, failed } = await addVideos([clip('bad.mov', 'x'), clip('good.mp4', 'y')], undefined, failing)
    expect(added.map((v) => v.name)).toEqual(['good'])
    expect(failed).toEqual(["bad.mov: this phone can't play it here"])
  })

  it('takes words and a new name, and gives a look what it needs', async () => {
    const { added } = await addVideos([clip('IMG_0042.MOV', 'z')], undefined, probe)
    await updateVideo(added[0].id, { words: ['Claude Code', 'Claude'], name: 'Claude demo' })
    const [video] = await loadVideoBank()
    expect(video.name).toBe('Claude demo')
    expect(popCue(video)).toEqual({ id: video.id, words: ['Claude Code', 'Claude'], seconds: 4.2, width: 1920, height: 1080 })
  })

  it('takes a clip and its still off the phone when removed', async () => {
    const { added } = await addVideos([clip('a.mp4')], undefined, probe)
    await removeVideo(added[0].id)
    expect(await loadVideoBank()).toEqual([])
    expect(files.size).toBe(0)
  })
})
