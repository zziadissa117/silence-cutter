// "Drop in all videos" on a talking head format (his ask, 2026-11-13): each
// clip cut and heard (stubbed here), put in the step it says, then one quick
// check where a clip can be moved or left out. With his Cutter server up the
// clips go there and are sorted in as they come back.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { BatchBank, BatchStep } from './batch'

const said: Record<string, string> = {
  'a.mov': 'Nope, do this instead.',
  'b.mov': 'and now open the app',
  'c.mov': 'hello there everyone',
}
const onPhone = vi.fn()
vi.mock('./prepareDrop', () => ({
  prepareClip: vi.fn(async (file: File, { from }: { from?: string }) => {
    onPhone(file.name)
    if (file.name === 'bad.mov') throw new Error('no talking heard in it')
    return { file: { id: `cut-${file.name}`, name: file.name, type: 'video/mp4', size: 1, from }, words: [], text: said[file.name] }
  }),
  dropSettings: () => ({ settings: { preset: 'balanced' }, cleanSpeech: true, voice: true }),
  cutName: (name: string) => name.replace(/\.[^./]+$/, '') + '.mp4',
}))
// A recording's fingerprint: its name, here.
vi.mock('./fingerprint', () => ({ fingerprint: vi.fn(async (file: File) => `fp-${file.name}`) }))
const retired: string[] = []
const savedFiles: string[] = []
vi.mock('./store', () => ({
  retireBankFiles: vi.fn(async (ids: string[]) => void retired.push(...ids)),
  saveBankFile: vi.fn(async (id: string) => void savedFiles.push(id)),
}))
const remembered: string[] = []
vi.mock('./talkCaptions', () => ({ rememberWords: (file: { id: string }) => void remembered.push(file.id) }))

// His Cutter server, stubbed: what is up there, the orders, what it says.
const server = {
  up: false,
  failUpload: false,
  uploads: [] as string[],
  orders: [] as { id: string; fileId: string; outId: string; outName: string; from: string; names: string[] }[],
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
          dropped: { file: { id: order.outId, name: order.outName, type: 'video/mp4', size: 3, from: order.from }, words: [], text: said[name] },
        }
  }
}

import { DropIn } from './DropIn'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const steps: BatchStep[] = [
  { id: 's1', name: 'Nope, do this instead', files: [] },
  { id: 's2', name: 'Open the app', files: [] },
]

let root: Root
let host: HTMLDivElement
let bank: BatchBank
beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  bank = { steps, reactions: [] } as unknown as BatchBank
  retired.length = 0
  savedFiles.length = 0
  remembered.length = 0
  onPhone.mockClear()
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
        steps={bank.steps!}
        names={[]}
        getBank={() => bank}
        keep={(next) => {
          bank = next
        }}
      />,
    ),
  )

const settle = async () => {
  for (let i = 0; i < 8; i++) await act(async () => await new Promise((r) => setTimeout(r, 0)))
}

const drop = async (names: string[]) => {
  const input = host.querySelector('input[aria-label="Drop in all videos"]') as HTMLInputElement
  Object.defineProperty(input, 'files', { value: names.map((n) => new File(['x'], n, { type: 'video/quicktime' })), configurable: true })
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
  await settle()
}

/** The phone looks again at what the server did (every 3 s). */
const lookAgain = async () => {
  await act(async () => await new Promise((r) => setTimeout(r, 3100)))
  await settle()
}

describe('dropping in all his clips', () => {
  it('puts each in the step it says, shows the unsure ones first, and keeps what he moves', async () => {
    await render()
    await drop(['a.mov', 'b.mov', 'c.mov', 'bad.mov'])
    expect(bank.steps![0].files.map((f) => f.id)).toEqual(['cut-a.mov'])
    expect(bank.steps![1].files.map((f) => f.id)).toEqual(['cut-b.mov'])
    expect(host.textContent).toContain('Check them · 4 clips · 1 to look at')
    // The one it couldn't place comes first, to pick its step.
    const first = host.querySelector('.drop-in-row') as HTMLElement
    expect(first.textContent).toContain('Not sure where it goes')
    const pick = first.querySelector('select') as HTMLSelectElement
    await act(async () => {
      pick.value = 's2'
      pick.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(bank.steps![1].files.map((f) => f.id)).toEqual(['cut-b.mov', 'cut-c.mov'])
    expect(host.textContent).toContain("bad.mov: couldn't use it (no talking heard in it)")
    // Checked: the step remembers how he said it.
    await act(async () => ([...host.querySelectorAll('button')].find((b) => b.textContent === 'Looks good') as HTMLButtonElement).click())
    expect(bank.steps![1].heard).toEqual(['hello there everyone', 'and now open the app'])
    expect(host.querySelector('.drop-in-check')).toBeNull()
  })

  it('leaves one out, and lets its clip go', async () => {
    await render()
    await drop(['a.mov'])
    const pick = host.querySelector('.drop-in-row select') as HTMLSelectElement
    await act(async () => {
      pick.value = 'out'
      pick.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(bank.steps![0].files).toEqual([])
    expect(retired).toEqual(['cut-a.mov'])
  })

  it('in a format that takes hooks, a clip that says no step is a hook; one dropped in before is not kept twice', async () => {
    await render(true)
    await drop(['a.mov', 'c.mov'])
    expect(bank.steps![0].files.map((f) => f.id)).toEqual(['cut-a.mov'])
    expect(bank.reactions.map((r) => r.id)).toEqual(['cut-c.mov'])
    expect(bank.reactions[0]).toMatchObject({ formats: ['t'], talks: true })
    // Clearly no step: a hook, nothing to look at.
    expect(host.textContent).toContain('all sure')
    // Moved from the hooks to a step.
    const row = [...host.querySelectorAll('.drop-in-row')].find((r) => r.textContent?.includes('hello there')) as HTMLElement
    const pick = row.querySelector('select') as HTMLSelectElement
    await act(async () => {
      pick.value = 's2'
      pick.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(bank.reactions).toEqual([])
    expect(bank.steps![1].files.map((f) => f.id)).toEqual(['cut-c.mov'])
    await act(async () => ([...host.querySelectorAll('button')].find((b) => b.textContent === 'Looks good') as HTMLButtonElement).click())
    await drop(['a.mov'])
    expect(host.textContent).toContain('a.mov: already in from before')
    expect(bank.steps![0].files).toHaveLength(1)
  })

  describe('on his Cutter server', () => {
    it('sends each clip up with its order, then sorts them in as they come back, a copy kept on the phone', async () => {
      server.up = true
      await render()
      await drop(['a.mov', 'b.mov', 'c.mov', 'bad.mov'])
      expect(onPhone).not.toHaveBeenCalled()
      expect(server.orders).toHaveLength(4)
      expect(server.uploads).toEqual(server.orders.map((o) => o.fileId))
      // Raw recordings go up as t- files: let go of with their order, and HEVC made playable there.
      expect(server.orders.every((o) => o.fileId === `t-${o.id}`)).toBe(true)
      expect(server.orders[0]).toMatchObject({ outName: 'a.mp4', from: 'fp-a.mov', cleanSpeech: true, voice: true })
      expect(host.textContent).toContain('Your server is cutting 4 more clips')
      expect(bank.steps![0].files).toEqual([])

      serverCuts(['bad.mov'])
      await lookAgain()
      const [a, b] = server.orders
      expect(bank.steps![0].files.map((f) => f.id)).toEqual([a.outId])
      expect(bank.steps![1].files.map((f) => f.id)).toEqual([b.outId])
      expect(bank.steps![0].files[0]).toMatchObject({ name: 'a.mp4', from: 'fp-a.mov' })
      expect(host.textContent).toContain('Check them · 4 clips · 1 to look at')
      expect(host.textContent).toContain("bad.mov: couldn't use it (no talking heard in it)")
      expect(remembered).toHaveLength(3)
      // Copies down for the clips the batch uses (not the one with nowhere to go yet), then done with them there.
      expect(savedFiles.sort()).toEqual([a.outId, b.outId].sort())
      expect(server.dropped.sort()).toEqual(server.orders.map((o) => o.id).sort())
      expect(host.textContent).not.toContain('Your server is cutting')
      expect(localStorage.getItem('batch.dropping:t')).toBeNull()
    })

    it('carries on after the app was closed: what was still on the server is sorted in when he is back', async () => {
      server.up = true
      await render()
      await drop(['a.mov'])
      expect(localStorage.getItem('batch.dropping:t')).toContain('a.mov')
      act(() => root.unmount())
      serverCuts()
      root = createRoot(host)
      await render()
      await settle()
      expect(bank.steps![0].files.map((f) => f.id)).toEqual([server.orders[0].outId])
      expect(localStorage.getItem('batch.dropping:t')).toBeNull()
      // And a clip on its way back is not sent twice.
      await drop(['a.mov'])
      expect(host.textContent).toContain('a.mov: already in from before')
      expect(server.orders).toHaveLength(1)
    })

    it('the server not taking them: the phone does that one and the rest', async () => {
      server.up = true
      server.failUpload = true
      await render()
      await drop(['a.mov', 'b.mov'])
      expect(onPhone.mock.calls.map(([n]) => n)).toEqual(['a.mov', 'b.mov'])
      expect(bank.steps![0].files.map((f) => f.id)).toEqual(['cut-a.mov'])
      expect(server.orders).toEqual([])
    })
  })
})
