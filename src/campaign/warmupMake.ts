// A warm-up's finished video (his ask, 2026-11-11): what he filmed, its own
// sound left out, the idea's sound in its place and its headline over it in
// the idea's look - the same montage render as a batch video, nothing else.

import { blankAngle, blankCampaign } from './look'
import { makeMontage } from './pipeline'
import type { WarmupIdea } from './warmups'

export async function makeWarmupVideo(
  takes: Blob[],
  idea: Pick<WarmupIdea, 'id' | 'headlineStyle'>,
  headline: string,
  sound: { audio: Blob; name: string } | null,
  onProgress?: (fraction: number) => void,
): Promise<Blob> {
  const campaign = blankCampaign('warmup')
  const own = blankAngle('warmup', 'Warm-up')
  const angle = { ...own, headline: { ...own.headline, style: idea.headlineStyle } }
  const made = await makeMontage(takes, campaign, angle, headline, sound, onProgress, { seed: idea.id, defaults: null })
  return made.blob
}
