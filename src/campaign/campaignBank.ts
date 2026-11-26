// Each campaign's own picture bank (his ask, 2026-11-26: "go into campaigns
// and click on a campaign. We're going to have a sort of picture bank for that
// campaign ... all the pictures that we've used for that campaign ... or ...
// for future videos ... in the timeline editor editing a video for that exact
// campaign, we're going to have that as a priority").
//
// Kept with the shared picture bank (BankPicture.campaignId), synced the same
// way. Pictures he adds on the campaign's page land here, and so does every
// picture from his phone he puts on one of the campaign's videos - by itself,
// once, when he keeps the edit. In the edit screen's Overlay, for that
// campaign's video, they come first. They have no words of their own, so they
// never come up by themselves on any video.

import { fingerprint } from './fingerprint'
import type { BankPicture } from './look'
import { shrinkPicture } from './PictureRow'
import { saveBankPicture } from './store'

/** A campaign's own pictures, newest first. */
export function picturesOf(bank: readonly BankPicture[], campaignId: string): BankPicture[] {
  return bank.filter((p) => p.campaignId === campaignId).sort((a, b) => b.addedAt - a.addedAt)
}

/** The shared picture bank: what no campaign has to itself. */
export function sharedPictures(bank: readonly BankPicture[]): BankPicture[] {
  return bank.filter((p) => !p.campaignId)
}

/** A picture's id in a campaign's bank: the same picture twice is one. */
export async function campaignPictureId(campaignId: string, image: Blob): Promise<string> {
  return `cb-${campaignId}-${await fingerprint(image)}`
}

/** Pictures into a campaign's bank, each once - brought down to video size
 *  first. Returns the ones that are new. */
export async function addToCampaignBank(campaignId: string, images: readonly Blob[], bank: readonly BankPicture[], now = Date.now()): Promise<BankPicture[]> {
  const have = new Set(bank.map((p) => p.id))
  const added: BankPicture[] = []
  for (const [i, file] of images.entries()) {
    const id = await campaignPictureId(campaignId, file)
    if (have.has(id)) continue
    have.add(id)
    const picture: BankPicture = { id, image: await shrinkPicture(file), words: [], addedAt: now + i, campaignId }
    await saveBankPicture(picture)
    added.push(picture)
  }
  return added
}
