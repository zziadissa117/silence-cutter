// TikTok Sans, TikTok's own typeface, for the headline - so it reads as
// TikTok's own text, not something pasted on. He asked for it "1:1 to
// tiktok".
//
// Open source under the SIL Open Font License (fonts/OFL.txt), and shipped
// with the app rather than fetched, so the headline comes out the same with
// no signal. One variable file covers every weight; the Latin Extended half
// only loads when a headline needs one of its letters.

import { emojiSpritesReady } from './emojiSprites'
import latin from './fonts/TikTokSans-latin.woff2'
import latinExt from './fonts/TikTokSans-latin-ext.woff2'
import interLatin from './fonts/Inter-latin.woff2'
import interLatinExt from './fonts/Inter-latin-ext.woff2'

export const HEADLINE_FAMILY = '"TikTok Sans", "Apple Color Emoji", "Helvetica Neue", Arial, sans-serif'

/** An Instagram-looking headline: Inter (SIL Open Font License,
 *  fonts/Inter-OFL.txt), close to Instagram's own clean sans - for Trial reel
 *  copies, so not every copy reads in TikTok's type (his ask, 2026-11-17:
 *  "Keep a TikTok, but maybe make an Instagram-type font"). */
export const INSTAGRAM_FAMILY = '"Inter", "Apple Color Emoji", "Helvetica Neue", Arial, sans-serif'

/** The family of a headline's font. */
export const familyOf = (font: 'instagram' | undefined): string => (font === 'instagram' ? INSTAGRAM_FAMILY : HEADLINE_FAMILY)

const LATIN =
  'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD'
const LATIN_EXT =
  'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF'

let ready: Promise<void> | null = null

/** Resolves once TikTok Sans can be drawn - and, on the Cutter server, the
 *  iPhone's emoji pictures asked for so far (emojiSprites.ts). Never rejects:
 *  if the font will not load, the headline falls back to Helvetica rather
 *  than not appearing. */
export function headlineFontReady(): Promise<void> {
  return fontReady().then(() => emojiSpritesReady())
}

function fontReady(): Promise<void> {
  ready ??= (async () => {
    if (typeof document === 'undefined' || typeof FontFace === 'undefined') return
    const faces = [
      new FontFace('TikTok Sans', `url(${latin}) format('woff2')`, { weight: '300 900', unicodeRange: LATIN }),
      new FontFace('TikTok Sans', `url(${latinExt}) format('woff2')`, { weight: '300 900', unicodeRange: LATIN_EXT }),
      new FontFace('Inter', `url(${interLatin}) format('woff2')`, { weight: '400 900', unicodeRange: LATIN }),
      new FontFace('Inter', `url(${interLatinExt}) format('woff2')`, { weight: '400 900', unicodeRange: LATIN_EXT }),
    ]
    for (const face of faces) document.fonts.add(face)
    // Both halves: a headline with an ł or an ş laid out before its half
    // arrived was measured in the fallback font and changed mid-video.
    await Promise.all(faces.map((face) => face.load()))
  })().catch(() => {})
  return ready
}
