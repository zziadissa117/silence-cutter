import { describe, expect, it, vi } from 'vitest'

vi.mock('./store', () => ({ loadBankFile: vi.fn(), saveBankFile: vi.fn(), retireBankFiles: vi.fn() }))
vi.mock('./talkLink', () => ({ downloadFile: vi.fn() }))

import type { BankFile, BatchBank, BatchStep } from './batch'
import type { ToCheck } from './dropQueue'
import { approveMatches, scriptMatches } from './ScriptCheck'

const file = (id: string): BankFile => ({ id, name: `${id}.mp4`, type: 'video/mp4', size: 1, fp: `fp-${id}` })
const heard = (text: string) => text.split(' ').map((t, i) => ({ text: t, start: i, end: i + 0.8 }))
const item = (id: string, place: string, text: string, more: Partial<ToCheck> = {}): ToCheck => ({ file: file(id), name: `${id}.mov`, text, words: heard(text), place, sure: true, ...more })

const steps: BatchStep[] = [
  { id: 's1', name: 'Open ChatGPT', files: [], script: 'Go to ChatGPT and paste this prompt.' },
  { id: 's2', name: 'Sign up', files: [] },
]

describe('clips that match their caption script, approved at once (his ask, 2026-11-15)', () => {
  it('only clips in a step with a script, heard, matching it once lined up', () => {
    const queue = [
      item('a', 's1', 'go to chat GPT and paste this prompt'),
      item('b', 's1', 'go to claude and paste this prompt'),
      item('c', 's2', 'sign up with your email'),
      item('d', 's1', 'go to chatgpt and paste this prompt', { noCaptions: true }),
      item('e', 's1', '', { unheard: true, words: [] }),
    ]
    const found = scriptMatches(queue, steps)
    expect(found.map((m) => m.item.file.id)).toEqual(['a'])
    expect(found[0].words.map((w) => w.text).join(' ')).toBe('Go to ChatGPT and paste this prompt.')
  })

  it("Approve all: each in its step, with the script's captions, checked; a clip it replaces let go", () => {
    const bank = { reactions: [], products: [], used: {}, steps: [{ ...steps[0], files: [file('old')] }, steps[1]] } as unknown as BatchBank
    const matches = scriptMatches([item('a', 's1', 'go to GPT and paste this prompt', { replaces: 'old' })], steps)
    const { bank: next, retire } = approveMatches(bank, 'f', matches)
    const s1 = next.steps!.find((s) => s.id === 's1')!
    expect(s1.files.map((f) => f.id)).toEqual(['a'])
    expect(s1.files[0]).toMatchObject({ checked: true, edited: true })
    expect(s1.files[0].captions!.map((w) => w.text).join(' ')).toBe('Go to ChatGPT and paste this prompt.')
    expect(retire).toEqual(['old'])
  })
})
