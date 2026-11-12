// Which language a video is spoken in, English or French (his ask,
// 2026-11-12: "Sometimes we're going to have French ... He doesn't have to
// choose. It just automatically sets those"). The English model the Cutter
// has always listened with (whisper-tiny.en) can't hear French at all, and
// the speech library won't tell the language by itself - asked nothing, it
// takes English. So the multilingual model is asked the one question Whisper
// answers first: after "start of transcript", which language token comes
// next. Only English and French are told apart; anything else is English, as
// before. The pure parts are here; the model runs in transcribe.worker.ts.

import type { Range } from './silenceMath'

export type SpeechLanguage = 'en' | 'fr'

/** The multilingual model, for telling the language and for hearing French.
 *  The same size as tiny.en, so it fits the same memory. */
export const MULTILINGUAL_MODEL = 'Xenova/whisper-tiny'

/** How much of his speech the language is told from: the most the model
 *  takes in one go. */
export const LANGUAGE_SAMPLE_SEC = 30

/** French only when the model is this sure of it against English - a French
 *  accent on English words is still English. */
const FRENCH_OVER_ENGLISH = 0.6

/** The language, from the model's scores for its next token after "start of
 *  transcript": each language token's chance against the others, French
 *  only when it beats English clearly. */
export function languageFromScores(
  row: ArrayLike<number>,
  tokens: { en: number; fr: number; all: readonly number[] },
): { language: SpeechLanguage; en: number; fr: number } {
  const scores = tokens.all.map((id) => Number(row[id])).filter(Number.isFinite)
  if (scores.length === 0 || !Number.isFinite(Number(row[tokens.en])) || !Number.isFinite(Number(row[tokens.fr]))) {
    return { language: 'en', en: 1, fr: 0 }
  }
  const top = Math.max(...scores)
  const sum = scores.reduce((n, s) => n + Math.exp(s - top), 0)
  const p = (id: number) => Math.exp(Number(row[id]) - top) / sum
  const en = p(tokens.en)
  const fr = p(tokens.fr)
  const language = fr / (fr + en) > FRENCH_OVER_ENGLISH ? 'fr' : 'en'
  return { language, en: Math.round(en * 1000) / 1000, fr: Math.round(fr * 1000) / 1000 }
}

/** Up to `maxSec` of the stretches where he talks, one after another - what
 *  the language is told from. A copy: the samples themselves go on to be
 *  heard. */
export function speechSample(samples: Float32Array, sampleRate: number, windows: readonly Range[], audioStart = 0, maxSec = LANGUAGE_SAMPLE_SEC): Float32Array {
  const most = Math.round(maxSec * sampleRate)
  const out = new Float32Array(most)
  let filled = 0
  for (const { start, end } of windows) {
    if (filled >= most) break
    const from = Math.max(0, Math.floor((start - audioStart) * sampleRate))
    const to = Math.min(samples.length, Math.ceil((end - audioStart) * sampleRate))
    if (to <= from) continue
    const piece = samples.subarray(from, Math.min(to, from + (most - filled)))
    out.set(piece, filled)
    filled += piece.length
  }
  return out.slice(0, filled)
}

/** The model's language tokens, "<|en|>" -> id, as its generation config
 *  lists them. */
export function languageTokens(langToId: Record<string, number> | null | undefined): { en: number; fr: number; all: number[] } | null {
  if (!langToId) return null
  const en = langToId['<|en|>']
  const fr = langToId['<|fr|>']
  if (!Number.isInteger(en) || !Number.isInteger(fr)) return null
  return { en, fr, all: Object.values(langToId).filter((id) => Number.isInteger(id)) }
}

/** What Whisper's French hearing makes up over sound with nobody talking -
 *  the subtitle credits of the films it learned from. Not words he said. */
export const MADE_UP_FRENCH = /sous-?titr|amara\.org|merci d'avoir regard|abonnez-vous/i
