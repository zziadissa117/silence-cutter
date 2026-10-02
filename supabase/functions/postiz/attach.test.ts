import { describe, expect, it } from 'vitest'

import { LEAD_MS, attachMove, summarise, type AttachPost } from './attach'

const NOW = Date.parse('2026-10-05T12:00:00Z')
const later = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString()

const post = (over: Partial<AttachPost> = {}): AttachPost => ({
  id: 'p1',
  status: 'waiting',
  accounts: [{ id: 'tiktok' }],
  post_at: later(600),
  media: { id: 'm', path: '/m' },
  caption: 'hello',
  creating_at: null,
  ...over,
})

describe('attachMove', () => {
  it('does nothing when the post already has every account', () => {
    expect(attachMove(post(), ['tiktok'], NOW)).toEqual({ move: 'has-all', missing: [] })
  })

  it('adds only the accounts the post lacks', () => {
    expect(attachMove(post({ accounts: [{ id: 'tiktok' }, { id: 'ig' }] }), ['tiktok', 'ig', 'yt'], NOW)).toEqual({
      move: 'add',
      missing: ['yt'],
    })
  })

  it('adds straight to a waiting or approved post, which is not at Postiz yet', () => {
    expect(attachMove(post({ status: 'waiting' }), ['yt'], NOW).move).toBe('add')
    expect(attachMove(post({ status: 'approved' }), ['yt'], NOW).move).toBe('add')
  })

  it('leaves one a run is creating at Postiz right now', () => {
    expect(attachMove(post({ status: 'approved', creating_at: later(-1) }), ['yt'], NOW).move).toBe('busy')
  })

  it('creates a post for only the new account on a scheduled one, in the future', () => {
    const decision = attachMove(post({ status: 'scheduled' }), ['yt'], NOW)
    expect(decision).toEqual({ move: 'add-scheduled', missing: ['yt'] })
  })

  it('will not copy a scheduled post that is about to go out, or already past', () => {
    expect(attachMove(post({ status: 'scheduled', post_at: later(1) }), ['yt'], NOW).move).toBe('too-late')
    expect(attachMove(post({ status: 'scheduled', post_at: later(-30) }), ['yt'], NOW).move).toBe('too-late')
    // The edge is exact.
    expect(attachMove(post({ status: 'scheduled', post_at: new Date(NOW + LEAD_MS).toISOString() }), ['yt'], NOW).move).toBe('add-scheduled')
  })

  it('will not copy a scheduled post with no caption or video to copy', () => {
    expect(attachMove(post({ status: 'scheduled', caption: ' ' }), ['yt'], NOW).move).toBe('too-late')
    expect(attachMove(post({ status: 'scheduled', media: null }), ['yt'], NOW).move).toBe('too-late')
  })

  it('never adds to one that has gone out - that would be a different post', () => {
    expect(attachMove(post({ status: 'posted' }), ['yt'], NOW).move).toBe('too-late')
  })

  it('leaves posts still being got ready, failed or rejected', () => {
    for (const status of ['uploading', 'writing', 'failed', 'rejected', 'error']) {
      expect(attachMove(post({ status }), ['yt'], NOW).move).toBe('not-open')
    }
  })
})

describe('summarise', () => {
  it('counts what happened', () => {
    expect(summarise(['add', 'add', 'add-scheduled', 'too-late', 'busy', 'has-all', 'not-open'])).toEqual({
      added: 2,
      scheduled: 1,
      left: 2,
    })
  })
})
