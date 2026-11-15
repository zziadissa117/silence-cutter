// His check of a talking head's edited clips, one by one (his report,
// 2026-11-13): where each goes - pointed out every time - and its captions on
// the Cutter's own caption check (stubbed here: tested in its own files).

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { BatchBank, BatchFormat, BatchStep } from './batch'
import type { CaptionWord } from './captions'
import { loadQueue, saveQueue, type ToCheck } from './dropQueue'
import type { Campaign } from './look'

const retired: string[][] = []
vi.mock('./store', () => ({
  loadBankFile: vi.fn(async () => new Blob(['clip'])),
  saveBankFile: vi.fn(async () => {}),
  retireBankFiles: vi.fn(async (ids: string[]) => void retired.push(ids)),
}))
vi.mock('./talkLink', () => ({ downloadFile: vi.fn(async () => new Blob(['clip'])) }))
vi.mock('./posting', () => ({ postingHere: () => ({}), recheckCaptions: vi.fn() }))
// Made again from the timeline: what it was asked for.
const recuts: { keep: { start: number; end: number }[]; seed: string }[] = []
// Made cut or as filmed from the check's Cutter switch: what it was asked for.
const cutCalls: { asFilmed: boolean; seed: string }[] = []
vi.mock('./prepareDrop', () => ({
  dropSettings: () => ({ settings: {} }),
  videoType: () => 'video/quicktime',
  cutDropped: vi.fn(async (_file: Blob, { asFilmed = false, seed }: { asFilmed?: boolean; seed: string }) => {
    cutCalls.push({ asFilmed, seed })
    const keep = asFilmed ? [{ start: 0, end: 3 }] : [{ start: 0.5, end: 2 }]
    return { blob: new Blob(['made']), words: [{ text: asFilmed ? 'whole' : 'tight', start: 0, end: 0.4 }], text: asFilmed ? 'whole' : 'tight', cut: !asFilmed, remade: true, plan: { keep, words: [], duration: 3 } }
  }),
  cutName: (name: string) => name.replace(/\.[^./]+$/, '') + '.mp4',
  recut: vi.fn(async (_file: Blob, { keep, seed }: { keep: { start: number; end: number }[]; seed: string }) => {
    recuts.push({ keep, seed })
    return { blob: new Blob(['again']), words: [{ text: 'longer', start: 0, end: 0.5 }], text: 'longer' }
  }),
}))
vi.mock('./filming', () => ({ filmingOf: vi.fn(async () => ({ seconds: 2.5 })) }))
vi.mock('./fingerprint', () => ({ fingerprint: vi.fn(async () => 'fp-again') }))
// The timeline itself (tested in its own files): Done with the first part made longer.
vi.mock('./CutsEditor', () => ({
  CutsEditor: (p: { initial: { start: number; end: number }[]; missing?: boolean; onDone: (keep: { start: number; end: number }[]) => void; onCancel: () => void }) => (
    <section className="timeline-stub">
      <span className="timeline-parts">{p.missing ? 'missing' : JSON.stringify(p.initial)}</span>
      <button type="button" onClick={() => p.onDone([{ start: p.initial[0].start - 0.5, end: p.initial[0].end }])}>
        Done
      </button>
      <button type="button" onClick={p.onCancel}>
        Back
      </button>
    </section>
  ),
}))
// A clip never heard is heard on the check.
const heardNow = vi.fn(async () => ['nope', 'do', 'this', 'instead'].map((text, i) => ({ text, start: i, end: i + 0.4 })))
vi.mock('./talkCaptions', () => ({ talkWords: () => heardNow() }))
// The caption check itself: what it is handed, and Approve with a fixed phrase.
const seen: { name: string; recheckKey?: string; captionStyle?: string; hasRecheck: boolean; initial: string }[] = []
vi.mock('./CaptionReview', () => ({
  CaptionReview: (p: {
    name: string
    top: React.ReactNode
    bottom?: React.ReactNode
    initial: CaptionWord[]
    approveLabel: string
    recheckKey?: string
    captionStyle?: string
    onRecheck?: unknown
    onCaptionStyle: (s: string) => void
    onApprove: (w: CaptionWord[]) => void
    onSkip: (w: CaptionWord[]) => void
  }) => {
    seen.push({ name: p.name, recheckKey: p.recheckKey, captionStyle: p.captionStyle, hasRecheck: Boolean(p.onRecheck), initial: p.initial.map((w) => w.text).join(' ') })
    return (
      <section>
        {p.top}
        <span className="review-name">{p.name}</span>
        <button type="button" onClick={() => p.onCaptionStyle('highlight')}>
          Style
        </button>
        <button type="button" onClick={() => p.onApprove([{ text: 'Fixed', start: 0, end: 0.5 }])}>
          {p.approveLabel}
        </button>
        <button type="button" onClick={() => p.onSkip([])}>
          Without captions
        </button>
        {p.bottom}
      </section>
    )
  },
}))

import { DropCheck } from './DropCheck'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const steps: BatchStep[] = [
  { id: 's1', name: 'Nope, do this instead', files: [], formats: ['t'] },
  { id: 's2', name: 'Open the app', files: [{ id: 'old', name: 'old.mp4', type: 'video/mp4', size: 1 }], formats: ['t'] },
]
const format: BatchFormat = { id: 't', kind: 'talking', name: 'Talk' }
const campaign = { id: 'c', name: 'Pump Fun', brandWords: ['Pump Fun'], posting: { rules: '' } } as unknown as Campaign
const clip = (id: string, place: string | null, sure: boolean, extra: Partial<ToCheck> = {}): ToCheck => ({
  file: { id, name: `${id}.mp4`, type: 'video/mp4', size: 1, fp: `fp-${id}`, edited: true },
  name: `${id}.mov`,
  text: `words of ${id}`,
  words: [{ text: 'heard', start: 0, end: 0.4 }],
  place,
  sure,
  ...extra,
})

let root: Root
let host: HTMLDivElement
let bank: BatchBank
let formatNow: BatchFormat
const onClose = vi.fn()
beforeEach(() => {
  recuts.length = 0
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  bank = { steps: structuredClone(steps), reactions: [] } as unknown as BatchBank
  formatNow = { ...format }
  retired.length = 0
  seen.length = 0
  onClose.mockClear()
  localStorage.clear()
  window.scrollTo = () => {}
  Element.prototype.scrollTo = () => {}
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const render = () =>
  act(async () =>
    root.render(
      <DropCheck
        format={formatNow}
        steps={bank.steps!}
        campaign={campaign}
        getBank={() => bank}
        keep={(next) => void (bank = next)}
        onFormat={(patch) => void (formatNow = { ...formatNow, ...patch })}
        onClose={onClose}
      />,
    ),
  )
const button = (text: string) => [...document.body.querySelectorAll('button')].find((b) => b.textContent?.includes(text)) as HTMLButtonElement
const click = (text: string) => act(async () => button(text).click())
const lit = () => host.querySelector('.drop-check-steps [aria-checked="true"]')?.textContent
const settle = async () => {
  for (let i = 0; i < 6; i++) await act(async () => await new Promise((r) => setTimeout(r, 0)))
}

describe('checking every clip, one by one', () => {
  it('points out each clip and where it goes - the unsure ones first - and puts it in the batch only when he approves', async () => {
    saveQueue('t', [clip('a', 's1', true), clip('b', 's1', false)])
    await render()
    // The one it wasn't sure of first, marked.
    expect(host.querySelector('.review-name')?.textContent).toBe('b.mov')
    expect(host.textContent).toContain('Clip 1 of 2')
    expect(host.textContent).toContain('Not sure - check it')
    expect(lit()).toBe('1Nope, do this instead')
    // He moves it to step 2 and approves: there, with his captions.
    await click('Open the app')
    expect(lit()).toBe('2Open the app')
    expect(host.textContent).not.toContain('Not sure - check it')
    await click('Approve & next clip')
    expect(bank.steps![1].files.map((f) => f.id)).toEqual(['old', 'b'])
    expect(bank.steps![1].files[1]).toMatchObject({ edited: true, captions: [{ text: 'Fixed' }] })
    // Its step learns how he says it.
    expect(bank.steps![1].heard).toEqual(['words of b'])
    // The next one; the last says Approve.
    expect(host.textContent).toContain('Clip 2 of 2')
    expect(host.querySelector('.review-name')?.textContent).toBe('a.mov')
    await click('Approve')
    expect(bank.steps![0].files.map((f) => f.id)).toEqual(['a'])
    expect(loadQueue('t')).toEqual([])
    expect(onClose).toHaveBeenCalled()
    // Claude checks each clip's captions by itself, once per clip.
    expect(seen.every((s) => s.hasRecheck)).toBe(true)
    expect(new Set(seen.map((s) => s.recheckKey))).toEqual(new Set(['drop:fp-b', 'drop:fp-a']))
  })

  it('one no step fits must be given a place first; Leave out lets its clip go', async () => {
    saveQueue('t', [clip('c', null, false), clip('d', 's2', true)])
    await render()
    expect(host.textContent).toContain('No step fits what it says')
    await click('Approve & next clip')
    expect(host.textContent).toContain('Pick where it goes, then Approve.')
    expect(loadQueue('t')).toHaveLength(2)
    await click('Leave out')
    await click('Leave it out')
    expect(retired).toEqual([['c']])
    expect(bank.steps!.flatMap((s) => s.files).map((f) => f.id)).not.toContain('c')
    expect(host.querySelector('.review-name')?.textContent).toBe('d.mov')
  })

  it('an edited clip takes the place of the one it was made from; the caption style he picks is the format’s', async () => {
    saveQueue('t', [clip('e', 's2', true, { replaces: 'old' })])
    await render()
    await click('Style')
    expect(formatNow.captionStyle).toBe('highlight')
    await click('Without captions')
    expect(bank.steps![1].files.map((f) => f.id)).toEqual(['e'])
    expect(bank.steps![1].files[0].captions).toEqual([])
    expect(retired).toEqual([['old']])
  })

  it('a hook goes in with his voice kept, as one of this format’s hooks', async () => {
    saveQueue('t', [clip('h', 'hook', true)])
    await render()
    await click('Approve')
    expect(bank.reactions).toEqual([expect.objectContaining({ id: 'h', formats: ['t'], talks: true, edited: true })])
  })
})

describe('looking again at where the clips of the batch are (his ask, 2026-11-14)', () => {
  const inBatch = (id: string) => ({ id, name: `${id}.mp4`, type: 'video/mp4', size: 1, fp: `fp-${id}` })
  const again = (id: string, place: string, extra: Partial<ToCheck> = {}): ToCheck => ({ ...clip(id, place, true), file: inBatch(id), recheck: true, ...extra })

  it('points out the step its words sound like; one tap moves it there, the clip otherwise as it was', async () => {
    bank.steps![1].files.push(inBatch('w'))
    saveQueue('t', [again('w', 's2', { sure: false, hint: 's1' })])
    await render()
    expect(host.textContent).toContain('Maybe the wrong step')
    expect(lit()).toBe('2Open the app')
    expect(host.querySelector('.drop-check-hint')?.textContent).toContain('Sounds like1Nope, do this instead')
    await click('Move it')
    expect(lit()).toBe('1Nope, do this instead')
    expect(host.querySelector('.drop-check-hint')).toBeNull()
    await click('Approve')
    expect(bank.steps![0].files).toEqual([{ ...inBatch('w'), captions: [{ text: 'Fixed', start: 0, end: 0.5 }], checked: true }])
    expect(bank.steps![1].files.map((f) => f.id)).toEqual(['old'])
    expect(bank.steps![0].heard).toEqual(['words of w'])
    expect(retired).toEqual([])
  })

  it('approved where it is, it stays there, checked; Take out takes it out of the batch', async () => {
    bank.steps![1].files.push(inBatch('x'))
    saveQueue('t', [again('old', 's2'), again('x', 's2')])
    await render()
    expect(host.textContent).not.toContain('Maybe the wrong step')
    await click('Approve & next clip')
    expect(bank.steps![1].files.map((f) => f.id)).toEqual(['old', 'x'])
    expect(bank.steps![1].files[0]).toMatchObject({ id: 'old', checked: true, captions: [{ text: 'Fixed' }] })
    expect(bank.steps![1].files[0].edited).toBeUndefined()
    await click('Take out')
    expect(host.textContent).toContain('Taken out of the batch.')
    await click('Take it out')
    expect(bank.steps![1].files.map((f) => f.id)).toEqual(['old'])
    expect(retired).toEqual([['x']])
  })

  it('one out of the batch by now is not shown; one never heard is heard first, then checked like the others', async () => {
    bank.steps![1].files.push(inBatch('u'))
    saveQueue('t', [again('gone', 's1'), again('u', 's2', { unheard: true, words: [], text: '' })])
    heardNow.mockClear()
    await render()
    await settle()
    expect(loadQueue('t').map((q) => q.file.id)).toEqual(['u'])
    expect(heardNow).toHaveBeenCalledTimes(1)
    expect(host.textContent).toContain('Clip 1 of 1')
    expect(seen.at(-1)).toMatchObject({ name: 'u.mov', initial: 'nope do this instead' })
    // What it says now sounds like another step.
    expect(host.textContent).toContain('Sounds like')
    await click('Approve')
    expect(bank.steps![1].files.find((f) => f.id === 'u')).toMatchObject({ checked: true, captions: [{ text: 'Fixed' }] })
    expect(bank.steps![1].heard).toEqual(['nope do this instead'])
  })

  it('no captions (Captions unticked, or no talking in it): only the clip and where it goes; in with none, kept as he cut it', async () => {
    // jsdom has no object URLs.
    URL.createObjectURL = () => 'blob:clip'
    URL.revokeObjectURL = () => {}
    saveQueue('t', [
      clip('mine', 's1', true, { noCaptions: true, file: { id: 'mine', name: 'mine.mov', type: 'video/quicktime', size: 1, ownCut: true } }),
      clip('shows', null, false, { text: '', words: [] }),
    ])
    await render()
    await settle()
    // Not the caption check: the clip itself. The one with no place first.
    expect(seen).toHaveLength(0)
    expect(host.querySelector('video.drop-check-video')).not.toBeNull()
    expect(host.textContent).toContain('No talking in it - pick the step it shows.')
    expect(host.textContent).toContain('No talking in it - it goes in as it is, no captions.')
    await click('Open the app')
    await click('Approve & next clip')
    expect(bank.steps![1].files.at(-1)).toMatchObject({ id: 'shows', captions: [] })
    await settle()
    expect(host.textContent).toContain('No captions on it - you unticked them for these clips.')
    await click('Approve')
    expect(bank.steps![0].files.at(-1)).toMatchObject({ id: 'mine', ownCut: true, captions: [], checked: true })
    expect(bank.steps![0].files.at(-1)!.edited).toBeUndefined()
  })

  it('Mirror: as it was dropped in, changed with one tap - the picture flipped on the check, the clip mirrored in the batch', async () => {
    saveQueue('t', [clip('a', 's1', true, { file: { id: 'a', name: 'a.mp4', type: 'video/mp4', size: 1, edited: true, mirror: true } }), clip('b', 's1', true)])
    await render()
    await settle()
    expect(button('Mirrored').getAttribute('aria-pressed')).toBe('true')
    expect(host.querySelector('.drop-check-screen.mirrored')).not.toBeNull()
    await click('Approve & next clip')
    expect(bank.steps![0].files.at(-1)).toMatchObject({ id: 'a', mirror: true })
    await settle()
    // The next one wasn't: mirrored here with a tap.
    expect(host.querySelector('.drop-check-screen.mirrored')).toBeNull()
    await click('Mirror')
    expect(host.querySelector('.drop-check-screen.mirrored')).not.toBeNull()
    await click('Approve')
    expect(bank.steps![0].files.at(-1)).toMatchObject({ id: 'b', mirror: true })
  })

  it('Timeline (his ask, 2026-11-14): the parts kept from its recording; Done makes the clip again in its place - its recording stays with the clip once checked (2026-11-15)', async () => {
    const source = {
      fileId: 'src-1',
      size: 5,
      type: 'video/quicktime',
      keep: [{ start: 1, end: 2 }],
      words: [{ text: 'hi', start: 0.6, end: 0.9 }],
      duration: 3,
      effects: { cutPunch: 'off', hookPush: 'off', brandHit: 'off', logoPop: false } as const,
      brandWords: [],
      voice: true,
      seed: 'fp-rec',
    }
    saveQueue('t', [clip('a', 's1', true, { source })])
    await render()
    await settle()
    await click('Timeline editor')
    await settle()
    expect(document.body.querySelector('.timeline-parts')?.textContent).toBe('[{"start":1,"end":2}]')
    await click('Done')
    await settle()
    // Made again from the recording, the first part half a second longer, with its own seed.
    expect(recuts).toEqual([{ keep: [{ start: 0.5, end: 2 }], seed: 'fp-rec' }])
    const [q] = loadQueue('t')
    expect(q.file.id).not.toBe('a')
    expect(q).toMatchObject({ text: 'longer', file: { name: 'a.mp4', fp: 'fp-again', seconds: 2.5 }, source: { keep: [{ start: 0.5, end: 2 }] } })
    // The clip made before was only in the check: let go.
    expect(retired).toContainEqual(['a'])
    // Back on the check, with the new clip: approved into the batch, its
    // recording kept with it - to make it longer or faster later.
    expect(document.body.querySelector('.timeline-stub')).toBeNull()
    await click('Approve')
    expect(bank.steps![0].files.at(-1)!.id).toBe(q.file.id)
    expect(bank.steps![0].files.at(-1)!.source).toMatchObject({ fileId: 'src-1', keep: [{ start: 0.5, end: 2 }] })
    expect(retired.flat()).not.toContain('src-1')
  })

  it("a clip of the batch with no recording kept: trimmed from the clip itself, swapped in the batch (his ask, 2026-11-15)", async () => {
    bank.steps![0].files.push({ id: 'old', name: 'old.mp4', type: 'video/mp4', size: 1, fp: 'fp-old', edited: true, seconds: 3, captions: [{ text: 'hi', start: 0.2, end: 0.5 }] })
    saveQueue('t', [clip('old', 's1', true, { recheck: true })])
    await render()
    await settle()
    await click('Timeline editor')
    await settle()
    // The clip itself, whole, is its timeline.
    expect(document.body.querySelector('.timeline-parts')?.textContent).toBe('[{"start":0,"end":3}]')
    await click('Done')
    await settle()
    expect(recuts).toHaveLength(1)
    const now = bank.steps![0].files.find((f) => f.fp === 'fp-again')
    expect(now).toBeDefined()
    expect(bank.steps![0].files.some((f) => f.id === 'old')).toBe(false)
    // The old clip is kept as the new one's source, not let go.
    expect(now!.source).toMatchObject({ fileId: 'old', self: true })
    expect(retired.flat()).not.toContain('old')
  })

  it('each clip cut by the Cutter or kept raw, from its recording (his ask, 2026-11-15)', async () => {
    cutCalls.length = 0
    const source = {
      fileId: 'src-1',
      size: 5,
      type: 'video/quicktime',
      keep: [{ start: 0.5, end: 2 }],
      words: [],
      duration: 3,
      effects: { cutPunch: 'off', hookPush: 'off', brandHit: 'off', logoPop: false } as const,
      brandWords: [],
      voice: true,
      seed: 'fp-rec',
    }
    saveQueue('t', [clip('a', 's1', true, { source })])
    await render()
    await settle()
    const radio = (label: string) => [...host.querySelectorAll('[aria-label="Cut by the Cutter or kept raw"] button')].find((b) => b.textContent === label) as HTMLButtonElement
    expect(radio('Cut').getAttribute('aria-checked')).toBe('true')
    await act(async () => radio('Raw').click())
    await settle()
    expect(cutCalls).toEqual([{ asFilmed: true, seed: 'fp-rec' }])
    const [q] = loadQueue('t')
    expect(q.file).toMatchObject({ ownCut: true, fp: 'fp-again' })
    expect(q.file.edited).toBeUndefined()
    expect(q.text).toBe('whole')
    expect(q.source).toMatchObject({ fileId: 'src-1', keep: [{ start: 0, end: 3 }] })
    expect(radio('Raw').getAttribute('aria-checked')).toBe('true')
    // And back: cut again from the same recording.
    await act(async () => radio('Cut').click())
    await settle()
    expect(cutCalls[1]).toEqual({ asFilmed: false, seed: 'fp-rec' })
    expect(loadQueue('t')[0].file).toMatchObject({ edited: true })
  })

  it('every clip has its Timeline editor at the bottom - one with no recording kept too (his ask, 2026-11-15)', async () => {
    saveQueue('t', [clip('a', 's1', true)])
    await render()
    await settle()
    expect(button('Timeline editor')).toBeDefined()
  })

  it('opens on the clip he asked for (the quick look’s Re-edit)', async () => {
    saveQueue('t', [clip('a', 's1', false), clip('b', 's1', true), clip('c', 's1', true)])
    await act(async () =>
      root.render(
        <DropCheck format={formatNow} steps={bank.steps!} campaign={campaign} getBank={() => bank} keep={(next) => void (bank = next)} onFormat={() => {}} startWith="c" onClose={onClose} />,
      ),
    )
    await settle()
    expect(host.querySelector('.review-name')?.textContent).toBe('c.mov')
  })
})

