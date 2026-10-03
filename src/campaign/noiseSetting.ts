// Whether the cutter also cuts sounds with no speech in them (a cough, a bump,
// the room). On unless he turns it off in Settings. See noiseCuts.ts.

const KEY = 'cutter-cut-noise'

export function cutNoiseOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off'
  } catch {
    return true
  }
}

export function setCutNoise(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off')
  } catch {
    // Not saved.
  }
}
