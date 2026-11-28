import { describe, expect, it } from 'vitest'

import { emptyBank, type BankFile, type BatchBank } from './batch'
import { blobKeys, filesOfPack, packBank, withBlobs, withoutBlobs } from './batchShare'

const file = (id: string, extra: Partial<BankFile> = {}): BankFile => ({ id, name: `${id}.mp4`, type: 'video/mp4', size: 1, ...extra })

const bank = (): BatchBank => ({
  ...emptyBank('fairside', 'a1'),
  formats: [
    { id: 'r', kind: 'reaction', name: 'Reaction' },
    { id: 't', kind: 'talking', name: 'Talking' },
  ],
  reactions: [file('me1', { formats: ['r'] }), file('me2', { formats: ['t'], talks: true })],
  products: [file('prod1', { formats: ['r'], source: { recording: 'x' } as never })],
  steps: [
    { id: 's1', name: 'Open the app', files: [file('step1', { formats: ['r'] })], formats: ['r'], overlays: [{ id: 'o', file: file('pic', { type: 'image/png' }), place: { x: 0.5, y: 0.5, width: 0.4 } } as never] },
    { id: 's2', name: 'Say why', files: [file('mytalk', { formats: ['t'] })], formats: ['t'], script: 'Here is why', heard: ['here is why'] },
  ],
  music: [file('song', { type: 'audio/mpeg' })],
  headlines: ['POV: rent paid'],
  used: { me1: 3 },
  made: ['x'],
  filled: { '2026-11-28': 4 },
  running: true,
  where: 'server',
})

describe('a batch shared with students', () => {
  it('goes without his clips, his progress, and stopped', () => {
    const packed = packBank(bank())
    expect(packed.reactions).toEqual([])
    expect(packed.products.map((p) => p.id)).toEqual(['prod1'])
    expect(packed.products[0].source).toBeUndefined()
    // A talking head's step: its words and script stay, his clips go.
    expect(packed.steps?.find((s) => s.id === 's2')).toMatchObject({ name: 'Say why', files: [], script: 'Here is why' })
    expect(packed.steps?.find((s) => s.id === 's1')?.files.map((f) => f.id)).toEqual(['step1'])
    expect(packed.running).toBe(false)
    expect(packed.used).toEqual({})
    expect(packed.made).toBeUndefined()
    expect(packed.filled).toBeUndefined()
    expect(packed.where).toBeUndefined()
    expect(packed.headlines).toEqual(['POV: rent paid'])
    expect(filesOfPack(packed).map((f) => f.id).sort()).toEqual(['pic', 'prod1', 'song', 'step1'])
  })

  it('carries the campaign\'s pictures as files and puts them back', () => {
    const logo = new Blob(['logo'], { type: 'image/png' })
    const { value, blobs } = withoutBlobs({ name: 'Fairside', logo, angles: [{ music: { audio: new Blob(['a'], { type: 'audio/mpeg' }) } }] })
    expect([...blobKeys(value)].sort()).toEqual(['c0', 'c1'])
    const back = withBlobs(JSON.parse(JSON.stringify(value)), blobs) as { name: string; logo: Blob }
    expect(back.name).toBe('Fairside')
    expect(back.logo).toBe(logo)
  })
})
