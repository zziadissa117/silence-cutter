// The effects every video gets unless its angle sets its own, or he turns
// them off for that one video.
//
// Effects are off until he picks (see effects.ts): this ships as Off, and
// Settings gives one-tap Subtle and Strong. An angle that has any effect of
// its own on keeps exactly that - the default only fills in for angles with
// none, so nothing he already set up changes under him.

import { NO_EFFECTS, type AngleEffects } from './effects'

export type DefaultPreset = 'off' | 'subtle' | 'strong'

export const PRESET_EFFECTS: Record<DefaultPreset, AngleEffects> = {
  off: NO_EFFECTS,
  subtle: { cutPunch: 'subtle', hookPush: 'subtle', brandHit: 'off', logoPop: true },
  strong: { cutPunch: 'strong', hookPush: 'strong', brandHit: 'off', logoPop: true },
}

const KEY = 'cutter-default-effects'

export function anyEffect(effects: AngleEffects): boolean {
  return effects.cutPunch !== 'off' || effects.hookPush !== 'off' || effects.brandHit !== 'off' || effects.logoPop
}

/** Which preset these effects are exactly, or null when custom. */
export function presetOf(effects: AngleEffects): DefaultPreset | null {
  for (const name of Object.keys(PRESET_EFFECTS) as DefaultPreset[]) {
    if (JSON.stringify(PRESET_EFFECTS[name]) === JSON.stringify(effects)) return name
  }
  return null
}

const LEVELS = ['off', 'subtle', 'strong']

export function defaultEffects(): AngleEffects {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<AngleEffects> | null
    if (saved && LEVELS.includes(saved.cutPunch as string) && LEVELS.includes(saved.hookPush as string) && LEVELS.includes(saved.brandHit as string)) {
      return { cutPunch: saved.cutPunch!, hookPush: saved.hookPush!, brandHit: saved.brandHit!, logoPop: saved.logoPop === true }
    }
  } catch {
    // Unreadable or storage blocked: Off.
  }
  return NO_EFFECTS
}

export function setDefaultEffects(effects: AngleEffects): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(effects))
  } catch {
    // Not saved.
  }
}

/** What a video gets: its angle's own effects when it has any, else the
 *  default - unless this video was set to none. */
export function effectsFor(angle: AngleEffects, defaults: AngleEffects | null): AngleEffects {
  if (anyEffect(angle)) return angle
  return defaults ?? angle
}
