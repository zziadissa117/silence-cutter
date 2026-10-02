import { describe, expect, it } from 'vitest'

import { fingerprint, handPostKey, newOnes, skippedNotice } from './fingerprint'

const bytes = (n: number, seed = 1) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) % 251)

describe('fingerprint', () => {
  it('is the same for the same bytes, whatever the file is called', async () => {
    const a = new File([bytes(3_500_000)], 'IMG_0001.mov')
    const b = new File([bytes(3_500_000)], 'copy of IMG_0001.mp4')
    expect(await fingerprint(a)).toBe(await fingerprint(b))
  })

  it('differs when the content differs, even at the same size', async () => {
    const a = new File([bytes(3_500_000, 1)], 'a.mp4')
    const b = new File([bytes(3_500_000, 2)], 'b.mp4')
    expect(await fingerprint(a)).not.toBe(await fingerprint(b))
  })

  it('differs when only the size differs', async () => {
    const a = new File([bytes(3_500_000)], 'a.mp4')
    const b = new File([bytes(3_500_001)], 'a.mp4')
    expect(await fingerprint(a)).not.toBe(await fingerprint(b))
  })

  it('notices a change in the middle of a long file, not just its ends', async () => {
    const a = bytes(6_000_000)
    const b = bytes(6_000_000)
    b[3_000_000] = (b[3_000_000] + 1) % 251
    expect(await fingerprint(new File([a], 'a.mp4'))).not.toBe(await fingerprint(new File([b], 'a.mp4')))
  })

  it('handles an empty and a tiny file', async () => {
    expect(await fingerprint(new File([], 'e.mp4'))).toMatch(/^0-/)
    expect(await fingerprint(new File([bytes(10)], 't.mp4'))).toMatch(/^10-/)
  })
})

describe('newOnes', () => {
  const f = (fp: string, name: string) => ({ fp, name })

  it('keeps what is new and skips what is known', () => {
    const { fresh, skipped } = newOnes([f('1', 'a'), f('2', 'b')], new Set(['1']))
    expect(fresh.map((x) => x.name)).toEqual(['b'])
    expect(skipped).toEqual(['a'])
  })

  it('skips a repeat within the same pick', () => {
    const { fresh, skipped } = newOnes([f('1', 'a'), f('1', 'a again')], new Set())
    expect(fresh.map((x) => x.name)).toEqual(['a'])
    expect(skipped).toEqual(['a again'])
  })
})

describe('skippedNotice', () => {
  it('says nothing when nothing was skipped', () => {
    expect(skippedNotice([], 'in the bank')).toBeNull()
  })
  it('names one, and several, plainly', () => {
    expect(skippedNotice(['a.mp4'], 'in the bank')).toBe('Duplicate skipped: a.mp4 is already in the bank.')
    expect(skippedNotice(['a', 'b'], 'in the bank')).toBe('Duplicate skipped: a, b are already in the bank.')
    expect(skippedNotice(['a', 'b', 'c', 'd', 'e'], 'sent')).toBe('Duplicate skipped: a, b, c and 2 more are already sent.')
  })
})

describe('handPostKey', () => {
  it('is the same for the same video, campaign and day', () => {
    expect(handPostKey('9-abc', 'c1', '2026-10-02')).toBe(handPostKey('9-abc', 'c1', '2026-10-02'))
  })
  it('is different for another campaign, another day or another video', () => {
    const base = handPostKey('9-abc', 'c1', '2026-10-02')
    expect(handPostKey('9-abc', 'c2', '2026-10-02')).not.toBe(base)
    expect(handPostKey('9-abc', 'c1', '2026-10-03')).not.toBe(base)
    expect(handPostKey('9-abd', 'c1', '2026-10-02')).not.toBe(base)
  })
})
