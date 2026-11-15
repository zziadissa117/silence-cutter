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
const asFilmedHere: boolean[] = []
const zoomsHere: boolean[] = []
const settings = { settings: { preset: 'balanced' }, cleanSpeech: true, voice: true, voices: { profiles: [{ id: 'v1' }], chosen: 'v1' } }
vi.mock('./prepareDrop', () => ({
  prepareClip: vi.fn(async (_blob: Blob, { name, from, asFilmed, cut }: { name: string; from?: string; asFilmed?: boolean; cut: { effects?: { cutPunch: string } } }) => {
    onPhone(name)
    asFilmedHere.push(Boolean(asFilmed))
    zoomsHere.push(cut.effects?.cutPunch !== 'off')
    if (name === 'bad.mov') throw new Error('no talking heard in it')
    return {
      file: { id: `cut-${name}`, name, type: 'video/mp4', size: 1, from, edited: true },
      words: [{ text: 'hi', start: 0, end: 0.3 }],
      text: said[name],
      plan: { keep: [{ start: 0.4, end: 1.2 }], words: [{ text: 'hi', start: 0.4, end: 0.7 }], duration: 2 },
    }
  }),
  dropSettings: (zoom: object) => ({ ...settings, ...zoom }),
  hasZooms: (e: { cutPunch: string; hookPush: string; brandHit: string }) => e.cutPunch !== 'off' || e.hookPush !== 'off' || e.brandHit !== 'off',
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
  orders: [] as { id: string; fileId: string; outId: string; outName: string; inName?: string; from: string; names: string[]; voices?: unknown; effects?: unknown; asFilmed?: boolean }[],
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
          dropped: {
            file: { id: order.outId, name: order.outName, type: 'video/mp4', size: 3, from: order.from, edited: true },
            words: [],
            text: said[name],
            plan: { keep: [{ start: 0.2, end: 1 }], words: [], duration: 1.5 },
          },
        }
  }
}

import { DropIn, dropInto } from './DropIn'
import type { DropChoices } from './dropQueue'

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
const onChoices = vi.fn()
const ALL_ON: DropChoices = { cut: true, zoom: true, captions: true, music: true, headline: true, mirror: false }
beforeEach(() => {
  asFilmedHere.length = 0
  zoomsHere.length = 0
  onChoices.mockClear()
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

const render = (hooks = false, choices: DropChoices = ALL_ON) =>
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
        choices={choices}
        onChoices={onChoices}
      />,
    ),
  )

const settle = async () => {
  for (let i = 0; i < 8; i++) await act(async () => await new Promise((r) => setTimeout(r, 0)))
}

const files = (names: string[]) => names.map((n) => new File(['x'], n, { type: 'video/quicktime' }))
const button = (text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === text) as HTMLButtonElement
/** His clips picked, the checklist set (`untick`: the switches he taps), Start. */
const drop = async (names: string[], untick: string[] = []) => {
  const input = host.querySelector('input[aria-label="Drop in all videos"]') as HTMLInputElement
  Object.defineProperty(input, 'files', { value: files(names), configurable: true })
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
  for (const name of untick) await act(async () => (host.querySelector(`input[aria-label="${name}"]`) as HTMLInputElement).click())
  await act(async () => button('Start').click())
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

  it("counts the clips he hasn't checked - the ones that sound like another step first - and sends them to the check (his ask, 2026-11-14)", async () => {
    bank.steps![1].files = [
      { id: 'w', name: 'w.mp4', type: 'video/mp4', size: 1, fp: 'fp-w', edited: true },
      { id: 'ok', name: 'ok.mp4', type: 'video/mp4', size: 1, fp: 'fp-ok', edited: true },
      { id: 'seen', name: 'seen.mp4', type: 'video/mp4', size: 1, edited: true, captions: [] },
    ]
    const said = ['nope', 'do', 'this', 'instead'].map((text, i) => ({ text, start: i, end: i + 0.4 }))
    localStorage.setItem('batch.talkWords:fp-w', JSON.stringify({ v: 1, words: said }))
    await render()
    expect(host.textContent).toContain('1 clip may be in the wrong step')
    expect(host.textContent).toContain("2 you haven't checked in all")
    const check = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Check the 2') as HTMLButtonElement
    await act(async () => check.click())
    expect(onCheck).toHaveBeenCalled()
    expect(loadQueue('t').map((q) => [q.file.id, q.place, q.sure, q.hint ?? null, q.recheck])).toEqual([
      ['w', 's2', false, 's1', true],
      ['ok', 's2', true, null, true],
    ])
    expect(host.textContent).toContain('Check 2 clips')
    expect(host.textContent).not.toContain('may be in the wrong step')
  })

  it('the checklist (his ask, 2026-11-14): ticked as he last left it; Cut and Captions off - kept as he cut them, no captions; his picks kept', async () => {
    await render(false, { cut: true, zoom: true, captions: true, music: false, headline: true, mirror: false })
    const input = host.querySelector('input[aria-label="Drop in all videos"]') as HTMLInputElement
    Object.defineProperty(input, 'files', { value: files(['a.mov', 'b.mov']), configurable: true })
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
    // Nothing edited before he says Start.
    expect(onPhone).not.toHaveBeenCalled()
    expect(host.textContent).toContain('2 clips - what should the Cutter do?')
    const ticked = (name: string) => (host.querySelector(`input[aria-label="${name}"]`) as HTMLInputElement).checked
    expect(['Cut the clips', 'Zoom', 'Captions', 'Music', 'Headline', 'Mirror them'].map(ticked)).toEqual([true, true, true, false, true, false])
    await act(async () => (host.querySelector('input[aria-label="Cut the clips"]') as HTMLInputElement).click())
    await act(async () => (host.querySelector('input[aria-label="Captions"]') as HTMLInputElement).click())
    await act(async () => (host.querySelector('input[aria-label="Mirror them"]') as HTMLInputElement).click())
    expect(host.textContent).toContain('Kept exactly as you cut them.')
    expect(host.textContent).toContain('a paper you hold up reads the right way')
    await act(async () => button('Start').click())
    await settle()
    expect(onChoices).toHaveBeenCalledWith({ cut: false, zoom: true, captions: false, music: false, headline: true, mirror: true })
    expect(asFilmedHere).toEqual([true, true])
    expect(loadQueue('t').map((q) => [q.file.id, q.place, q.noCaptions, q.file.mirror])).toEqual([
      ['cut-a.mov', 's1', true, true],
      ['cut-b.mov', 's2', true, true],
    ])
  })

  it('Zoom off: no zooms, cut or not; on: the campaign’s zooms - even on clips he cut himself', async () => {
    await render()
    await drop(['a.mov'], ['Zoom'])
    await drop(['b.mov'], ['Cut the clips'])
    expect(asFilmedHere).toEqual([false, true])
    expect(zoomsHere).toEqual([false, true])
  })

  it('what it will do is in sight before he drops anything in; Change sets it without dropping (his report, 2026-11-14)', async () => {
    await render(false, { cut: false, zoom: true, captions: true, music: false, headline: true, mirror: false })
    const chips = [...host.querySelectorAll('.drop-chip')].map((c) => [c.textContent, c.classList.contains('on')])
    expect(chips).toEqual([
      ['✕ Cut the clips', false],
      ['✓ Zoom', true],
      ['✓ Captions', true],
      ['✕ Music', false],
      ['✓ Headline', true],
      ['✕ Mirror them', false],
    ])
    await act(async () => button('Change').click())
    expect(host.textContent).toContain('What the Cutter does with your clips')
    await act(async () => (host.querySelector('input[aria-label="Music"]') as HTMLInputElement).click())
    await act(async () => button('Save').click())
    expect(onChoices).toHaveBeenCalledWith({ cut: false, zoom: true, captions: true, music: true, headline: true, mirror: false })
    expect(onPhone).not.toHaveBeenCalled()
  })

  it("each clip waits for its check with its recording kept on the phone and how it was cut - for its timeline (his ask, 2026-11-14)", async () => {
    await render()
    await drop(['a.mov'])
    const [q] = loadQueue('t')
    expect(q.source).toMatchObject({ keep: [{ start: 0.4, end: 1.2 }], duration: 2, seed: 'fp-a.mov', voice: true, effects })
    expect(q.source!.fileId.startsWith('src-')).toBe(true)
    expect(savedFiles).toContain(q.source!.fileId)
  })

  it('Cancel: nothing edited', async () => {
    await render()
    const input = host.querySelector('input[aria-label="Drop in all videos"]') as HTMLInputElement
    Object.defineProperty(input, 'files', { value: files(['a.mov']), configurable: true })
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
    await act(async () => button('Cancel').click())
    await settle()
    expect(onPhone).not.toHaveBeenCalled()
    expect(host.querySelector('input[aria-label="Drop in all videos"]')).not.toBeNull()
  })

  it("a step's + Add goes as he last left the checklist, without asking", async () => {
    await render(false, { cut: false, zoom: true, captions: true, music: true, headline: true, mirror: true })
    expect(dropInto('t', files(['c.mov']), 's2')).toBe(true)
    await settle()
    expect(asFilmedHere).toEqual([true])
    expect(loadQueue('t')[0].noCaptions).toBeUndefined()
    expect(loadQueue('t')[0].file.mirror).toBe(true)
    expect(onChoices).not.toHaveBeenCalled()
  })

  it('every clip checked: he can still look at where every one is again', async () => {
    bank.steps![0].files = [{ id: 'a', name: 'a.mp4', type: 'video/mp4', size: 1, edited: true, checked: true }]
    await render()
    expect(host.textContent).not.toContain("haven't checked")
    const again = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Check where every clip is again') as HTMLButtonElement
    await act(async () => again.click())
    expect(loadQueue('t').map((q) => [q.file.id, q.place, q.recheck])).toEqual([['a', 's1', true]])
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
      // The copies down from the server - and each recording, kept for its timeline.
      expect(savedFiles.filter((id) => !id.startsWith('src-')).sort()).toEqual([a.outId, b.outId].sort())
      expect(savedFiles.filter((id) => id.startsWith('src-'))).toHaveLength(3)
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

    it('Cut the clips and Captions off: the server only hears them and keeps them as he gave them; no captions on the check', async () => {
      server.up = true
      await render()
      // "untick" Mirror them: it was off, so this ticks it.
      await drop(['a.mov'], ['Cut the clips', 'Captions', 'Mirror them'])
      expect(server.orders[0]).toMatchObject({ asFilmed: true, inName: 'a.mov', outName: 'a.mp4' })
      // Zoom still on: the campaign's zooms go with it.
      expect(server.orders[0]).toMatchObject({ effects })
      // Its recording kept here before it went up, for the timeline.
      const kept = savedFiles.find((id) => id.startsWith('src-'))
      expect(kept).toBeDefined()
      serverCuts()
      await lookAgain()
      expect(loadQueue('t').map((q) => [q.file.id, q.place, q.noCaptions, q.file.mirror])).toEqual([[server.orders[0].outId, 's1', true, true]])
      // Zoom on, so the timeline makes it again with the campaign's zooms.
      expect(loadQueue('t')[0].source).toMatchObject({ fileId: kept, keep: [{ start: 0.2, end: 1 }], effects })
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
