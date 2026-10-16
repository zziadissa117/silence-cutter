import { describe, expect, it } from 'vitest'

import { accountName, failedRefs, notPostedNote } from './failed'

const accounts = [
  { id: 'yt', name: 'Ilyan Hamdane', platform: 'youtube' },
  { id: 'ig', name: 'Ilyan Hamdane', platform: 'instagram-standalone' },
  { id: 'tt', name: 'glpjake', platform: 'tiktok-business' },
]

describe('accountName', () => {
  it('adds the platform only when two accounts on the post share a name', () => {
    expect(accountName('Ilyan Hamdane', 'youtube', accounts)).toBe('Ilyan Hamdane (YouTube)')
    expect(accountName('Ilyan Hamdane', 'instagram-standalone', accounts)).toBe('Ilyan Hamdane (Instagram)')
    expect(accountName('glpjake', 'tiktok-business', accounts)).toBe('glpjake')
  })
})

describe('failedRefs', () => {
  it('keeps only the Postiz posts in error', () => {
    const ids = [
      { postId: 'a', integration: 'yt' },
      { postId: 'b', integration: 'ig' },
      { postId: 'c', integration: 'tt' },
    ]
    const found = [
      { id: 'a', state: 'PUBLISHED' },
      { id: 'b', state: 'ERROR' },
    ]
    expect(failedRefs(ids, found)).toEqual([{ postId: 'b', integration: 'ig' }])
  })
})

describe('notPostedNote', () => {
  it('names the failed account with its platform when its name is shared', () => {
    expect(notPostedNote([{ id: 'b', state: 'ERROR', integration: { id: 'ig', name: 'Ilyan Hamdane' } }], accounts)).toBe(
      'Not posted to Ilyan Hamdane (Instagram).',
    )
  })
  it('falls back to the name Postiz gives', () => {
    expect(notPostedNote([{ id: 'x', state: 'ERROR', integration: { id: 'gone', name: 'Jake' } }], accounts)).toBe('Not posted to Jake.')
  })
})
