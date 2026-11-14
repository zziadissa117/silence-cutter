// The campaign tracker on the Videos tab (his ask, 2026-11-14): campaigns on
// the left by their whole name, the week from Monday on top, a box a day.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { TrackerWeek } from './posting'

const loadWeek = vi.fn<(weeks: number) => Promise<TrackerWeek>>()

vi.mock('./store', async (original) => {
  const real = await original<Record<string, unknown>>()
  return { ...real, loadBatchBank: vi.fn(async () => null) }
})
vi.mock('./posting', async (original) => {
  const real = await original<Record<string, unknown>>()
  return { ...real, loadWeek: (weeks: number) => loadWeek(weeks) }
})

import type { Campaign } from './look'
import { WeekTracker } from './WeekTracker'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const DAYS = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15']
const none = { posted: 0, scheduled: 0, waiting: 0, failed: 0, batch: 0 }

const week = (days = DAYS): TrackerWeek => ({
  days,
  today: '2026-11-14',
  campaigns: [
    { id: 'cantina', name: 'Cantina', before: 0, days: days.map((_, i) => (i === 5 ? { ...none, posted: 1, scheduled: 1 } : i === 6 ? { ...none, scheduled: 2 } : none)) },
    { id: 'coverd', name: 'Coverd', before: 0, days: days.map((_, i) => (i === 0 ? { ...none, posted: 1 } : none)) },
    { id: 'tailgate', name: 'Tailgate', before: 3, days: days.map(() => none) },
  ],
})

const campaign = (id: string, name: string) => ({ id, name, logo: null, brandWords: [], angles: [] }) as unknown as Campaign

let root: Root
let host: HTMLDivElement

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  localStorage.clear()
  loadWeek.mockReset()
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function show() {
  await act(async () => {
    root.render(<WeekTracker campaigns={[campaign('cantina', 'Cantina'), campaign('coverd', 'Coverd'), campaign('tailgate', 'Tailgate')]} />)
  })
}

describe('the campaign tracker', () => {
  it('a line per campaign by its whole name, a box a day: the number, its colour, in words', async () => {
    loadWeek.mockResolvedValue(week())
    await show()
    expect(loadWeek).toHaveBeenCalledWith(0)
    expect(host.querySelector('.section-title')?.textContent).toBe('This week')
    expect(host.querySelector('.tracker-range')?.textContent).toBe('Nov 9 – 15')
    expect([...host.querySelectorAll('.tracker-label')].map((n) => n.textContent)).toEqual(['Cantina', 'Coverd', 'Tailgate'])
    const sat = host.querySelector<HTMLButtonElement>('.tracker-box[aria-label^="Cantina, Saturday"]')!
    expect(sat.textContent).toBe('2')
    expect(sat.getAttribute('aria-label')).toBe('Cantina, Saturday, Nov 14: 1 posted · 1 scheduled')
    expect(sat.dataset.ink).toBe('mixed')
    expect(host.querySelector<HTMLButtonElement>('.tracker-box[aria-label^="Coverd, Monday"]')!.dataset.ink).toBe('posted')
    expect(host.querySelector<HTMLButtonElement>('.tracker-box[aria-label^="Cantina, Sunday"]')!.dataset.ink).toBe('scheduled')
    // Nothing set on a day to come: an open box.
    expect(host.querySelector('.tracker-box[aria-label^="Coverd, Sunday"]')!.classList.contains('open')).toBe(true)
    // Went quiet: under the others, dimmed.
    expect(host.querySelectorAll('.tracker-line.quiet')).toHaveLength(1)
    expect([...host.querySelectorAll('.tracker-total')].map((n) => n.textContent)).toEqual(['1', '–', '–', '–', '–', '2', '2'])
  })

  it('a tapped box says it in words; the arrows go to the next week', async () => {
    loadWeek.mockResolvedValue(week())
    await show()
    await act(async () => host.querySelector<HTMLButtonElement>('.tracker-box[aria-label^="Cantina, Sunday"]')!.click())
    expect(host.querySelector('.tracker-picked')?.textContent).toContain('2 scheduled')
    const next = DAYS.map((d) => `2026-11-${Number(d.slice(8)) + 7}`)
    loadWeek.mockResolvedValue(week(next))
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="The week after"]')!.click())
    expect(loadWeek).toHaveBeenLastCalledWith(1)
    expect(host.querySelector('.section-title')?.textContent).toBe('Next week')
    expect(host.querySelector('.tracker-range')?.textContent).toBe('Nov 16 – 22')
    expect(host.querySelector('.tracker-picked')).toBeNull()
  })

  it('kept for next time; nothing at all from a server that has no tracker yet', async () => {
    loadWeek.mockRejectedValue(new Error('Unknown action'))
    await show()
    expect(host.innerHTML).toBe('')
    localStorage.setItem('cutter.week', JSON.stringify(week()))
    act(() => root.unmount())
    root = createRoot(host)
    await show()
    expect(host.querySelectorAll('.tracker-line')).toHaveLength(3)
  })
})
