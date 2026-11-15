// The Batch tab's Start button: one tap, and the batch keeps going - as many
// videos a day as he picks, whatever times the campaign has.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { BatchBank } from './batch'
import { AHEAD_DAYS } from './batchRun'

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

async function show(place: Partial<CampaignPlace>, jobs: Job[] = [], onMake = vi.fn(), onRemove: (id: string) => void = () => {}) {
  const render = (list: Job[]) =>
    root.render(<BatchView campaigns={[campaign]} posting={posting(place)} jobs={list} onMake={onMake} onRetry={() => {}} onRemove={onRemove} />)
  await act(async () => render(jobs))
  return { onMake, rerender: (list: Job[]) => act(async () => render(list)) }
}

const makeButton = () => host.querySelector('.batch-make') as HTMLButtonElement

/** Opens the first format's card. */
const openFirstFormat = async () => {
  const card = host.querySelector('.format-head') as HTMLButtonElement
  await act(async () => card.click())
}

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
  it('starts once however fast it is tapped twice, and makes the days ahead', async () => {
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
    // Today's times still an hour away, then the whole days ahead, 3 each.
    expect(videos.filter((v) => v.batch.date > iso(0))).toHaveLength(3 * (AHEAD_DAYS - 1))
    expect(videos.every((v) => v.batch.date <= iso(AHEAD_DAYS - 1))).toBe(true)
    const saved = await savedBank()
    expect(saved.running).toBe(true)
    expect(saved.filled?.[iso(AHEAD_DAYS - 1)]).toBe(3)
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
    expect(host.textContent).toContain(`Makes the next ${AHEAD_DAYS} days now, then keeps going on its own`)
    // No number of days to pick (the old Days field).
    expect(host.querySelector('[aria-label="Days"]')).toBeNull()
    expect(host.textContent).not.toContain('Days ahead')
    // 3 reactions x 3 products x 3 headlines, at 3 a day.
    expect(host.querySelector('.batch-variations')?.textContent).toBe('27 variations3 reactions × 3 product showcases × 3 headlinesNone made yet - 9 days at 3 a day.')
  })

  it('posts on the days he lights, the same number on each, nothing on the others (his asks, 2026-11-14)', async () => {
    await show({})
    const radio = (name: string) => [...host.querySelectorAll('[role="radio"]')].find((b) => b.textContent === name) as HTMLButtonElement
    const day = (name: string) => host.querySelector(`.week-days button[aria-label="${name}"]`) as HTMLButtonElement
    await act(async () => radio('Some days').click())
    let saved = await savedBank()
    // Monday, Wednesday and Friday lit to start with - exactly what it posts on.
    expect(saved.week).toEqual({ days: [1, 3, 5], each: 1 })
    expect([...host.querySelectorAll('.week-days button[aria-pressed="true"]')].map((b) => b.getAttribute('aria-label'))).toEqual(['Monday', 'Wednesday', 'Friday'])
    expect(host.querySelector('.week-summary')?.textContent).toBe('3 videos a weekOne on Monday, Wednesday and Friday.')
    expect(makeButton().textContent).toBe('Start · 3 a week')
    // Friday off, Thursday on: a day tapped is added or taken away, nothing else moves.
    await act(async () => day('Friday').click())
    await act(async () => day('Thursday').click())
    saved = await savedBank()
    expect(saved.week).toEqual({ days: [1, 3, 4], each: 1 })
    expect(host.querySelector('.week-summary')?.textContent).toBe('3 videos a weekOne on Monday, Wednesday and Thursday.')
    await act(async () => (host.querySelector('[aria-label="More on each day"]') as HTMLButtonElement).click())
    expect(host.querySelector('.week-summary')?.textContent).toBe('6 videos a week2 on Monday, Wednesday and Thursday.')
    // Back to every day, the days kept for next time.
    await act(async () => radio('Every day').click())
    saved = await savedBank()
    expect(saved.week).toEqual({ days: [1, 3, 4], each: 2, off: true })
    expect(makeButton().textContent).toBe('Start · 3 a day')
    await act(async () => radio('Some days').click())
    expect((await savedBank()).week).toEqual({ days: [1, 3, 4], each: 2 })
  })

  it('stops when he says', async () => {
    storedBank = { ...bank, running: true, filled: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [iso(d), 3])) }
    const { onMake } = await show({})
    const stop = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Stop') as HTMLButtonElement
    await act(async () => stop.click())
    expect((await savedBank()).running).toBe(false)
    expect(makeButton().textContent).toBe('Start · 3 a day')
    expect(onMake).not.toHaveBeenCalled()
    await settle()
  })

  // His friend, 2026-10-24: Stop stopped the next top-up only, and the week
  // already queued went on being made, video after video.
  const job = (id: string, status: Job['status'], offset: number) =>
    ({ id, campaignId: 'inflow', status, name: 'r1 + p1.mp4', headlineText: 'one', batch: { id: 'b1', date: iso(offset), time: '12:00', size: 4 } }) as unknown as Job

  it('stops at once: the videos waiting to be made come out, the one being made is finished', async () => {
    storedBank = { ...bank, running: true, filled: { [iso(1)]: 2, [iso(2)]: 2 } }
    const removed: string[] = []
    const jobs = [job('w', 'working', 1), job('q1', 'queued', 1), job('q2', 'queued', 2), job('q3', 'queued', 2)]
    await show({}, jobs, vi.fn(), (id) => removed.push(id))
    const stop = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Stop') as HTMLButtonElement
    await act(async () => stop.click())
    expect(removed.sort()).toEqual(['q1', 'q2', 'q3'])
    await settle()
    const saved = await savedBank()
    expect(saved.running).toBe(false)
    // The days hold what is left: the video being made.
    expect(saved.filled?.[iso(1)]).toBe(1)
    expect(saved.filled?.[iso(2)]).toBe(0)
    expect(host.textContent).toContain('Stopped. 3 videos waiting to be made were taken out.')
  })

  it('a batch stopped before, its videos still waiting, can be stopped for good', async () => {
    storedBank = { ...bank, running: false }
    const removed: string[] = []
    await show({}, [job('q1', 'queued', 1), job('q2', 'queued', 2)], vi.fn(), (id) => removed.push(id))
    const stop = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Stop the 2 waiting to be made') as HTMLButtonElement
    expect(stop).toBeTruthy()
    await act(async () => stop.click())
    expect(removed.sort()).toEqual(['q1', 'q2'])
    await settle()
  })
})

describe('videos a day', () => {
  const more = () => host.querySelector('[aria-label="More a day"]') as HTMLButtonElement
  const value = () => (host.querySelector('[aria-label="Videos a day"]') as HTMLInputElement | null)?.value
  const upTo = async (n: number) => {
    while (Number(value()) < n) await act(async () => more().click())
  }

  it('goes past 25 - there is no most a day - for a campaign with a single time of its own, keeping his time', async () => {
    await show({ times: ['18:00'] })
    await upTo(30)
    expect(value()).toBe('30')
    expect(more().disabled).toBe(false)
    expect(host.textContent).toContain('At your times and more spread over the rest of the day')
    expect(host.querySelector('.stepper + .hint')?.textContent).toMatch(/6(:00)? PM/)
  })

  it("goes past a random campaign's 3 a day, all 25 inside the window", async () => {
    await show({ window: { from: '10:00', to: '22:00', perDay: 3 } })
    await upTo(25)
    expect(host.textContent).not.toContain('only fits')
  })

  it("posts around the clock, whatever the campaign's window (2026-10-26: \"always has to be posting\")", async () => {
    // A window of a quarter of an hour once held 6 a day at most.
    await show({ window: { from: '12:00', to: '12:15', perDay: 2 } })
    await upTo(10)
    expect(host.textContent).not.toContain('only fits')
    expect(host.textContent).toContain('Spread over the whole day')
    expect(host.textContent).toContain('around the clock')
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

describe("the Claude + X logos' names", () => {
  const logo = (id: string, name: string) => ({ id, name, type: 'image/png', size: 1000 })

  it('asks what a logo is only when its file name says nothing, for the captions', async () => {
    storedBank = { ...bank, hook: 'formula', formula: { left: logo('l', 'IMG_0373.png'), right: logo('r', 'lovable-logo.png'), min: 500, max: 1000 } }
    await show({})
    expect(host.querySelector('[aria-label="Right logo name"]')).toBeNull()
    const left = host.querySelector('[aria-label="Left logo name"]') as HTMLInputElement
    expect(left).not.toBeNull()
    left.value = 'Claude'
    await act(async () => left.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
    expect((await savedBank()).formula?.leftName).toBe('Claude')
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
    expect(videos.filter((v) => v.batch.date > iso(0)).map((v) => v.batch.date)).toEqual(Array.from({ length: AHEAD_DAYS - 1 }, (_, i) => iso(i + 1)))
    for (const v of videos) {
      for (const p of scheduled.filter((x) => new Date(x.postAt).toLocaleDateString('en-CA') === v.batch.date)) {
        const t = new Date(p.postAt)
        expect(Math.abs(t.getHours() * 60 + t.getMinutes() - minutes(v.batch.time))).toBeGreaterThanOrEqual(20)
      }
    }
    expect((await savedBank()).filled?.[iso(AHEAD_DAYS - 1)]).toBe(3)
  })

  it('carries on after days made before it kept going, without making them again', async () => {
    storedBank = { ...bank, perDay: 3, running: true, madeThrough: iso(1), lastPerDay: 3 }
    const { onMake } = await show({})
    await settle()
    expect(onMake).toHaveBeenCalledTimes(1)
    const videos = onMake.mock.calls[0][2] as { batch: { date: string } }[]
    expect(videos.map((v) => v.batch.date)).toEqual(Array.from({ length: AHEAD_DAYS - 2 }, (_, i) => [i + 2, i + 2, i + 2]).flat().map(iso))
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
  /** He leaves the box: a typed number applies then, not on each keystroke. */
  const leave = async () => {
    await act(async () => {
      field().dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
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
    await leave()
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
    await leave()
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
    await leave()
    await settle()
    expect(field().value).toBe('25')
    expect((await savedBank()).perDay).toBe(25)
    expect(onMake).toHaveBeenCalledTimes(1)
    // Typing 2 then 5 and leaving the box made one top-up, for 25 a day -
    // never a trim to 2 on the way.
    const videos = onMake.mock.calls[0][2] as { batch: { date: string } }[]
    expect(videos.filter((v) => v.batch.date === iso(AHEAD_DAYS - 1)).length).toBe(23)
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

  it('has no link to the hook results taken out of the tab (2026-11-15) - it led nowhere', async () => {
    storedBank = { ...bank, looks: [{ look: 'box', parts: 1 }, { look: 'outline', parts: 1 }] }
    const waiting = { id: 'w1', key: 'w1', campaignId: 'inflow', status: 'scheduled', headline: 'one', postAt: null, accounts: [], batch: { id: 'b', date: iso(1), time: '10:00', size: 1, look: 'box' } }
    localStorage.setItem('cutter.posts', JSON.stringify([waiting]))
    await show({})
    await settle()
    expect(host.textContent).not.toContain('Change a look on the videos not out yet')
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
    await openFirstFormat()
    const input = host.querySelector('input[aria-label="Add you"]') as HTMLInputElement
    Object.defineProperty(input, 'files', { value: [file] })
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
    // Reading what is in the file takes a moment.
    await act(async () => new Promise((resolve) => setTimeout(resolve, 200)))
    expect(host.textContent).toContain('old-reaction.mov was already in videos you made')
    const { saveBankFile } = await import('./store')
    expect(saveBankFile).not.toHaveBeenCalled()
  })

  it('comes back in when he taps Add anyway, as a clip of its own', async () => {
    const { fingerprint } = await import('./fingerprint')
    const { usedKey } = await import('./batch')
    const file = new File([new Uint8Array(4096).fill(7)], 'old-reaction.mov', { type: 'video/quicktime' })
    const fp = await fingerprint(file)
    storedBank = { ...bank, usedClips: [fp] }
    await show({})
    await openFirstFormat()
    const input = host.querySelector('input[aria-label="Add you"]') as HTMLInputElement
    Object.defineProperty(input, 'files', { value: [file] })
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
    await act(async () => new Promise((resolve) => setTimeout(resolve, 200)))
    const anyway = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Add it anyway')!
    expect(anyway).toBeTruthy()
    await act(async () => anyway.click())
    await act(async () => new Promise((resolve) => setTimeout(resolve, 200)))
    const saved = await savedBank()
    const back = saved.reactions.find((r) => r.name === 'old-reaction.mov')!
    expect(back.again).toBeGreaterThan(0)
    // Still remembered as used, so the server's copy never drops it - its own
    // use is remembered apart (usedKey).
    expect(saved.usedClips).toEqual([fp])
    expect(usedKey(back)).not.toBe(fp)
    expect([...host.querySelectorAll('button')].some((b) => b.textContent === 'Add it anyway')).toBe(false)
  })
})

describe('Start anyway', () => {
  it('shows in red beside Start once mixes were made before, and makes them again', async () => {
    const { pickBatch, mixFrom } = await import('./batch')
    // Every one of the 27 mixes made already.
    const { made } = pickBatch({ ...mixFrom(bank, bank.headlines), made: [] }, 27)
    storedBank = { ...bank, made }
    const { onMake } = await show({})
    const anyway = host.querySelector('.batch-anyway') as HTMLButtonElement
    expect(anyway.textContent).toBe('Start anyway')
    expect(host.textContent).toContain('Every one of these 27 mixes was made before, so Start makes none.')
    await act(async () => anyway.click())
    expect(onMake).toHaveBeenCalledTimes(1)
    expect((onMake.mock.calls[0][2] as unknown[]).length).toBeGreaterThan(0)
    const saved = await savedBank()
    expect(saved.running).toBe(true)
    expect(saved.anyway).toBe(saved.startedAt)
    expect(saved.made!.length).toBeLessThan(27)
  })

  it('is not there while nothing has been made yet', async () => {
    await show({})
    expect(host.querySelector('.batch-anyway')).toBeNull()
  })
})

describe('starting the batch over', () => {
  it("takes out its videos that haven't gone out, after asking, and waits for Start", async () => {
    const at = (offset: number, hhmm: string) => {
      const d = new Date()
      d.setDate(d.getDate() + offset)
      d.setHours(Number(hhmm.slice(0, 2)), Number(hhmm.slice(3, 5)), 0, 0)
      return d
    }
    const post = (id: string, offset: number) => ({
      id,
      key: id,
      campaignId: 'inflow',
      status: 'scheduled',
      fileName: 'r1 + p1.mp4',
      headline: 'one',
      postAt: at(offset, '12:00').toISOString(),
      batch: { id: 'b1', date: iso(offset), time: '12:00', size: 2 },
    })
    localStorage.setItem('cutter.posts', JSON.stringify([post('a', 1), post('b', 2)]))
    storedBank = { ...bank, running: true, made: ['r1|p1|h:one|', 'r2|p2|h:two|'], filled: { [iso(1)]: 3, [iso(2)]: 3 } }
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    await show({})
    const button = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Start over') as HTMLButtonElement
    expect(button).toBeTruthy()
    await act(async () => button.click())
    await settle()
    expect(confirm.mock.calls[0][0]).toContain('Take out the 2 videos')
    const saved = await savedBank()
    expect(saved.running).toBe(false)
    expect(saved.made).toEqual(['r2|p2|h:two|'])
    expect(host.textContent).toContain('Took out 2 videos. Tap Start to make them again.')
    expect(makeButton().textContent).toBe('Start · 3 a day')
    confirm.mockRestore()
  })

  it('asks about one video in the singular', async () => {
    const post = { id: 'a', key: 'a', campaignId: 'inflow', status: 'scheduled', fileName: 'r1 + p1.mp4', headline: 'one', postAt: new Date(Date.now() + 86_400_000).toISOString(), batch: { id: 'b1', date: iso(1), time: '12:00', size: 1 } }
    localStorage.setItem('cutter.posts', JSON.stringify([post]))
    storedBank = { ...bank, running: true, made: ['r1|p1|h:one|'], filled: { [iso(1)]: 3 } }
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    await show({})
    const button = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Start over') as HTMLButtonElement
    await act(async () => button.click())
    await settle()
    expect(confirm.mock.calls[0][0]).toContain("Take out the 1 video of this batch that hasn't gone out yet, to make it again")
    expect(host.textContent).toContain('Took out 1 video. Tap Start to make it again.')
    confirm.mockRestore()
  })
})

describe('one batch for the account, in formats', () => {
  it('turns a batch from before into a format card, and opens it to show its clips', async () => {
    storedBank = bank
    await show({})
    const card = host.querySelector('.format-head') as HTMLButtonElement
    expect(card.textContent).toContain('Reaction')
    expect(card.textContent).toContain('3 clips of you · 3 product clips')
    await openFirstFormat()
    expect(host.querySelector('input[aria-label="Add you"]')).toBeTruthy()
    expect(host.querySelector('input[aria-label="Add the product"]')).toBeTruthy()
    // Its clips behind one row until he opens them (his report, 2026-11-13: "so squeezed in together").
    expect(host.textContent).not.toContain('r1.mp4')
    const toggle = host.querySelector('.clips-toggle') as HTMLButtonElement
    expect(toggle.textContent).toContain('3 clips')
    await act(async () => toggle.click())
    expect(host.textContent).toContain('r1.mp4')
  })

  it('a song for some formats only: a tap under it, kept on the song (his ask, 2026-11-15)', async () => {
    const song = (id: string) => ({ id, name: `${id}.mp3`, type: 'audio/mpeg', size: 1 })
    storedBank = {
      ...bank,
      formats: [
        { id: 'r', kind: 'reaction', name: 'Shocked' },
        { id: 't', kind: 'talking', name: 'Talk' },
      ],
      products: bank.products.map((p) => ({ ...p, formats: ['r'] })),
      reactions: bank.reactions.map((r) => ({ ...r, formats: ['r'] })),
      music: [song('hype'), song('calm')],
    }
    await show({})
    const chip = (songName: string, format: string) =>
      [...(host.querySelector(`[aria-label="Formats ${songName} is for"]`)?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.includes(format)) as HTMLButtonElement
    expect(chip('hype.mp3', 'Talk').getAttribute('aria-pressed')).toBe('true')
    await act(async () => chip('hype.mp3', 'Talk').click())
    expect((await savedBank()).music.find((m) => m.id === 'hype')!.formats).toEqual(['r'])
    expect(chip('hype.mp3', 'Talk').getAttribute('aria-pressed')).toBe('false')
    // Calm only for the talking head: the reaction is left with hype alone.
    await act(async () => chip('calm.mp3', 'Shocked').click())
    expect((await savedBank()).music.find((m) => m.id === 'calm')!.formats).toEqual(['t'])
  })

  it('adds a talking head format next to it, open to fill in', async () => {
    storedBank = bank
    await show({})
    const add = [...host.querySelectorAll('button')].find((b) => b.textContent === '+ Add a format') as HTMLButtonElement
    await act(async () => add.click())
    const talking = [...host.querySelectorAll('.format-kind')].find((b) => b.textContent?.startsWith('Talking head')) as HTMLButtonElement
    await act(async () => talking.click())
    const saved = await savedBank()
    expect(saved.formats?.map((f) => f.kind)).toEqual(['reaction', 'talking'])
    expect(host.textContent).toContain('Your clips - tap one to change it')
    // It needs its own clips first.
    expect(host.textContent).toContain('Needs a clip of you and a product showcase')
  })

  it('opens Product steps inside its own format, under the button - not at the top of the tab (his report, 2026-11-13)', async () => {
    storedBank = { ...bank, formats: [{ id: 'r', kind: 'reaction', name: 'Reaction' }, { id: 't', kind: 'talking', name: 'Talk' }], products: bank.products.map((p) => ({ ...p, formats: ['r'] })), reactions: bank.reactions.map((r) => ({ ...r, formats: ['r'] })) }
    await show({})
    const talk = [...host.querySelectorAll('.format-head')][1] as HTMLButtonElement
    await act(async () => talk.click())
    const steps = [...host.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Add product steps')) as HTMLButtonElement
    await act(async () => steps.click())
    const editor = host.querySelector('.step-order') as HTMLElement
    expect(editor).toBeTruthy()
    // In the talking format's card, after its button.
    expect(editor.closest('.format-card')).toBe(talk.closest('.format-card'))
    expect(steps.compareDocumentPosition(editor) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(editor.textContent).toContain('A step you talk over shows your captions instead of its name')
  })

  it("a talking format's captions height: moved on its screen, kept with the format", async () => {
    storedBank = { ...bank, formats: [{ id: 'r', kind: 'reaction', name: 'Reaction' }, { id: 't', kind: 'talking', name: 'Talk' }], products: bank.products.map((p) => ({ ...p, formats: ['r'] })), reactions: bank.reactions.map((r) => ({ ...r, formats: ['r'] })) }
    await show({})
    await act(async () => ([...host.querySelectorAll('.format-head')][1] as HTMLButtonElement).click())
    const screen = host.querySelector('[aria-label="Captions height"]') as HTMLElement
    expect(screen).toBeTruthy()
    await act(async () => screen.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })))
    const saved = await savedBank()
    expect(saved.formats?.find((f) => f.id === 't')?.captionY).toBeCloseTo(0.64)
  })

  it('each clip of you, each product clip and each step clip can be used once - off until he ticks it (his ask, 2026-11-14)', async () => {
    storedBank = {
      ...bank,
      formats: [{ id: 'r', kind: 'reaction', name: 'Reaction' }],
      products: bank.products.map((p) => ({ ...p, formats: ['r'] })),
      reactions: bank.reactions.map((r) => ({ ...r, formats: ['r'] })),
    }
    await show({})
    await openFirstFormat()
    const box = (label: string) => host.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement
    expect(box('Use each clip of you once').checked).toBe(false)
    expect(box('Use each product clip once').checked).toBe(false)
    await act(async () => box('Use each clip of you once').click())
    let saved = await savedBank()
    expect(saved.formats?.[0].reactionsOnce).toBe(true)
    // The card counts it: 3 clips of him, 3 different videos.
    expect(host.textContent).toContain('3 different videos left')
    expect(host.textContent).toContain('Each goes in one video only - 3 clips of you, 3 different videos at most.')
    await act(async () => box('Use each product clip once').click())
    saved = await savedBank()
    expect(saved.formats?.[0].productsOnce).toBe(true)
  })

  it("a product step's clips can be used once", async () => {
    const steps = [{ id: 's1', name: 'Open the app', formats: ['t'], files: [{ id: 'c1', name: 'IMG_1.mp4', type: 'video/mp4', size: 1e6 }] }]
    storedBank = { ...bank, formats: [{ id: 't', kind: 'talking', name: 'Talk' }], steps, reactions: bank.reactions.map((r) => ({ ...r, formats: ['t'] })), products: [] }
    await show({})
    await openFirstFormat()
    const box = host.querySelector('input[aria-label="Use each clip of Open the app once"]') as HTMLInputElement
    expect(box.checked).toBe(false)
    await act(async () => box.click())
    expect((await savedBank()).steps?.[0].once).toBe(true)
  })

  it('uses the product of another format with one pick', async () => {
    storedBank = { ...bank, formats: [{ id: 'r', kind: 'reaction', name: 'Reaction' }, { id: 't', kind: 'talking', name: 'Talk' }], products: bank.products.map((p) => ({ ...p, formats: ['r'] })), reactions: bank.reactions.map((r) => ({ ...r, formats: ['r'] })) }
    await show({})
    const talk = [...host.querySelectorAll('.format-head')][1] as HTMLButtonElement
    await act(async () => talk.click())
    const pick = host.querySelector('select[aria-label="Use the product of another format"]') as HTMLSelectElement
    await act(async () => {
      pick.value = 'r'
      pick.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const saved = await savedBank()
    expect(saved.products.every((p) => p.formats?.includes('t'))).toBe(true)
  })

  it("a talking format's clips: every one listed in the order a video plays them, a tap opens it (his ask, 2026-11-15)", async () => {
    const steps = [
      { id: 's1', name: 'Nope, do this instead', formats: ['t'], files: [{ id: 'c1', name: 'IMG_1.mp4', type: 'video/mp4', size: 1e6, seconds: 4, speed: 1.1 }] },
      { id: 's2', name: 'Open the app', formats: ['t'], files: [], texts: [{ id: 'w', text: 'Link in bio', place: { x: 0.5, y: 0.8, scale: 1 } }] },
    ]
    storedBank = { ...bank, formats: [{ id: 't', kind: 'talking', name: 'Talk' }], steps, reactions: bank.reactions.map((r) => ({ ...r, formats: ['t'] })), products: [] }
    await show({})
    await openFirstFormat()
    const groups = [...host.querySelectorAll('.talk-group')]
    expect(groups.map((g) => g.querySelector('.talk-group-title')?.textContent)).toEqual(['Hook', 'Nope, do this instead', 'Open the app'])
    expect(groups[1].textContent).toContain('IMG_1.mp4')
    expect(groups[1].textContent).toContain('1.1×')
    expect(groups[2].textContent).toContain('No clips yet')
    // The steps' names and order, folded away with the rest.
    expect([...host.querySelectorAll('button')].some((b) => b.textContent === 'Names and order')).toBe(true)
    // The format's speed, for every clip.
    const speed = host.querySelector('[aria-label="Speed of every clip"]') as HTMLElement
    await act(async () => ([...speed.querySelectorAll('button')].find((b) => b.textContent === '1.1×') as HTMLButtonElement).click())
    expect((await savedBank()).formats?.[0].speed).toBe(1.1)
  })

  it("a product step's clips all cut or all raw, one tap (his ask, 2026-11-15)", async () => {
    const steps = [{ id: 's1', name: 'Open the app', formats: ['t'], files: [{ id: 'c1', name: 'IMG_1.mp4', type: 'video/mp4', size: 1e6, seconds: 4, edited: true }] }]
    storedBank = { ...bank, formats: [{ id: 't', kind: 'talking', name: 'Talk' }], steps, reactions: bank.reactions.map((r) => ({ ...r, formats: ['t'] })), products: [] }
    await show({})
    await openFirstFormat()
    const choice = host.querySelector('[aria-label="Open the app: cut or raw"]') as HTMLElement
    expect(choice.querySelector('[aria-checked="true"]')).toBeNull()
    await act(async () => ([...choice.querySelectorAll('button')].find((b) => b.textContent === 'Raw') as HTMLButtonElement).click())
    expect((await savedBank()).steps?.[0].clips).toBe('raw')
  })

  it("a talking format's hooks are edited unless he switches Edit my hooks off (his ask, 2026-11-13)", async () => {
    storedBank = { ...bank, formats: [{ id: 't', kind: 'talking', name: 'Talk' }], reactions: bank.reactions.map((r) => ({ ...r, formats: ['t'] })), products: [] }
    await show({})
    await openFirstFormat()
    const edits = host.querySelector('input[aria-label="Edit my hooks"]') as HTMLInputElement
    expect(edits.checked).toBe(true)
    // Its hooks as filmed can be edited now.
    expect([...host.querySelectorAll('button')].some((b) => b.textContent === 'Edit the 3 clips added as filmed')).toBe(true)
    await act(async () => edits.click())
    expect((await savedBank()).formats?.[0].rawHooks).toBe(true)
    // Off, it says what plays: the hook as filmed, the music from the first step.
    expect(host.textContent).toContain('your hook plays exactly as filmed - nothing over it')
    expect(host.textContent).toContain('Over your first product step')
  })

  it("a talking format's captions are Classic unless he picks another look (2026-11-15)", async () => {
    storedBank = { ...bank, formats: [{ id: 't', kind: 'talking', name: 'Talk' }], reactions: bank.reactions.map((r) => ({ ...r, formats: ['t'] })), products: [] }
    await show({})
    await openFirstFormat()
    const look = host.querySelector('[aria-label="Captions look"]') as HTMLElement
    expect(look.querySelector('[aria-checked="true"]')?.textContent).toBe('Classic')
    await act(async () => ([...look.querySelectorAll('button')].find((b) => b.textContent === 'Highlight') as HTMLButtonElement).click())
    expect((await savedBank()).formats?.[0].captionStyle).toBe('highlight')
  })
})
