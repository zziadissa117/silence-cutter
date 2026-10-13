import { describe, expect, it } from 'vitest'

import { PopFrames, cleanPopSize, occurrencesOf, popAt, popLayout } from './popVideo'

describe('the pop-up box', () => {
  const tall = { width: 1080, height: 1920 }
  const wide = { width: 1920, height: 1080 }

  it('is about two thirds of the width at the clip\'s own shape, centred', () => {
    const box = popLayout(1080, 1920, wide, 65, 'middle')
    expect(box.width).toBe(702)
    expect(box.height).toBe(394)
    expect(box.x).toBe(189)
    expect(box.width % 2 + (box.height % 2)).toBe(0)
  })

  it('never takes more than three quarters of the height, however tall the clip', () => {
    const box = popLayout(1080, 1920, tall, 90, 'middle')
    expect(box.height).toBeLessThanOrEqual(1440)
    expect(box.width).toBeLessThan(1080 * 0.9)
  })

  it('keeps clear of TikTok\'s top bar and caption area', () => {
    const top = popLayout(1080, 1920, wide, 65, 'top')
    expect(top.y).toBeGreaterThanOrEqual(1920 * 0.13 - 1)
    const bottom = popLayout(1080, 1920, wide, 65, 'bottom')
    expect(bottom.y + bottom.height).toBeLessThanOrEqual(1920 * 0.77 + 1)
    const middle = popLayout(1080, 1920, tall, 65, 'middle')
    expect(middle.y).toBeGreaterThanOrEqual(1920 * 0.13 - 1)
  })

  it('keeps the size he sets between 40% and 90%', () => {
    expect(cleanPopSize(20)).toBe(40)
    expect(cleanPopSize(95)).toBe(90)
    expect(cleanPopSize('nonsense')).toBe(65)
    expect(cleanPopSize(70)).toBe(70)
  })
})

describe('which pop-up is on screen', () => {
  const occurrences = occurrencesOf([
    { seconds: 4, times: [1] },
    { seconds: 3, times: [2.5] },
  ])

  it('plays each to its end, the newest said taking over', () => {
    expect(popAt(occurrences, 0.5)).toBeNull()
    expect(popAt(occurrences, 1.5)?.clip).toBe(0)
    expect(popAt(occurrences, 3)?.clip).toBe(1)
    expect(popAt(occurrences, 5.4)?.clip).toBe(1)
    expect(popAt(occurrences, 5.6)).toBeNull()
  })
})

describe('stepping a clip\'s frames', () => {
  const frames = (clip: number, step = 0.1, count = 10) => {
    let i = 0
    const opened = { clip, closed: false }
    const it: AsyncIterator<{ timestamp: number; clip: number }> = {
      next: async () => (i < count ? { done: false, value: { timestamp: i++ * step, clip } } : { done: true, value: undefined }),
      return: async () => {
        opened.closed = true
        return { done: true, value: undefined }
      },
    }
    return { it, opened }
  }

  it('shows the frame due at each moment and holds the last one', async () => {
    const opened: { clip: number; closed: boolean }[] = []
    const player = new PopFrames((clip) => {
      const f = frames(clip)
      opened.push(f.opened)
      return f.it
    })
    const o = { clip: 0, at: 1, seconds: 2 }
    expect((await player.at(o, 0))?.timestamp).toBe(0)
    expect((await player.at(o, 0.25))?.timestamp).toBeCloseTo(0.2)
    expect((await player.at(o, 0.55))?.timestamp).toBeCloseTo(0.5)
    expect((await player.at(o, 5))?.timestamp).toBeCloseTo(0.9)
    expect(opened).toHaveLength(1)
  })

  it('closes one clip\'s decoder when another takes over', async () => {
    const opened: { clip: number; closed: boolean }[] = []
    const player = new PopFrames((clip) => {
      const f = frames(clip)
      opened.push(f.opened)
      return f.it
    })
    await player.at({ clip: 0, at: 1, seconds: 2 }, 0.3)
    const frame = await player.at({ clip: 1, at: 1.5, seconds: 2 }, 0)
    expect(frame?.clip).toBe(1)
    expect(opened[0].closed).toBe(true)
    await player.stop()
    expect(opened[1].closed).toBe(true)
  })
})
