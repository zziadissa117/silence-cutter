// The Trial reels screen: More shows it only to a login allowed Trial reels;
// picking the viral reel and its clean clip together and tapping Start sets
// the loop up - the account the first time - and it says what it is making.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { BatchBank } from './batch'

let saved: BatchBank | null = null

vi.mock('./store', async (original) => {
  const real = await original<Record<string, unknown>>()
  const stubs = Object.fromEntries(Object.keys(real).map((key) => [key, typeof real[key] === 'function' ? vi.fn(async () => undefined) : real[key]]))
  return {
    ...stubs,
    loadBatchBank: vi.fn(async () => saved),
    saveBatchBank: vi.fn(async (bank: BatchBank) => {
      saved = bank
    }),
  }
})
vi.mock('./fingerprint', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  fingerprint: vi.fn(async (file: File) => `fp-${file.name}`),
}))
vi.mock('./filming', () => ({ filmingOf: vi.fn(async () => ({ seconds: 6 })) }))
vi.mock('./viralReel', () => ({
  takeApart: vi.fn(async () => ({ start: 0.8, sound: new File(['aac'], 'viral - sound.m4a', { type: 'audio/mp4' }), still: 'abc' })),
}))
vi.mock('./posting', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  listPosts: vi.fn(async () => []),
  postAction: vi.fn(),
  trialHeadlines: vi.fn(async () => ['This changed everything', 'Nobody tells you this', 'I wish I knew this sooner']),
  readViralReel: vi.fn(async () => ({
    read: { text: 'POV: you found the hack', style: 'outline', outlineColor: '#000000', size: 'large', x: 0.5, y: 0.3, rewordings: ['POV: you found the trick'] },
  })),
}))
vi.mock('./trialTalk', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  hearTalk: vi.fn(async () => ({
    keep: [
      { start: 0, end: 2 },
      { start: 3, end: 5 },
    ],
    duration: 5,
    silences: 1,
    fillerWords: 0,
    stutters: 0,
    cleanSpeech: true,
    aligned: true,
    words: [],
    spoken: [
      { text: 'This', start: 0.2, end: 0.5 },
      { text: 'changed', start: 0.6, end: 1 },
      { text: 'everything', start: 3.2, end: 3.8 },
    ],
  })),
  cutTalk: vi.fn(async () => new File(['cut'], 'talk (cut).mp4', { type: 'video/mp4' })),
}))
vi.mock('./CaptionReview', () => ({
  CaptionReview: ({ initial, onApprove }: { initial: unknown[]; onApprove: (words: unknown[]) => void }) => (
    <button type="button" onClick={() => onApprove(initial)}>
      Approve captions
    </button>
  ),
}))
vi.mock('./musicBank', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  useMusicBank: () => [
    { id: 's1', name: 'Song one.m4a', type: 'audio/mp4', size: 1 },
    { id: 's2', name: 'Song two.m4a', type: 'audio/mp4', size: 1 },
  ],
  copySong: vi.fn(async (song: { id: string; name: string }) => ({ id: `copy-${song.id}`, name: song.name, type: 'audio/mp4', size: 1 })),
}))
// Which picked file has sound: the viral one.
vi.mock('mediabunny', async (original) => {
  const real = await original<Record<string, unknown>>()
  class FakeInput {
    name: string
    constructor({ source }: { source: { file: File } }) {
      this.name = source.file.name
    }
    async getPrimaryAudioTrack() {
      return this.name.includes('viral') ? {} : null
    }
    dispose() {}
  }
  class FakeSource {
    file: File
    constructor(file: File) {
      this.file = file
    }
  }
  return { ...real, Input: FakeInput, BlobSource: FakeSource }
})

import { MoreView } from './MoreView'
import { TrialView } from './TrialView'
import { blankCampaign, type Campaign } from './look'
import type { LocalPosting } from './posting'
import { readViralReel } from './posting'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const posting = (over: Partial<LocalPosting['profile']> = {}): LocalPosting => ({
  sendHere: true,
  profile: {
    id: 'p1',
    accounts: [{ id: 'ig1', name: 'ziad', platform: 'instagram', profile: 'ziad', picture: '', disabled: false }],
    settings: {},
    timezone: 'America/Toronto',
    hasAnthropic: true,
    vapidPublic: null,
    trialReels: true,
    ...over,
  },
})

let root: Root
let host: HTMLDivElement

beforeEach(() => {
  saved = null
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const flush = async () => {
  for (let i = 0; i < 8; i++) await act(async () => await Promise.resolve())
}

describe('More', () => {
  it('shows Trial reels only to a login allowed them', () => {
    act(() => root.render(<MoreView campaigns={2} onOpen={() => {}} workToLose={async () => null} trialReels={false} />))
    expect(host.textContent).not.toContain('Trial reels')
    act(() => root.render(<MoreView campaigns={2} onOpen={() => {}} workToLose={async () => null} trialReels />))
    expect(host.textContent).toContain('Trial reels')
  })
})

describe('Trial reels', () => {
  it('says to pick the videos when Start is tapped with none picked', async () => {
    act(() =>
      root.render(<TrialView campaigns={[]} posting={posting()} jobs={[]} onBack={() => {}} onCreate={vi.fn()} onRun={() => {}} removeJob={() => {}} />),
    )
    await flush()
    const start = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Start') as HTMLButtonElement
    await act(async () => start.click())
    expect(host.textContent).toContain('Pick the viral reel and its clean clip first.')
    // Talking: the same - the video first, then a song.
    const talking = [...host.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Talking')) as HTMLButtonElement
    await act(async () => talking.click())
    const startTalk = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Start') as HTMLButtonElement
    await act(async () => startTalk.click())
    expect(host.textContent).toContain('Pick your talking video first.')
  })

  it('starts a talking clip: cut once, captions checked once, headlines and songs taking turns', async () => {
    const created: Campaign = { ...blankCampaign('trial-c'), name: 'Trial reels', trial: true }
    const onRun = vi.fn()
    act(() =>
      root.render(
        <TrialView campaigns={[]} posting={posting()} jobs={[]} onBack={() => {}} onCreate={vi.fn(async () => created)} onRun={onRun} removeJob={() => {}} />,
      ),
    )
    await flush()
    const talking = [...host.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Talking')) as HTMLButtonElement
    await act(async () => talking.click())
    const input = host.querySelector('input[type=file]') as HTMLInputElement
    Object.defineProperty(input, 'files', { value: [new File(['t'], 'talk.mov', { type: 'video/quicktime' })], configurable: true })
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
    const start = () => [...host.querySelectorAll('button')].find((b) => b.textContent === 'Start') as HTMLButtonElement
    await act(async () => start().click())
    expect(host.textContent).toContain('Pick at least one song')
    for (const name of ['Song one', 'Song two']) {
      const chip = [...host.querySelectorAll('button')].find((b) => b.textContent === name) as HTMLButtonElement
      await act(async () => chip.click())
    }
    await act(async () => start().click())
    await flush()
    const approve = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Approve captions') as HTMLButtonElement
    await act(async () => approve.click())
    await flush()
    expect(host.textContent).toContain('Nobody tells you this')
    const out = [...host.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Take out Nobody tells you this') as HTMLButtonElement
    await act(async () => out.click())
    await act(async () => start().click())
    await flush()
    const source = saved?.trial?.sources[0]
    expect(source?.talk?.headlines).toEqual(['This changed everything', 'I wish I knew this sooner'])
    expect(source?.talk?.songs).toEqual(['copy-s1', 'copy-s2'])
    // The captions on the cut clip's own timeline: "everything" was at 3.2 s, after a 1 s pause cut.
    expect(source?.talk?.words.map((w) => w.text)).toEqual(['This', 'changed', 'everything'])
    expect(source?.talk?.words[2].start).toBeCloseTo(2.2, 1)
    expect(source?.sound).toBeNull()
    expect(saved?.music.map((m) => m.id)).toEqual(['copy-s1', 'copy-s2'])
    expect(saved?.running).toBe(true)
    expect(onRun).toHaveBeenCalled()
  })

  it('starts a loop from the two videos picked together, setting the account up the first time', async () => {
    const created: Campaign = { ...blankCampaign('trial-c'), name: 'Trial reels', trial: true }
    const onCreate = vi.fn(async () => created)
    const onRun = vi.fn()
    act(() =>
      root.render(<TrialView campaigns={[]} posting={posting()} jobs={[]} onBack={() => {}} onCreate={onCreate} onRun={onRun} removeJob={() => {}} />),
    )
    await flush()
    const input = host.querySelector('input[type=file]') as HTMLInputElement
    const viral = new File(['v'], 'viral.mp4', { type: 'video/mp4' })
    const clean = new File(['c'], 'clean.mov', { type: 'video/quicktime' })
    Object.defineProperty(input, 'files', { value: [clean, viral], configurable: true })
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
    await flush()
    // The one with sound is taken as the viral reel.
    const viralButton = [...host.querySelectorAll('.trial-which button')].find((b) => b.textContent === 'viral.mp4')
    expect(viralButton?.getAttribute('aria-pressed')).toBe('true')
    const start = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Start') as HTMLButtonElement
    expect(start.disabled).toBe(false)
    await act(async () => start.click())
    await flush()
    expect(onCreate).toHaveBeenCalledWith('ig1')
    expect(readViralReel).toHaveBeenCalledWith('abc', '')
    expect(saved?.layout).toBe('trial')
    expect(saved?.running).toBe(true)
    expect(saved?.perDay).toBe(30)
    expect(saved?.trial?.sources[0].read.text).toBe('POV: you found the hack')
    expect(saved?.reactions[0].name).toBe('clean.mov')
    expect(saved?.music[0].name).toBe('viral - sound.m4a')
    expect(onRun).toHaveBeenCalled()
    expect(host.textContent).toContain('Started: "POV: you found the hack"')
  })

  it("says Instagram's limit and that the number a day changes at once", async () => {
    const campaign: Campaign = { ...blankCampaign('trial-c'), name: 'Trial reels', trial: true }
    saved = {
      campaignId: 'trial-c',
      angleId: campaign.angles[0].id,
      layout: 'trial',
      reactions: [{ id: 'clip', name: 'clean.mov', type: 'video/quicktime', size: 1 }],
      products: [],
      headlines: [],
      music: [],
      perDay: 30,
      days: 0,
      used: { s1: 12 },
      running: true,
      trial: {
        sources: [
          {
            id: 's1',
            name: 'viral.mp4',
            clip: 'clip',
            sound: null,
            addedAt: 1,
            read: { text: 'POV: you found the hack', style: 'outline', outlineColor: '#000000', size: 'large', x: 0.5, y: 0.3, rewordings: [] },
          },
        ],
      },
    }
    const profile = posting({
      settings: { campaigns: { 'trial-c': { accounts: ['ig1'], times: [] } }, trial: { limits: { ig1: { perDay: 20, at: '' } } } },
    })
    act(() => root.render(<TrialView campaigns={[campaign]} posting={profile} jobs={[]} onBack={() => {}} onCreate={vi.fn()} onRun={vi.fn()} removeJob={() => {}} />))
    await flush()
    expect(host.textContent).toContain('20 copies a day')
    expect(host.textContent).toContain('Instagram takes 20 trial reels a day')
    expect(host.textContent).toContain('12 made')
    const plus = host.querySelector('button[aria-label="More a day"]') as HTMLButtonElement
    await act(async () => plus.click())
    await flush()
    expect(saved?.perDay).toBe(35)
  })

  it('lists its videos: to approve, going out, out - and approves one', async () => {
    const { listPosts, postAction } = await import('./posting')
    const post = (id: string, status: string, postAt: string, headline: string) => ({
      id, key: id, campaignId: 'trial-c', campaignName: 'Trial reels', approval: 'me', captionBy: 'claude', remind: false, status,
      fileName: 'clip (trial).mp4', headline, caption: 'c', title: null, postAt, accounts: [], videoUrl: null, links: {}, error: null,
      retryAt: null, createdAt: postAt, batch: { id: 'b1', date: postAt.slice(0, 10), time: '10:00', size: 3, trial: true, source: 's1' },
    })
    vi.mocked(listPosts).mockResolvedValue([
      post('w1', 'waiting', '2099-01-01T10:00:00Z', 'Words moved'),
      post('g1', 'approved', '2099-01-02T10:00:00Z', 'A word changed'),
      post('o1', 'posted', '2020-01-01T10:00:00Z', 'Out already'),
    ] as never)
    vi.mocked(postAction).mockResolvedValue({ ...post('w1', 'approved', '2099-01-01T10:00:00Z', 'Words moved'), alsoApproved: 0 } as never)
    saved = {
      campaignId: 'trial-c', angleId: 'a1', layout: 'trial', reactions: [{ id: 'clip', name: 'clip.mp4', type: 'video/mp4', size: 1 }],
      products: [], headlines: [], music: [], perDay: 5, days: 0, used: {}, running: true,
      trial: { sources: [{ id: 's1', name: 'viral.mp4', clip: 'clip', sound: null, addedAt: 1, read: { text: 'Hook', style: 'outline', outlineColor: '#000000', size: 'large', x: 0.5, y: 0.3, rewordings: [] } }] },
    }
    const campaign: Campaign = { ...blankCampaign('trial-c'), name: 'Trial reels', trial: true }
    const profile = posting({ settings: { campaigns: { 'trial-c': { accounts: ['ig1'], times: [] } } } })
    act(() => root.render(<TrialView campaigns={[campaign]} posting={profile} jobs={[]} onBack={() => {}} onCreate={vi.fn()} onRun={vi.fn()} removeJob={() => {}} />))
    await flush()
    expect(host.textContent).toContain('To approve · 1')
    expect(host.textContent).toContain('Words moved')
    expect(host.textContent).toContain('Going out · 1')
    expect(host.textContent).toContain('Out · 1')
    const approve = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Approve') as HTMLButtonElement
    await act(async () => approve.click())
    await flush()
    expect(postAction).toHaveBeenCalledWith('approve', 'w1', {})
  })
})
