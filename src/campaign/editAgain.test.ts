import { describe, expect, it } from 'vitest'
import { EDIT_WINDOW_MS, jobOfPostKey, postKeyOf } from './store'

describe('post keys for an edited video', () => {
  it('first go is the job id, each later go its own key', () => {
    expect(postKeyOf('abc')).toBe('abc')
    expect(postKeyOf('abc', 1)).toBe('abc')
    expect(postKeyOf('abc', 2)).toBe('abc~2')
    expect(postKeyOf('abc', 3)).toBe('abc~3')
  })
  it('finds the job from any of its post keys', () => {
    expect(jobOfPostKey('abc')).toBe('abc')
    expect(jobOfPostKey('abc~3')).toBe('abc')
  })
  it('keeps the recording two hours', () => {
    expect(EDIT_WINDOW_MS).toBe(7_200_000)
  })
})
