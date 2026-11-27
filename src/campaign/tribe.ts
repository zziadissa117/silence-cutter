// Tribe (his ask, 2026-11-26: "Every single day of the week, I'm going to do 1
// hour of Tribe videos ... a section inside of the cutter as if it was a
// campaign ... Make it purple ... save that video indefinitely ... Sometimes
// Tribe asks for revisions after submitting a video ... I would like to still
// have that original video file ... so I can consult it anytime and edit again
// anytime (or just save again anytime until I say that it's fine and the video
// has been approved) ... only if you turn that on in the settings ... the
// Tribe icon at the bottom too").
//
// Turned on in Settings: a purple Tribe campaign appears among his campaigns
// and a Tribe tab in the tab bar. A video he puts in Tribe ("Goes to") is cut
// and captioned like any of his, never posted, and kept on the phone - the
// finished video and its recording - until he marks it approved: watched,
// saved and edited again as many times as Tribe asks.

import { blankAngle, type Campaign } from './look'

/** Purple, whatever the name works out to (HomeTop.hueOf). */
export const TRIBE_HUE = 270

const ON_KEY = 'cutter.tribe'

export function tribeOn(): boolean {
  try {
    return localStorage.getItem(ON_KEY) === 'on'
  } catch {
    return false
  }
}

export function setTribeOn(on: boolean): void {
  try {
    if (on) localStorage.setItem(ON_KEY, 'on')
    else localStorage.removeItem(ON_KEY)
  } catch {
    // Asked again next time.
  }
  // Kept for good on the phone: Safari may clear a site's storage it hasn't
  // been told to keep, and Tribe's recordings must stay until approved.
  if (on) void navigator.storage?.persist?.().catch(() => false)
}

/** The Tribe campaign among his, if there is one. */
export function tribeCampaign(campaigns: readonly Campaign[]): Campaign | undefined {
  return campaigns.find((c) => c.tribe)
}

/** The one Tribe campaign's id: the same on every phone of the login, so
 *  two phones turning Tribe on make one campaign, not two. */
export const TRIBE_ID = 'tribe'

/** A new Tribe campaign: no brand words (never sorted into by itself - he
 *  picks it), no logo, its one angle with no look of its own beyond his
 *  usual captions and headline. */
export function newTribeCampaign(id = TRIBE_ID, now = Date.now()): Campaign {
  const angle = blankAngle(`${id}-a1`, 'Trybe')
  return { id, name: 'Trybe', logo: null, brandWords: [], tribe: true, createdAt: now, updatedAt: now, angles: [{ ...angle, general: true }] }
}
