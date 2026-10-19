// The Batch tab's Start button: one tap, and the batch keeps going - as many
// videos a day as he picks, whatever times the campaign has.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { BatchBank } from './batch'

const bank: BatchBank = {
  campaignId: 'inflow',
  angleId: 'a1',
  reactions: [1, 2, 3].map((i) => ({ id: `r${i}`, name: `r${i}.mp4`, type: 'video/mp4', size: 1e6 })),
  products: [1, 2, 3].map((i) => ({ id: `p${i}`, name: `p${i}.mp4`, type: 'video/mp4', size: 1e6 })),
  headlines: ['one', 'two', 'three'],
  music: [],
  perDay: 3,
  days: 2,
  used: {},
}

let storedBank: BatchBank = bank

vi.mock('./store', async (original) => {
  const real = await original<Record<string, unknown>>()
  const stubs = Object.fromEntries(Object.keys(real).map((key) => [key, typeof real[key] === 'function' ? vi.fn(async () => undefined) : real[key]]))
  return { ...stubs, loadBatchBank: vi.fn(async () => structuredClone(storedBank)), saveBatchBank: vi.fn(async () => undefined) }
})

vi.mock('./posting', async (original) => {
  const real = await original<Record<string, unknown>>()
  return {
    ...real,
    // The server's posts: whatever the test left as the last copy seen.
    listPosts: vi.fn(async () => JSON.parse(localStorage.getItem('cutter.posts') ?? '[]')),
    stopPostsNow: vi.fn(async (posts: unknown[]) => ({ stopped: posts.length, unposting: 0, failed: [] })),
  }
})

import { BatchView } from './BatchView'
import type { Job } from './jobs'
import type { Campaign } from './look'
import type { CampaignPlace, LocalPosting } from './posting'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLElement
let root: Root

beforeEach(() => {
  storedBank = bank
  localStorage.clear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const campaign = { id: 'inflow', name: 'Inflow', angles: [{ id: 'a1', name: 'Main', headline: { style: 'box' } }] } as unknown as Campaign

function posting(place: Partial<CampaignPlace>): LocalPosting {
  return {
    sendHere: true,
    profile: {
      id: 'p1',
      accounts: [{ id: 'tt', name: 'Inflow', platform: 'tiktok', profile: 'inflow', picture: '', disabled: false }],
      settings: { campaigns: { inflow: { accounts: ['tt'], times: [], ...place } } },
      timezone: 'America/Toronto',
      hasAnthropic: true,
      vapidPublic: null,
    },
  }
}

async function show(place: Partial<CampaignPlace>, jobs: Job[] = [], onMake = vi.fn()) {
  const render = (list: Job[]) =>
    root.render(<BatchView campaigns={[campaign]} posting={posting(place)} jobs={list} onMake={onMake} onRetry={() => {}} onRemove={() => {}} />)
  await act(async () => render(jobs))
  return { onMake, rerender: (list: Job[]) => act(async () => render(list)) }
}

const makeButton = () => host.querySelector('.batch-make') as HTMLButtonElement

const savedBank = async () => {
  const { saveBatchBank } = await import('./store')
  return (saveBatchBank as unknown as { mock: { calls: [BatchBank][] } }).mock.calls.at(-1)![0]
}

const iso = (offset: number) => {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return d.toLocaleDateString('en-CA')
}

/** Long enough for a top-up that waits a moment after the last change. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 1400)))

describe('the Start button', () => {
  it('starts once however fast it is tapped twice, and makes the next week', async () => {
    const { onMake } = await show({})
    expect(makeButton().disabled).toBe(false)
    await act(async () => {
      makeButton().click()
      makeButton().click()
    })
    expect(onMake).toHaveBeenCalledTimes(1)
    expect(makeButton().disabled).toBe(true)
    expect(makeButton().textContent).toBe('Running · 3 a day')
    const videos = onMake.mock.calls[0][2] as { batch: { date: string } }[]
    // Today's times still an hour away, then six whole days of 3.
    expect(videos.filter((v) => v.batch.date > iso(0))).toHaveLength(18)
    expect(videos.every((v) => v.batch.date <= iso(6))).toBe(true)
    const saved = await savedBank()
    expect(saved.running).toBe(true)
    expect(saved.filled?.[iso(6)]).toBe(3)
  })

  it("stays busy, counting, while this campaign's batch is made", async () => {
    const job = (id: string) => ({ id, campaignId: 'inflow', status: 'queued', batch: { id: 'b1', date: '2099-01-01', time: '10:00', size: 6 } }) as unknown as Job
    await show({}, [job('1'), job('2'), job('3'), job('4')])
    expect(makeButton().disabled).toBe(true)
    expect(makeButton().textContent).toBe('Making 3 of 6…')
  })

  it('says it keeps going, with no days to pick', async () => {
    await show({})
    expect(makeButton().textContent).toBe('Start · 3 a day')
    expect(host.textContent).toContain('Makes the next 7 days now, then keeps going on its own')
    expect(host.textContent).not.toContain('Days')
    // 3 reactions x 3 products x 3 headlines, at 3 a day.
    expect(host.querySelector('.batch-variations')?.textContent).toBe('27 variations3 reactions × 3 product showcases × 3 headlinesNone made yet - 9 days at 3 a day.')
  })

  it('stops when he says', async () => {
    storedBank = { ...bank, running: true, filled: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [iso(d), 3])) }
    const { onMake } = await show({})
    const stop = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Stop') as HTMLButtonElement
    await act(async () => stop.click())
    expect((await savedBank()).running).toBe(false)
    expect(makeButton().textContent).toBe('Start · 3 a day')
    expect(onMake).not.toHaveBeenCalled()
  })
})

describe('videos a day', () => {
  const more = () => host.querySelector('[aria-label="More a day"]') as HTMLButtonElement
  const value = () => (host.querySelector('[aria-label="Videos a day"]') as HTMLInputElement | null)?.value
  const upTo = async (n: number) => {
    while (Number(value()) < n) await act(async () => more().click())
  }

  it('goes up to 25 for a campaign with a single time of its own, keeping his time', async () => {
    await show({ times: ['18:00'] })
    await upTo(25)
    expect(value()).toBe('25')
    expect(more().disabled).toBe(true)
    expect(host.textContent).toContain('At your times and random ones in between')
    expect(host.querySelector('.stepper + .hint')?.textContent).toMatch(/6(:00)? PM/)
  })

  it("goes past a random campaign's 3 a day, all 25 inside the window", async () => {
    await show({ window: { from: '10:00', to: '22:00', perDay: 3 } })
    await upTo(25)
    expect(host.textContent).not.toContain('only fits')
  })

  it('says when the window is too short for that many', async () => {
    await show({ window: { from: '12:00', to: '13:00', perDay: 2 } })
    await upTo(10)
    expect(host.textContent).toContain('The window only fits 6 a day')
  })
})

describe('the "Claude + X" hook', () => {
  const logo = (id: string, name: string) => ({ id, name, type: 'image/png', size: 1000 })

  it('needs both logos instead of headlines', async () => {
    storedBank = { ...bank, headlines: [], hook: 'formula', formula: { left: logo('l', 'claude.png'), right: null, min: 500, max: 1000 } }
    await show({})
    expect(makeButton().disabled).toBe(true)
    expect(host.textContent).toContain('Add both logos first.')
  })

  it('gives every video the same two logos and its own amount, with no headline needed', async () => {
    storedBank = { ...bank, headlines: [], hook: 'formula', formula: { left: logo('l', 'claude.png'), right: logo('r', 'openart-logo.png'), min: 500, max: 1000 } }
    const { onMake } = await show({})
    await act(async () => makeButton().click())
    expect(onMake).toHaveBeenCalledTimes(1)
    const videos = onMake.mock.calls[0][2] as { headline: string; formula?: { left: { id: string }; right: { id: string }; line: string } }[]
    expect(videos.length).toBeGreaterThan(1)
    for (const v of videos) {
      expect(v.formula?.left.id).toBe('l')
      expect(v.formula?.right.id).toBe('r')
      expect(v.formula?.line).toMatch(/^\$(\d{3}|1,000)( a day|\/day| per day| daily)$/)
      expect(v.headline).toBe(`Claude + Openart = ${v.formula?.line}`)
    }
  })
})

describe('a batch that keeps going', () => {
  const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
  const post = (offset: number, hhmm: string) => {
    const d = new Date()
    d.setDate(d.getDate() + offset)
    d.setHours(Number(hhmm.slice(0, 2)), Number(hhmm.slice(3, 5)), 0, 0)
    return { id: `${offset}-${hhmm}`, campaignId: 'inflow', status: 'scheduled', postAt: d.toISOString() }
  }
  const scheduled = [1, 2, 3].flatMap((o) => [post(o, '12:00'), post(o, '14:30')])
  const week = (n: number) => Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [iso(d), n]))

  beforeEach(() => {
    localStorage.setItem('cutter.posts', JSON.stringify(scheduled))
  })

  it('makes nothing while the week ahead is full', async () => {
    storedBank = { ...bank, perDay: 2, running: true, filled: week(2) }
    const { onMake } = await show({})
    await settle()
    expect(onMake).not.toHaveBeenCalled()
    expect(makeButton().textContent).toBe('Running · 2 a day')
  })

  it('tops up the days already made when he picks more a day, clear of their times', async () => {
    storedBank = { ...bank, perDay: 2, running: true, filled: week(2) }
    const { onMake } = await show({})
    await act(async () => (host.querySelector('[aria-label="More a day"]') as HTMLButtonElement).click())
    await settle()
    expect(onMake).toHaveBeenCalledTimes(1)
    const videos = onMake.mock.calls[0][2] as { batch: { date: string; time: string } }[]
    // One more on each day still to come.
    expect(videos.filter((v) => v.batch.date > iso(0)).map((v) => v.batch.date)).toEqual([1, 2, 3, 4, 5, 6].map(iso))
    for (const v of videos) {
      for (const p of scheduled.filter((x) => new Date(x.postAt).toLocaleDateString('en-CA') === v.batch.date)) {
        const t = new Date(p.postAt)
        expect(Math.abs(t.getHours() * 60 + t.getMinutes() - minutes(v.batch.time))).toBeGreaterThanOrEqual(20)
      }
    }
    expect((await savedBank()).filled?.[iso(6)]).toBe(3)
  })

  it('carries on after days made before it kept going, without making them again', async () => {
    storedBank = { ...bank, perDay: 3, running: true, madeThrough: iso(3), lastPerDay: 3 }
    const { onMake } = await show({})
    await settle()
    expect(onMake).toHaveBeenCalledTimes(1)
    const videos = onMake.mock.calls[0][2] as { batch: { date: string } }[]
    expect(videos.map((v) => v.batch.date)).toEqual([4, 4, 4, 5, 5, 5, 6, 6, 6].map(iso))
  })
})

describe('changing the number while it runs', () => {
  const week = (n: number) => Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [iso(d), n]))
  const times = ['12:00', '14:00', '16:00', '18:00', '20:00']
  const posts = [1, 2, 3, 4, 5, 6].flatMap((d) =>
    times.map((t, i) => {
      const at = new Date(`${iso(d)}T${t}:00`)
      return { id: `${d}-${i}`, key: `k${d}-${i}`, campaignId: 'inflow', status: 'scheduled', postAt: at.toISOString(), batch: { id: 'b', date: iso(d), time: t, size: 30 } }
    }),
  )
  const field = () => host.querySelector('[aria-label="Videos a day"]') as HTMLInputElement
  const type = async (text: string) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
      set.call(field(), text)
      field().dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  beforeEach(async () => {
    localStorage.setItem('cutter.posts', JSON.stringify(posts))
    const { stopPostsNow } = await import('./posting')
    vi.mocked(stopPostsNow).mockClear()
  })

  it('takes the extra videos back out of the days ahead when he lowers it', async () => {
    storedBank = { ...bank, perDay: 5, running: true, filled: { ...week(5), [iso(0)]: 0 } }
    const { onMake } = await show({})
    await type('2')
    await settle()
    const { stopPostsNow } = await import('./posting')
    const stopped = vi.mocked(stopPostsNow).mock.calls[0][0] as { batch: { date: string } }[]
    // 3 of the 5 on each of the 6 days ahead.
    expect(stopped).toHaveLength(18)
    expect((await savedBank()).filled?.[iso(3)]).toBe(2)
    // Nothing new is made for the days it just lowered.
    expect(onMake.mock.calls.flatMap((c) => c[2] as { batch: { date: string } }[]).filter((v) => v.batch.date > iso(0))).toEqual([])
  })

  it('pauses at 0: everything not out yet comes out, and nothing more is made', async () => {
    storedBank = { ...bank, perDay: 5, running: true, filled: { ...week(5), [iso(0)]: 0 } }
    const { onMake } = await show({})
    await type('0')
    await settle()
    const { stopPostsNow } = await import('./posting')
    expect(vi.mocked(stopPostsNow).mock.calls[0][0]).toHaveLength(30)
    expect(makeButton().textContent).toBe('Paused · 0 a day')
    expect(host.textContent).toContain('Paused: nothing more goes out until you raise it.')
    expect(onMake).not.toHaveBeenCalled()
  })

  it('goes straight to any number he types', async () => {
    // Enough different videos for a week at 25.
    storedBank = { ...bank, headlines: Array.from({ length: 30 }, (_, i) => `line ${i}`), perDay: 2, running: true, filled: week(2) }
    const { onMake } = await show({})
    await type('2')
    await type('25')
    await settle()
    expect(field().value).toBe('25')
    expect((await savedBank()).perDay).toBe(25)
    expect(onMake).toHaveBeenCalledTimes(1)
    // Typing 2 then 5 made one top-up, for 25 a day.
    const videos = onMake.mock.calls[0][2] as { batch: { date: string } }[]
    expect(videos.filter((v) => v.batch.date === iso(6)).length).toBe(23)
  })
})

describe("the batch's hooks: headline looks and Claude + X, in shares", () => {
  const look = (label: string) =>
    [...host.querySelectorAll('[aria-label="Hook looks"] [role="checkbox"]')].find((b) => b.textContent === label) as HTMLButtonElement
  const share = (label: string) => [...host.querySelectorAll('.look-share')].find((li) => li.querySelector('.look-share-name')?.textContent === label)
  const press = (label: string) => act(async () => (host.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement).click())
  const logo = (id: string, name: string) => ({ id, name, type: 'image/png', size: 1000 })

  it("starts as the angle's; tapping more makes the videos take turns, and one always stays", async () => {
    await show({})
    expect(look('White box').getAttribute('aria-checked')).toBe('true')
    expect(host.querySelector('.look-shares')).toBeNull()
    await act(async () => look('Snapchat').click())
    expect((await savedBank()).looks).toEqual([
      { look: 'box', parts: 1 },
      { look: 'snap', parts: 1 },
    ])
    await act(async () => look('Outline').click())
    expect(host.textContent).toContain('The videos take turns in these shares, the same headlines in each look.')
    // The 27 different videos in each of the 3 looks.
    expect(host.querySelector('.batch-variations .label')?.textContent).toBe('81 variations')
    expect(host.querySelector('.batch-variations')?.textContent).toContain('× 3 headline looks')
    await act(async () => look('White box').click())
    await act(async () => look('Outline').click())
    expect((await savedBank()).looks).toEqual([{ look: 'snap', parts: 1 }])
    await act(async () => look('Snapchat').click())
    expect(look('Snapchat').getAttribute('aria-checked')).toBe('true')
  })

  it('gives one more of the videos with +, shown as a share', async () => {
    storedBank = { ...bank, looks: [{ look: 'box', parts: 1 }, { look: 'outline', parts: 1 }, { look: 'snap', parts: 1 }] }
    await show({})
    expect(share('Snapchat')?.querySelector('.look-share-pct')?.textContent).toBe('33%')
    await press('More Snapchat')
    expect(share('Snapchat')?.querySelector('.look-share-pct')?.textContent).toBe('50%')
    expect(share('Outline')?.querySelector('.look-share-pct')?.textContent).toBe('25%')
    expect((await savedBank()).looks).toEqual([
      { look: 'box', parts: 1 },
      { look: 'outline', parts: 1 },
      { look: 'snap', parts: 2 },
    ])
    await press('Less Snapchat')
    expect((await savedBank()).looks?.find((l) => l.look === 'snap')?.parts).toBe(1)
  })

  it('takes Claude + X in among the headlines: both are asked for, and the videos come in their shares', async () => {
    await show({})
    await act(async () => look('Claude + X').click())
    // The headlines stay, and the logos are asked for too.
    expect(host.querySelector('[aria-label="Headlines, one a line"]')).not.toBeNull()
    expect(host.querySelector('[aria-label="Left logo"]')).not.toBeNull()
    expect(host.textContent).toContain('Add both logos first.')

    storedBank = {
      ...bank,
      looks: [
        { look: 'snap', parts: 2 },
        { look: 'formula', parts: 1 },
      ],
      formula: { left: logo('l', 'claude.png'), right: logo('r', 'openart-logo.png'), min: 500, max: 1000 },
    }
    act(() => root.unmount())
    root = createRoot(host)
    const { onMake } = await show({})
    await act(async () => makeButton().click())
    const videos = onMake.mock.calls[0][2] as { headline: string; headlineStyle?: string; formula?: { line: string } }[]
    const formula = videos.filter((v) => v.formula)
    const snap = videos.filter((v) => v.headlineStyle === 'snap')
    expect(formula.length + snap.length).toBe(videos.length)
    expect(Math.abs(snap.length - 2 * formula.length)).toBeLessThanOrEqual(2)
    for (const v of formula) expect(v.headline).toBe(`Claude + Openart = ${v.formula!.line}`)
    for (const v of snap) expect(bank.headlines).toContain(v.headline)
  })
})

describe('a clip already in videos made before', () => {
  it('is not taken back in, and he is told why', async () => {
    const { fingerprint } = await import('./fingerprint')
    const file = new File([new Uint8Array(4096).fill(7)], 'old-reaction.mov', { type: 'video/quicktime' })
    storedBank = { ...bank, usedClips: [await fingerprint(file)] }
    await show({})
    const input = host.querySelector('input[aria-label="Add reactions"]') as HTMLInputElement
    Object.defineProperty(input, 'files', { value: [file] })
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
    // Reading what is in the file takes a moment.
    await act(async () => new Promise((resolve) => setTimeout(resolve, 200)))
    expect(host.textContent).toContain('old-reaction.mov was already in videos you made')
    const { saveBankFile } = await import('./store')
    expect(saveBankFile).not.toHaveBeenCalled()
  })
})
