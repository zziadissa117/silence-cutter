// Whether the cutter also cuts sounds with no speech in them (a cough, a bump,
// the room). Off unless he turns it on in Settings: it was on by default and
// made the cuts and captions worse than they had been, so the ordinary cut is
// the default again. See noiseCuts.ts.

const KEY = 'cutter-cut-noise'

export function cutNoiseOn(): boolean {
  try {
    return localStorage.getItem(KEY) === 'on'
  } catch {
    return false
  }
}

export function setCutNoise(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off')
  } catch {
    // Not saved.
  }
}
