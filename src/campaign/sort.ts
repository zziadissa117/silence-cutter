// Sorting a day's videos: which campaign and angle each one is, from what he
// says in it - and how sure that is.
//
// For now every guess is shown to him to approve before anything is made.
// "Sure" only decides what is preselected and what is flagged; he has said
// he will say when it may go ahead on its own.

import type { WordChunk } from '../media/fillerWords'
import { findMentions, squash } from './keywords'
import { GENERAL_ID, type Angle, type BankPicture, type Campaign } from './look'

export interface Guess {
  campaignId: string
  angleId: string
  /** Everything pointed one way. */
  sure: boolean
  /** Why, in his words: what was heard, or what was missing. */
  why: string
}

const said = (words: string[]) => `"${words[0]}"`

/** The words that say a video is this angle: the ones he set for it, or -
 *  when he set none - its pictures' words, since a picture of Sydney Sweeney
 *  says what the angle is about. */
export function recognizedBy(angle: Angle): string[] {
  return angle.recognize.length > 0 ? angle.recognize : angle.pictures.flatMap((p) => p.words)
}

/** The angle for a video where the campaign's name was heard but none of
 *  its angles' words: the one angle he set up with no words of its own, if
 *  there is exactly one - that is his catch-all - otherwise the campaign's
 *  General angle. */
function brandOnlyAngle(campaign: Campaign): { angle: Angle; sure: boolean } {
  const own = campaign.angles.filter((a) => !a.general)
  const general = campaign.angles.find((a) => a.general)
  if (own.length === 1 && recognizedBy(own[0]).length === 0) return { angle: own[0], sure: true }
  if (general) return { angle: general, sure: true }
  return { angle: campaign.angles[0], sure: campaign.angles.length === 1 }
}

/** The campaign and angle a video most likely is. An angle's own words
 *  ("Sydney Sweeney") decide it outright; the brand alone decides the
 *  campaign, and the angle is its catch-all (see brandOnlyAngle); nothing
 *  heard at all means General. Anything pulling two ways is unsure, with the
 *  likeliest choice preselected. */
export function sortVideo(heard: WordChunk[], campaigns: Campaign[]): Guess {
  const general = campaigns.find((c) => c.general)
  const fallback: Guess = {
    campaignId: general?.id ?? GENERAL_ID,
    angleId: general?.angles[0]?.id ?? '',
    sure: true,
    why: 'No campaign heard, so General',
  }
  const branded = campaigns.filter((c) => !c.general)

  const angleHits = branded.flatMap((campaign) =>
    campaign.angles
      .map((angle) => ({ campaign, angle, words: recognizedBy(angle) }))
      .filter(({ words }) => words.length > 0 && findMentions(heard, words).length > 0),
  )
  const brandHits = branded.filter((c) => c.brandWords.length > 0 && findMentions(heard, c.brandWords).length > 0)

  if (angleHits.length === 1) {
    const { campaign, angle, words } = angleHits[0]
    const otherBrand = brandHits.some((c) => c.id !== campaign.id)
    return {
      campaignId: campaign.id,
      angleId: angle.id,
      sure: !otherBrand,
      why: otherBrand ? `Heard ${said(words)}, but also another campaign's name` : `Heard ${said(words)}`,
    }
  }
  if (angleHits.length > 1) {
    const { campaign, angle } = angleHits[0]
    return {
      campaignId: campaign.id,
      angleId: angle.id,
      sure: false,
      why: `Heard words from ${angleHits.map((h) => h.angle.name).join(' and ')}`,
    }
  }
  if (brandHits.length === 1) {
    const campaign = brandHits[0]
    const { angle, sure } = brandOnlyAngle(campaign)
    return {
      campaignId: campaign.id,
      angleId: angle.id,
      sure,
      why: sure
        ? angle.general
          ? `Heard ${said(campaign.brandWords)}, no angle's words - General`
          : `Heard ${said(campaign.brandWords)}`
        : `Heard ${said(campaign.brandWords)}, but not which angle`,
    }
  }
  if (brandHits.length > 1) {
    return {
      campaignId: brandHits[0].id,
      angleId: brandOnlyAngle(brandHits[0]).angle.id,
      sure: false,
      why: `Heard ${brandHits.map((c) => c.name).join(' and ')}`,
    }
  }
  return fallback
}

const FILLERS = new Set(['um', 'umm', 'uh', 'uhh', 'er', 'erm', 'hmm', 'like'])
const MAX_HEADLINE_WORDS = 8

/** A headline from the first thing he says: his hook, as said, cut to its
 *  first sentence and at most eight words. Never invented - only ever his
 *  own words, and shown to him to change before it is used. */
export function firstLineHeadline(heard: WordChunk[]): string {
  const words: string[] = []
  for (const chunk of heard) {
    const text = chunk.text.trim()
    if (!text) continue
    if (words.length === 0 && FILLERS.has(squash(text))) continue
    words.push(text)
    if (/[.!?]$/.test(text) || words.length >= MAX_HEADLINE_WORDS) break
  }
  const line = words.join(' ').replace(/[,.;:]+$/, '')
  return line ? line[0].toUpperCase() + line.slice(1) : ''
}

/** How much the speech model may be told before it listens. Whisper keeps
 *  about 220 tokens of prompt; this stays well inside it. */
const PROMPT_CHARS = 480

/** Every name worth telling the model about for a day's videos: brands
 *  first, since they matter most, then angles' words and pictures', then the
 *  bank - cut off when there is no more room. */
export function dayWords(campaigns: Campaign[], bank: BankPicture[]): string[] {
  const ordered = [
    ...campaigns.flatMap((c) => c.brandWords),
    ...campaigns.flatMap((c) => c.angles.flatMap((a) => recognizedBy(a))),
    ...campaigns.flatMap((c) => c.angles.flatMap((a) => a.pictures.flatMap((p) => p.words))),
    ...bank.flatMap((p) => p.words),
  ]
  const kept: string[] = []
  const seen = new Set<string>()
  let length = 0
  for (const word of ordered) {
    const key = squash(word)
    if (!key || seen.has(key)) continue
    if (length + word.length + 2 > PROMPT_CHARS) break
    seen.add(key)
    kept.push(word)
    length += word.length + 2
  }
  return kept
}
