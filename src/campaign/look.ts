// A campaign, its angles, and what goes on top of every video made for them.
//
// A campaign is the brand: its name, its logo, and the name as he says it.
// An angle is one proven kind of video for that brand - for Vertus, one about
// Sydney Sweeney and one about a guy at school who said something weird - and
// each has its own format: the headline, where the logo sits, the sounds. A
// video is always made for one angle of one campaign.
//
// No captions and no music: he adds both in TikTok when he posts.
//
// Effects (zooms, the logo springing in) belong to the angle too, and are
// all off until he turns them on - see effects.ts.
//
// Nothing here is guessed. Everything is what he typed or picked; a headline
// left empty means no headline, and a logo with no brand name to listen for
// is refused rather than shown at some made-up moment.

import { NO_EFFECTS, type AngleEffects } from './effects'
import type { MusicLevel } from './music'

export type HeadlinePosition = 'top' | 'middle' | 'bottom'
export type HeadlineStyle = 'box' | 'outline'
export type HeadlineSize = 'small' | 'medium' | 'large'
export type LogoPosition = 'top' | 'top-left' | 'top-right' | 'middle' | 'bottom-left' | 'bottom-right'

/** Sounds made on the device, so an angle works before he has found any
 *  sound files. See sounds.ts. */
export type BuiltInSound = 'whoosh' | 'ding' | 'pop'

export type SoundSource = { kind: 'built-in'; name: BuiltInSound } | { kind: 'file'; name: string; audio: Blob }

/** When a sound plays: as the video opens, whenever the brand is said, on
 *  words of his own, or whenever a picture comes up. */
export type SoundTrigger = { kind: 'start' } | { kind: 'brand' } | { kind: 'words'; words: string[] } | { kind: 'picture' }

/** Background music he uploaded, played under his voice - see music.ts. */
export interface AngleMusic {
  name: string
  audio: Blob
  level: MusicLevel
}

export interface AngleSound {
  id: string
  source: SoundSource
  trigger: SoundTrigger
  /** Relative to the sound as recorded. 0 plays it as it is. */
  volumeDb: number
}

/** A picture that comes up when he says certain words - a photo of Sydney
 *  Sweeney when he says her name. */
export interface PictureCue {
  id: string
  image: Blob
  /** What brings it up, e.g. "Sydney Sweeney". */
  words: string[]
  seconds: number
  position: LogoPosition
  /** Width, as a percentage of the video's width. */
  widthPct: number
}

/** A picture kept in the cutter's bank - a Claude, ChatGPT or Google logo -
 *  shared by every campaign, that comes up in any angle using the bank when
 *  he says its words. */
export interface BankPicture {
  id: string
  image: Blob
  words: string[]
  addedAt: number
}

export interface Headline {
  /** Empty means no headline. Each batch can change it before adding
   *  videos - this is only what the box starts with. */
  text: string
  /** Make each video's headline from the first thing he says in it, instead
   *  of this text. It is shown to him, to change, before the video is made. */
  fromFirstLine?: boolean
  seconds: number
  position: HeadlinePosition
  style: HeadlineStyle
  size: HeadlineSize
  /** The outline's colour, for the outline style: a #rrggbb. Default black. */
  outlineColor?: string
  /** The outline's thickness: thin, normal or thick. Default normal. */
  outlineWidth?: OutlineWidth
}

export type OutlineWidth = 'thin' | 'normal' | 'thick'

export interface Angle {
  id: string
  name: string
  headline: Headline
  logo: {
    /** Whether this angle puts the campaign's logo up at all. */
    show: boolean
    seconds: number
    position: LogoPosition
    /** Width, as a percentage of the video's width. */
    widthPct: number
  }
  sounds: AngleSound[]
  pictures: PictureCue[]
  /** Pictures from the bank, and where they sit. One at a time: a newer one
   *  replaces the last. */
  bank: { use: boolean; position: LogoPosition; widthPct: number; seconds: number }
  /** Words that say a video is this angle, for sorting a day's videos. */
  recognize: string[]
  /** The logo, pictures and word-triggered sounds fire on the first mention
   *  only, or on every one. */
  mentions: 'first' | 'every'
  effects: AngleEffects
  /** The track this angle plays under his voice, if any. Each video can
   *  pick another, or none, before it is made. */
  music?: AngleMusic | null
  /** The campaign's own General angle, for its videos that fit none of its
   *  other angles - see generalAngle. Every campaign has one; it can be
   *  changed but not deleted. */
  general?: boolean
}

export interface Campaign {
  id: string
  /** As he typed it. */
  name: string
  /** Null means no logo. */
  logo: Blob | null
  /** The brand's name as he says it, e.g. "Vertus". Brings the logo up, and
   *  is what the speech model is told to listen for. */
  brandWords: string[]
  angles: Angle[]
  /** The one built-in campaign for videos that belong to none: no brand, the
   *  picture bank, a headline from the first line. It cannot be deleted. */
  general?: boolean
  /** How its finished videos are posted - the brand's rules, shared by
   *  everyone signed in. Which accounts and at what times belong to each
   *  person's own Postiz, not here: see posting.ts. Absent until set. */
  posting?: CampaignPosting
  /** What its videos are: him talking to camera (cut, sorted by what he
   *  says), or a reaction - a clip of him reacting with the headline over
   *  it, then a clip of the product. Absent means talking head. */
  format?: CampaignFormat
  /** For a reaction campaign: the sound as it switches from the reaction to
   *  the product. Absent means a whoosh. */
  switchSound?: BuiltInSound | 'none'
  updatedAt: number
}

export type CampaignFormat = 'talking' | 'reaction'

export const isReaction = (campaign: Campaign | undefined | null): boolean => campaign?.format === 'reaction'

/** A campaign's posting rules, the same for everyone who posts it. */
export interface CampaignPosting {
  /** Claude writes each caption from what he says in the video, or he
   *  pastes one per post (a brand's tracking caption). */
  caption: 'claude' | 'paste'
  /** The brand's own rules for captions, as he wrote them. */
  rules: string
  /** Hashtags every post carries, e.g. "#pumpfunpartner". */
  hashtags: string[]
  /** Who says a post can go: him, on the Posts screen; nobody - straight to
   *  Postiz; or the brand, after he sends it to them. */
  approval: 'me' | 'direct' | 'brand'
  /** A reminder the moment it goes live, to submit it to the brand. */
  remind: boolean
}

export const NO_POSTING: CampaignPosting = { caption: 'claude', rules: '', hashtags: [], approval: 'me', remind: false }

/** Everything one video gets, with the campaign and the angle resolved into
 *  one: what the render and the preview actually draw and play. */
export interface VideoLook {
  headline: Headline
  logo: {
    image: Blob | null
    words: string[]
    seconds: number
    position: LogoPosition
    widthPct: number
  }
  sounds: {
    id: string
    source: SoundSource
    trigger: { kind: 'start' } | { kind: 'words'; words: string[] } | { kind: 'picture' }
    volumeDb: number
  }[]
  pictures: PictureCue[]
  /** The bank's pictures this angle may use - none when it does not use the
   *  bank - and where they sit. */
  bankPictures: BankPicture[]
  bankPlacement: Omit<Angle['bank'], 'use'>
  mentions: 'first' | 'every'
  effects: AngleEffects
  /** The brand's name, for effects that fire on it even when the logo is
   *  off. */
  brandWords: string[]
}

export const LIMITS = {
  headlineSeconds: { min: 0.5, max: 15 },
  logoSeconds: { min: 0.5, max: 10 },
  logoWidthPct: { min: 5, max: 60 },
  volumeDb: { min: -30, max: 6 },
  headlineChars: 80,
  sounds: 6,
  pictures: 6,
  pictureSeconds: { min: 0.5, max: 10 },
  pictureWidthPct: { min: 10, max: 90 },
} as const

export const BUILT_IN_SOUNDS: { name: BuiltInSound; label: string }[] = [
  { name: 'whoosh', label: 'Whoosh' },
  { name: 'ding', label: 'Ding' },
  { name: 'pop', label: 'Pop' },
]

/** An angle's format with every style knob at a sensible setting and no
 *  campaign content in it. */
export function blankAngle(id: string, name: string): Angle {
  return {
    id,
    name,
    // Outlined text, no box behind it: the look he asked for by default.
    headline: { text: '', seconds: 4, position: 'top', style: 'outline', size: 'medium' },
    logo: { show: true, seconds: 2.5, position: 'bottom-left', widthPct: 30 },
    sounds: [],
    pictures: [],
    bank: { ...NO_BANK },
    recognize: [],
    mentions: 'first',
    effects: { ...NO_EFFECTS },
  }
}

export const NO_BANK: Angle['bank'] = { use: false, position: 'top', widthPct: 50, seconds: 2 }

export const GENERAL_ID = 'general'

/** The built-in campaign for videos with no campaign in them. Its angle
 *  starts on the picture bank, a headline from the first line, and a pop
 *  whenever a picture comes up - all changeable, like any angle. */
export function generalCampaign(): Campaign {
  const angle = blankAngle(`${GENERAL_ID}-a1`, 'General')
  return {
    id: GENERAL_ID,
    name: 'General',
    logo: null,
    brandWords: [],
    general: true,
    updatedAt: 0,
    angles: [
      {
        ...angle,
        headline: { ...angle.headline, fromFirstLine: true },
        bank: { ...NO_BANK, use: true },
        sounds: [
          { id: `${GENERAL_ID}-s1`, source: { kind: 'built-in', name: 'pop' }, trigger: { kind: 'picture' }, volumeDb: -6 },
        ],
      },
    ],
  }
}

/** A campaign's General angle: the brand's logo when its name is said, a
 *  headline from his first line, and the picture bank with a pop - the same
 *  start as the General campaign, with the brand on. Its id comes from the
 *  campaign's, so both phones on the shared login make the same one. */
export function generalAngle(campaign: Campaign): Angle {
  const angle = blankAngle(`${campaign.id}-general`, 'General')
  return {
    ...angle,
    general: true,
    headline: { ...angle.headline, fromFirstLine: true },
    bank: { ...NO_BANK, use: true },
    sounds: [
      { id: `${campaign.id}-general-s1`, source: { kind: 'built-in', name: 'pop' }, trigger: { kind: 'picture' }, volumeDb: -6 },
    ],
  }
}

/** The campaign with its General angle, last, added if it has none yet.
 *  The General campaign is already general and gets no second one. */
export function withGeneralAngle(campaign: Campaign): Campaign {
  if (campaign.general || campaign.angles.some((a) => a.general)) return campaign
  return { ...campaign, angles: [...campaign.angles, generalAngle(campaign)] }
}

/** A picture cue as it starts: the picture he chose, no words yet, sat at
 *  the top, clear of his face. */
export function blankPicture(id: string, image: Blob): PictureCue {
  return { id, image, words: [], seconds: 2.5, position: 'top', widthPct: 55 }
}

/** A new campaign: blank, with one angle to start from. */
/** A new campaign has only its General angle: its videos need fit no angle,
 *  and more can be added whenever he wants. */
export function blankCampaign(id: string): Campaign {
  return withGeneralAngle({ id, name: '', logo: null, brandWords: [], angles: [], updatedAt: 0 })
}

/** A new angle that starts as a copy of another's format, so a second angle
 *  does not mean setting every knob again. */
export function copyAngle(from: Angle, id: string, name: string): Angle {
  return {
    ...from,
    id,
    name,
    // A copy of the General angle is an ordinary angle; a campaign has one
    // General.
    general: undefined,
    headline: { ...from.headline },
    logo: { ...from.logo },
    effects: { ...from.effects },
    bank: { ...from.bank },
    recognize: [...from.recognize],
    sounds: from.sounds.map((s) => ({ ...s, id: crypto.randomUUID() })),
    pictures: from.pictures.map((p) => ({ ...p, words: [...p.words], id: crypto.randomUUID() })),
  }
}

/** Splits what he typed into a words box - "Vertus, Virtus" - into the
 *  separate things to listen for. */
export function parseWordList(typed: string): string[] {
  const seen = new Set<string>()
  const words: string[] = []
  for (const part of typed.split(/[,\n]/)) {
    const word = part.trim().replace(/\s+/g, ' ')
    if (!word || seen.has(word.toLowerCase())) continue
    seen.add(word.toLowerCase())
    words.push(word)
  }
  return words
}

export function videoLook(campaign: Campaign, angle: Angle, bank: BankPicture[] = []): VideoLook {
  const logoOn = angle.logo.show && campaign.logo !== null
  return {
    headline: angle.headline,
    logo: {
      image: logoOn ? campaign.logo : null,
      words: logoOn ? campaign.brandWords : [],
      seconds: angle.logo.seconds,
      position: angle.logo.position,
      widthPct: angle.logo.widthPct,
    },
    sounds: angle.sounds.map((sound) => ({
      ...sound,
      trigger:
        sound.trigger.kind === 'brand'
          ? { kind: 'words' as const, words: campaign.brandWords }
          : sound.trigger,
    })),
    pictures: angle.pictures,
    bankPictures: angle.bank.use ? bank : [],
    bankPlacement: { position: angle.bank.position, widthPct: angle.bank.widthPct, seconds: angle.bank.seconds },
    mentions: angle.mentions,
    effects: angle.effects,
    brandWords: campaign.brandWords,
  }
}

function within(value: number, { min, max }: { min: number; max: number }): boolean {
  return Number.isFinite(value) && value >= min && value <= max
}

/** What is wrong with the campaign itself, in words he can act on. */
export function campaignProblems(campaign: Campaign): string[] {
  const problems: string[] = []
  if (!campaign.name.trim()) problems.push('Give the campaign a name.')
  if (campaign.logo && campaign.brandWords.length === 0) {
    problems.push('Type the brand name as you say it - that is what brings the logo up.')
  }
  if (campaign.brandWords.length === 0 && campaign.angles.some((a) => a.effects.brandHit !== 'off')) {
    problems.push('An angle punches in when you say the brand - type the brand name as you say it.')
  }
  const usesBrand = campaign.angles.some((a) => a.sounds.some((s) => s.trigger.kind === 'brand'))
  if (usesBrand && campaign.brandWords.length === 0) {
    problems.push('A sound plays when you say the brand - type the brand name as you say it.')
  }
  return problems
}

/** What is wrong with one angle. A campaign with a problem in any angle is
 *  never rendered: a bad setup should stop at the form, not halfway through
 *  someone's batch. */
export function angleProblems(campaign: Campaign, angle: Angle): string[] {
  const problems: string[] = []
  if (!angle.name.trim()) problems.push('Give the angle a name.')
  const others = campaign.angles.filter((a) => a.id !== angle.id)
  if (others.some((a) => a.name.trim().toLowerCase() === angle.name.trim().toLowerCase())) {
    problems.push(`This campaign already has an angle called "${angle.name.trim()}".`)
  }

  const { headline, logo } = angle
  if (headline.text.length > LIMITS.headlineChars) {
    problems.push(`The headline is over ${LIMITS.headlineChars} characters - it won't fit on the screen.`)
  }
  if (!within(headline.seconds, LIMITS.headlineSeconds)) {
    problems.push(`The headline has to stay up between ${LIMITS.headlineSeconds.min} and ${LIMITS.headlineSeconds.max} seconds.`)
  }
  if (!within(logo.seconds, LIMITS.logoSeconds)) {
    problems.push(`The logo has to stay up between ${LIMITS.logoSeconds.min} and ${LIMITS.logoSeconds.max} seconds.`)
  }
  if (!within(logo.widthPct, LIMITS.logoWidthPct)) {
    problems.push(`The logo's width has to be between ${LIMITS.logoWidthPct.min}% and ${LIMITS.logoWidthPct.max}%.`)
  }
  if (angle.effects.brandHit !== 'off' && campaign.brandWords.length === 0) {
    problems.push('The brand punch-in needs the brand name - type it in the campaign.')
  }

  if (angle.sounds.length > LIMITS.sounds) problems.push(`At most ${LIMITS.sounds} sounds.`)
  angle.sounds.forEach((sound, i) => {
    const which = `Sound ${i + 1}`
    if (sound.trigger.kind === 'words' && sound.trigger.words.length === 0) {
      problems.push(`${which} plays on a word - say which word.`)
    }
    if (sound.trigger.kind === 'brand' && campaign.brandWords.length === 0) {
      problems.push(`${which} plays on the brand name, but the campaign has none typed in.`)
    }
    if (sound.trigger.kind === 'picture' && angle.pictures.length === 0 && !angle.bank.use) {
      problems.push(`${which} plays when a picture comes up, but this angle has no pictures and doesn't use the bank.`)
    }
    if (!within(sound.volumeDb, LIMITS.volumeDb)) {
      problems.push(`${which}'s volume has to be between ${LIMITS.volumeDb.min} and +${LIMITS.volumeDb.max} dB.`)
    }
    if (sound.source.kind === 'file' && sound.source.audio.size === 0) {
      problems.push(`${which}'s file is empty. Pick it again.`)
    }
  })

  if (angle.pictures.length > LIMITS.pictures) problems.push(`At most ${LIMITS.pictures} pictures.`)
  angle.pictures.forEach((picture, i) => {
    const which = `Picture ${i + 1}`
    if (picture.words.length === 0) problems.push(`${which} needs the words that bring it up.`)
    if (!within(picture.seconds, LIMITS.pictureSeconds)) {
      problems.push(`${which} has to stay up between ${LIMITS.pictureSeconds.min} and ${LIMITS.pictureSeconds.max} seconds.`)
    }
    if (!within(picture.widthPct, LIMITS.pictureWidthPct)) {
      problems.push(`${which}'s width has to be between ${LIMITS.pictureWidthPct.min}% and ${LIMITS.pictureWidthPct.max}%.`)
    }
    if (picture.image.size === 0) problems.push(`${which}'s image is empty. Pick it again.`)
  })
  return problems
}

/** Every word this video listens for - the brand, and any words a sound is
 *  set to. Empty means the speech model does not need to run at all, which
 *  is the lighter job on a phone. */
export function wordsToHear(look: VideoLook): string[] {
  const words = look.logo.image ? [...look.logo.words] : []
  if (look.effects.brandHit !== 'off') words.push(...look.brandWords)
  for (const sound of look.sounds) if (sound.trigger.kind === 'words') words.push(...sound.trigger.words)
  for (const picture of look.pictures) words.push(...picture.words)
  for (const picture of look.bankPictures) words.push(...picture.words)
  return [...new Map(words.map((w) => [w.toLowerCase(), w])).values()]
}

/** One line describing an angle, for the main screen. */
export function describeAngle(campaign: Campaign, angle: Angle, headlineText = angle.headline.text): string {
  const parts: string[] = []
  if (angle.headline.fromFirstLine) parts.push('Headline from your first line')
  else if (headlineText.trim()) parts.push(`Headline ${angle.headline.seconds}s`)
  if (campaign.logo && angle.logo.show && campaign.brandWords.length > 0) {
    parts.push(`Logo on "${campaign.brandWords.join('" / "')}"`)
  }
  if (angle.sounds.length > 0) parts.push(`${angle.sounds.length} sound${angle.sounds.length === 1 ? '' : 's'}`)
  if (angle.pictures.length > 0) parts.push(`${angle.pictures.length} picture${angle.pictures.length === 1 ? '' : 's'}`)
  if (angle.bank.use) parts.push('picture bank')
  const moves = [
    angle.effects.cutPunch !== 'off' && 'punch-ins',
    angle.effects.hookPush !== 'off' && 'push-in',
    angle.effects.brandHit !== 'off' && 'brand hit',
    angle.effects.logoPop && 'pop-in',
  ].filter(Boolean)
  if (moves.length > 0) parts.push(moves.join(', '))
  return parts.length > 0 ? parts.join(' · ') : 'Nothing added yet - only the pauses are cut'
}

// --- The first version --------------------------------------------------------

/** How a campaign was stored before angles: one format per campaign, with
 *  the logo's words kept on the format. */
export interface CampaignV1 {
  id: string
  name: string
  headline: Headline
  logo: { image: unknown; words: string[]; seconds: number; position: LogoPosition; widthPct: number }
  sounds: { id: string; source: unknown; trigger: { kind: 'start' } | { kind: 'words'; words: string[] }; volumeDb: number }[]
  mentions: 'first' | 'every'
  updatedAt: number
}

/** The id the one angle of an upgraded campaign gets - fixed, so a video
 *  queued before the upgrade can find it. */
export function firstAngleId(campaignId: string): string {
  return `${campaignId}-a1`
}

/** Turns a campaign set up before angles into one with a single angle, "Angle
 *  1", holding exactly the format it had. A sound that played on the logo's
 *  own words becomes a sound on the brand name, which is what it was. Works
 *  on stored rows, so the files stay in whatever form they were stored in. */
export function upgradeV1<File>(row: CampaignV1): Omit<Campaign, 'logo' | 'angles'> & {
  logo: File | null
  angles: (Omit<Angle, 'sounds' | 'pictures'> & {
    sounds: (Omit<AngleSound, 'source'> & { source: unknown })[]
    pictures: never[]
  })[]
} {
  const brand = new Set(row.logo.words.map((w) => w.toLowerCase()))
  const sameAsBrand = (words: string[]) =>
    words.length > 0 && words.length === brand.size && words.every((w) => brand.has(w.toLowerCase()))
  return {
    id: row.id,
    name: row.name,
    logo: (row.logo.image as File | null) ?? null,
    brandWords: row.logo.words,
    updatedAt: row.updatedAt,
    angles: [
      {
        id: firstAngleId(row.id),
        name: 'Angle 1',
        headline: row.headline,
        logo: { show: true, seconds: row.logo.seconds, position: row.logo.position, widthPct: row.logo.widthPct },
        sounds: row.sounds.map((s) => ({
          ...s,
          trigger: s.trigger.kind === 'words' && sameAsBrand(s.trigger.words) ? { kind: 'brand' as const } : s.trigger,
        })),
        pictures: [],
        bank: { ...NO_BANK },
        recognize: [],
        mentions: row.mentions,
        effects: { ...NO_EFFECTS },
      },
    ],
  }
}
