// Light or dark, or as the phone is set - his pick, kept on this phone. The
// colours themselves are in index.css: this only says which set is on, as
// `data-theme` on the page, and tells the browser the colour behind it.

export type Theme = 'system' | 'light' | 'dark'

const KEY = 'cutter.theme'
/** The ground colour of each, for the browser's own bars. */
const GROUND = { light: '#f2f2f7', dark: '#000000' }

export function savedTheme(): Theme {
  try {
    const value = localStorage.getItem(KEY)
    return value === 'light' || value === 'dark' ? value : 'system'
  } catch {
    return 'system'
  }
}

/** Which set of colours is showing for `theme` right now. */
export function shownTheme(theme: Theme, prefersDark: boolean): 'light' | 'dark' {
  return theme === 'system' ? (prefersDark ? 'dark' : 'light') : theme
}

function prefersDark(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches
}

const TIPS_KEY = 'cutter.tips'

/** Whether the explanations under things show: off unless he turns them on -
 *  everyone who uses it has the full guide, and on every screen they made it
 *  long and busy. */
export function savedTips(): boolean {
  try {
    return localStorage.getItem(TIPS_KEY) === 'on'
  } catch {
    return false
  }
}

export function setTips(on: boolean): void {
  try {
    if (on) localStorage.setItem(TIPS_KEY, 'on')
    else localStorage.removeItem(TIPS_KEY)
  } catch {
    // Just won't be remembered.
  }
  document.documentElement.classList.toggle('tips-on', on)
}

export function applyTheme(theme: Theme = savedTheme()): void {
  const root = document.documentElement
  root.classList.toggle('tips-on', savedTips())
  if (theme === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme)
  const meta = document.querySelector('meta[name="theme-color"]')
  meta?.setAttribute('content', GROUND[shownTheme(theme, prefersDark())])
}

export function setTheme(theme: Theme): void {
  try {
    if (theme === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, theme)
  } catch {
    // Just won't be remembered.
  }
  applyTheme(theme)
}

/** Keeps the browser's bar colour right when the phone switches between
 *  light and dark by itself. Call once. */
export function followPhone(): void {
  if (typeof window.matchMedia !== 'function') return
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyTheme())
}
