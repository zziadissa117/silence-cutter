// A talking head format's clips, edited like his talking videos (stubbed
// here) and waiting for his check (his reports, 2026-11-13): dropped in all
// at once, added to a step by hand, the same recording again, the clips added
// as filmed - on the phone, or on his Cutter server.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { BankFile, BatchBank, BatchStep } from './batch'
import { loadQueue } from './dropQueue'

const said: Record<string, string> = {
  'a.mov': 'Nope, do this instead.',
  'b.mov': 'and now open the app',
  'c.mov': 'hello there everyone',
  'raw.mov': 'open the app now',
}
const onPhone = vi.fn()
const settings = { settings: { preset: 'balanced' }, cleanSpeech: true, voice: true, voices: { profiles: [{ id: 'v1' }], chosen: 'v1' } }
vi.mock('./prepareDrop', () => ({
  prepareClip: vi.fn(async (_blob: Blob, { name, from }: { name: string; from?: string }) => {
    onPhone(name)
    if (name === 'bad.mov') throw new Error('no talking heard in it')
    return { file: { id: `cut-${name}`, name, type: 'video/mp4', size: 1, from, edited: true }, words: [{ text: 'hi', start: 0, end: 0.3 }], text: said[name] }
  }),
  dropSettings: (zoom: object) => ({ ...settings, ...zoom }),
  cutName: (name: string) => name.replace(/\.[^./]+$/, '') + '.mp4',
}))
// A recording's fingerprint: its name, here.
vi.mock('./fingerprint', () => ({ fingerprint: vi.fn(async (file: File) => `fp-${file.name}`) }))
const savedFiles: string[] = []
vi.mock('./store', () => ({
  loadBankFile: vi.fn(async (f: BankFile) => new File(['raw'], f.name)),
  saveBankFile: vi.fn(async (id: string) => void savedFiles.push(id)),
  retireBankFiles: vi.fn(async () => {}),
}))

// His Cutter server, stubbed: what is up there, the orders, what it says.
const server = {
  up: false,
  failUpload: false,
  uploads: [] as string[],
  orders: [] as { id: string; fileId: string; outId: string; outName: string; from: string; names: string[]; voices?: unknown; effects?: unknown }[],
  talk: {} as Record<string, unknown>,
  dropped: [] as string[],
}
vi.mock('./talkLink', () => ({
  talkServerUp: vi.fn(async () => server.up),
  serverLetDown: vi.fn(() => void (server.up = false)),
  upload: vi.fn(async (fileId: string) => {
    if (server.failUpload) throw new Error('The server did not answer.')
    server.uploads.push(fileId)
  }),
  orderDrop: vi.fn(async (order: (typeof server.orders)[number]) => {
    server.orders.push(order)
    server.talk[order.id] = { id: order.id, kind: 'drop', state: 'waiting', progress: 0, error: null, at: '' }
    return { ok: true }
  }),
  talkNow: vi.fn(async () => ({ ...server.talk })),
  downloadFile: vi.fn(async () => new Blob(['cut'])),
  dropTalk: vi.fn(async (id: string) => {
    server.dropped.push(id)
    delete server.talk[id]
  }),
}))

/** The server done with every order: cut, its words back. */
function serverCuts(failing: string[] = []) {
  for (const order of server.orders) {
    const name = order.outName.replace('.mp4', '.mov')
    server.talk[order.id] = failing.includes(name)
      ? { id: order.id, kind: 'drop', state: 'failed', progress: 0, error: 'no talking heard in it', at: '' }
      : {
          id: order.id,
          kind: 'drop',
          state: 'made',
          progress: 1,
          error: null,
          at: '',
          dropped: { file: { id: order.outId, name: order.outName, type: 'video/mp4', size: 3, from: order.from, edited: true }, words: [], text: said[name] },
        }
  }
}

import { DropIn, dropInto } from './DropIn'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const steps = (): BatchStep[] => [
  { id: 's1', name: 'Nope, do this instead', files: [], formats: ['t'] },
  { id: 's2', name: 'Open the app', files: [], formats: ['t'] },
]
const effects = { cutPunch: 'subtle', hookPush: 'off', brandHit: 'strong', logoPop: false } as const

let root: Root
let host: HTMLDivElement
let bank: BatchBank
const onCheck = vi.fn()
beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  bank = { steps: steps(), reactions: [] } as unknown as BatchBank
  savedFiles.length = 0
  onPhone.mockClear()
  onCheck.mockClear()
  Object.assign(server, { up: false, failUpload: false, uploads: [], orders: [], talk: {}, dropped: [] })
  localStorage.clear()
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const render = (hooks = false) =>
  act(async () =>
    root.render(
      <DropIn
        formatId="t"
        hooks={hooks}
        rawHooks={false}
        steps={bank.steps!}
        hookFiles={bank.reactions}
        names={['Pump Fun']}
        effects={effects}
        brandWords={['Pump Fun']}
        getBank={() => bank}
        onCheck={onCheck}
      />,
    ),
  )

const settle = async () => {
  for (let i = 0; i < 8; i++) await act(async () => await new Promise((r) => setTimeout(r, 0)))
}

const files = (names: string[]) => names.map((n) => new File(['x'], n, { type: 'video/quicktime' }))
const drop = async (names: string[]) => {
  const input = host.querySelector('input[aria-label="Drop in all videos"]') as HTMLInputElement
  Object.defineProperty(input, 'files', { value: files(names), configurable: true })
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
  await settle()
}

/** The phone looks again at what the server did (every 3 s). */
const lookAgain = async () => {
  await act(async () => await new Promise((r) => setTimeout(r, 3100)))
  await settle()
}

const queued = () => loadQueue('t').map((q) => ({ id: q.file.id, place: q.place, sure: q.sure, replaces: q.replaces }))

describe('his clips, edited and waiting for his check', () => {
  it('nothing goes in the batch before he checks it: each waits with where it would go', async () => {
    await render()
    await drop(['a.mov', 'b.mov', 'c.mov', 'bad.mov'])
    expect(queued()).toEqual([
      { id: 'cut-a.mov', place: 's1', sure: true, replaces: undefined },
      { id: 'cut-b.mov', place: 's2', sure: true, replaces: undefined },
      { id: 'cut-c.mov', place: null, sure: false, replaces: undefined },
    ])
    expect(bank.steps!.every((s) => s.files.length === 0)).toBe(true)
    expect(host.textContent).toContain("bad.mov: couldn't edit it (no talking heard in it)")
    const check = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Check 3 clips') as HTMLButtonElement
    await act(async () => check.click())
    expect(onCheck).toHaveBeenCalled()
  })

  it("a clip added to a step by hand is edited too, and waits for the check in that step (his report, 2026-11-13)", async () => {
    await render()
    expect(dropInto('t', files(['c.mov']), 's2')).toBe(true)
    await settle()
    expect(onPhone).toHaveBeenCalledWith('c.mov')
    expect(queued()).toEqual([{ id: 'cut-c.mov', place: 's2', sure: true, replaces: undefined }])
    expect(dropInto('other', files(['c.mov']), 's2')).toBe(false)
  })

  it('the same recording dropped in again is edited again, in place of the one in the batch', async () => {
    bank.steps![1].files = [{ id: 'old-b', name: 'b.mp4', type: 'video/mp4', size: 1, from: 'fp-b.mov' }]
    await render()
    await drop(['b.mov'])
    expect(queued()).toEqual([{ id: 'cut-b.mov', place: 's2', sure: true, replaces: 'old-b' }])
    // Already waiting for his check: not edited twice.
    await drop(['b.mov'])
    expect(host.textContent).toContain('b.mov: already on its way to your check')
    expect(onPhone).toHaveBeenCalledTimes(1)
  })

  it('edits the clips added as filmed, each in its own place', async () => {
    bank.steps![1].files = [{ id: 'raw-1', name: 'raw.mov', type: 'video/quicktime', size: 1, fp: 'fp-raw' }]
    bank.steps![0].files = [{ id: 'done-1', name: 'done.mp4', type: 'video/mp4', size: 1, edited: true }]
    await render()
    const button = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Edit the 1 clip added as filmed') as HTMLButtonElement
    await act(async () => button.click())
    await settle()
    expect(queued()).toEqual([{ id: 'cut-raw.mov', place: 's2', sure: true, replaces: 'raw-1' }])
  })

  describe('on his Cutter server', () => {
    it('sends each clip up with its order - his voices and the zooms with it - then each waits for his check, a copy kept on the phone', async () => {
      server.up = true
      await render()
      await drop(['a.mov', 'b.mov', 'bad.mov'])
      expect(onPhone).not.toHaveBeenCalled()
      expect(server.orders).toHaveLength(3)
      expect(server.orders.every((o) => o.fileId === `t-${o.id}`)).toBe(true)
      expect(server.orders[0]).toMatchObject({ outName: 'a.mp4', from: 'fp-a.mov', voices: { chosen: 'v1' }, effects, names: ['Pump Fun'] })
      expect(host.textContent).toContain('Your server is editing 3 more clips')

      serverCuts(['bad.mov'])
      await lookAgain()
      const [a, b] = server.orders
      expect(queued().map((q) => [q.id, q.place])).toEqual([
        [a.outId, 's1'],
        [b.outId, 's2'],
      ])
      expect(host.textContent).toContain("bad.mov: couldn't edit it (no talking heard in it)")
      expect(savedFiles.sort()).toEqual([a.outId, b.outId].sort())
      expect(server.dropped.sort()).toEqual(server.orders.map((o) => o.id).sort())
      expect(host.textContent).not.toContain('Your server is editing')
      expect(localStorage.getItem('batch.dropping:t')).toBeNull()
    })

    it('carries on after the app was closed: what was still on the server comes to the check when he is back', async () => {
      server.up = true
      await render()
      await drop(['a.mov'])
      expect(localStorage.getItem('batch.dropping:t')).toContain('a.mov')
      act(() => root.unmount())
      serverCuts()
      root = createRoot(host)
      await render()
      await settle()
      expect(queued().map((q) => q.id)).toEqual([server.orders[0].outId])
      expect(localStorage.getItem('batch.dropping:t')).toBeNull()
    })

    it('the server not taking them: the phone does that one and the rest', async () => {
      server.up = true
      server.failUpload = true
      await render()
      await drop(['a.mov', 'b.mov'])
      expect(onPhone.mock.calls.map(([n]) => n)).toEqual(['a.mov', 'b.mov'])
      expect(queued().map((q) => q.id)).toEqual(['cut-a.mov', 'cut-b.mov'])
      expect(server.orders).toEqual([])
    })
  })
})
