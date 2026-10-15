import { describe, expect, it } from 'vitest'

import { moovToFront } from './fastStart'

const box = (type: string, body: Uint8Array) => {
  const out = new Uint8Array(8 + body.length)
  new DataView(out.buffer).setUint32(0, out.length)
  out.set([...type].map((c) => c.charCodeAt(0)), 4)
  out.set(body, 8)
  return out
}
const join = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) (out.set(p, at), (at += p.length))
  return out
}
const stco = (offsets: number[]) => {
  const body = new Uint8Array(8 + offsets.length * 4)
  const view = new DataView(body.buffer)
  view.setUint32(4, offsets.length)
  offsets.forEach((o, i) => view.setUint32(8 + i * 4, o))
  return box('stco', body)
}
const moovWith = (offsets: number[]) =>
  box('moov', box('trak', box('mdia', box('minf', box('stbl', stco(offsets))))))
const types = (bytes: Uint8Array) => {
  const out: string[] = []
  for (let at = 0; at < bytes.length; at += new DataView(bytes.buffer).getUint32(at)) out.push(String.fromCharCode(...bytes.slice(at + 4, at + 8)))
  return out
}
const bytesOf = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer())

describe("a made video's index", () => {
  const ftyp = box('ftyp', new Uint8Array(8))
  const media = box('mdat', Uint8Array.from({ length: 64 }, (_, i) => i))
  const mediaStart = ftyp.length + 8

  it('goes to the front, with its chunk offsets moved on by its own size', async () => {
    const moov = moovWith([mediaStart, mediaStart + 32])
    const out = await bytesOf(await moovToFront(new Blob([join(ftyp, media, moov)])))
    expect(types(out)).toEqual(['ftyp', 'moov', 'mdat'])
    const view = new DataView(out.buffer)
    // The stco entries sit at the end of the moov box.
    const stcoEnd = ftyp.length + moov.length
    const first = view.getUint32(stcoEnd - 8)
    const second = view.getUint32(stcoEnd - 4)
    expect(first).toBe(mediaStart + moov.length)
    expect(second).toBe(mediaStart + 32 + moov.length)
    // And there really is the media data they point at.
    expect(out[first]).toBe(0)
    expect(out[second]).toBe(32)
  })

  it('leaves a file that already has it at the front alone', async () => {
    const file = new Blob([join(ftyp, moovWith([ftyp.length + 100]), media)])
    expect(await moovToFront(file)).toBe(file)
  })

  it('gives back anything it cannot read as it was', async () => {
    const junk = new Blob([new Uint8Array([0, 0, 0, 3, 1, 2, 3])])
    expect(await moovToFront(junk)).toBe(junk)
  })
})
