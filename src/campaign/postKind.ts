// Which kind of video a post is, as a brand counts it (his ask, 2026-11-15:
// MediaMaxing pays $6 for an advanced post - mostly talking heads - and $3
// for a basic one - mostly reactions - tracked by what the caption carries).
// The server adds the campaign's text for that kind (PostingRules.byKind).

import type { BatchFormat } from './batch'
import type { PostKind } from './look'

/** A batch video: its format's kind - a green screen he talks in counts as
 *  him talking. A video of his own: him talking, unless nothing in it is
 *  talking or the campaign is a reaction one. */
export function postKind({
  format,
  talks,
  noSpeech = false,
  reactionCampaign = false,
}: {
  /** The batch format it was made for. */
  format?: Pick<BatchFormat, 'kind' | 'voice'> | null
  /** A batch video with no format (an older batch): whether he talks in its clip. */
  talks?: boolean
  noSpeech?: boolean
  reactionCampaign?: boolean
}): PostKind {
  if (format) return format.kind === 'talking' || (format.kind === 'greenscreen' && format.voice) ? 'talking' : 'reaction'
  if (talks !== undefined) return talks ? 'talking' : 'reaction'
  return noSpeech || reactionCampaign ? 'reaction' : 'talking'
}
