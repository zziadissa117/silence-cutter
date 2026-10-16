import { afterEach, describe, expect, it } from 'vitest'

import { applyTheme, savedTheme, savedTips, setTheme, setTips, shownTheme } from './theme'

afterEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
})

describe('the theme', () => {
  it('follows the phone unless he picks one', () => {
    expect(savedTheme()).toBe('system')
    expect(shownTheme('system', true)).toBe('dark')
    expect(shownTheme('system', false)).toBe('light')
    expect(shownTheme('light', true)).toBe('light')
  })

  it('is kept and put on the page', () => {
    setTheme('light')
    expect(savedTheme()).toBe('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    setTheme('system')
    expect(savedTheme()).toBe('system')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
    applyTheme('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })
})

describe('tips', () => {
  it('are off unless he turns them on', () => {
    expect(savedTips()).toBe(false)
    setTips(true)
    expect(document.documentElement.classList.contains('tips-on')).toBe(true)
    setTips(false)
    expect(savedTips()).toBe(false)
    expect(document.documentElement.classList.contains('tips-on')).toBe(false)
  })
})
