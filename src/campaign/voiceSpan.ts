// Where his voice starts and stops in a talking head's clip (his report,
// 2026-11-14: "in between clips, there's too much separation ... It feels
// like there are too many pauses"). Each clip the Cutter edits keeps a breath
// before his first word and after his last (silenceMath HEAD/TAIL_LEEWAY), so
// a video opens and closes cleanly - but two of them back to back made a
// pause twice as long as any inside his talking videos, and a clip added as
// filmed kept all of the wait before he talked and after he stopped.
// montageRender plays each clip from just before his first word to just after
// his last (`joinTight`), so one runs into the next like a cut in his videos.
//
// Found the way the Cutter finds pauses: the sound's level against the room's
// own (silenceMath.findSilentRanges, with his talking videos' settings).

import { audioExtent, decodeAudio } from '../media/audio'
import { EDGE_CLICK_SEC, findSilentRanges, type Level, type Range, type SilenceSettings } from '../media/silenceMath'
import type { Clip } from './clipParts'

/** Shorter than this, it is not his voice: nothing is trimmed. */
const LEAST_VOICE_SEC = 0.2

/** The least quiet at a clip's edge that counts. His pause setting's own
 *  minimum (0.2-0.5 s) is for pauses inside his talking: a clip the Cutter
 *  edited keeps only 0.15 s before his first word and 0.2 s after his last
 *  (silenceMath HEAD/TAIL_LEEWAY_SEC) - under it, so those were never found
 *  and every join kept them (his report, 2026-11-14). */
const EDGE_QUIET_SEC = 0.06

/** From the start of his first sound to the end of his last, on the clip's
 *  own timeline - a click at either edge (shorter than a word) left out.
 *  Null when no voice is found: the clip is left as it is. */
export function voiceSpanOf(levels: readonly Level[], settings: SilenceSettings): Range | null {
  const extent = audioExtent([...levels])
  if (!extent) return null
  const silences = findSilentRanges([...levels], { ...settings, minSilenceSec: Math.min(settings.minSilenceSec, EDGE_QUIET_SEC) })
  // The sound between the pauses.
  const sounds: Range[] = []
  let cursor = extent.start
  for (const s of silences) {
    if (s.start > cursor) sounds.push({ start: cursor, end: s.start })
    cursor = Math.max(cursor, s.end)
  }
  if (extent.end > cursor) sounds.push({ start: cursor, end: extent.end })
  const voiced = sounds.filter((r) => r.end - r.start > EDGE_CLICK_SEC)
  if (voiced.length === 0) return null
  const span = { start: voiced[0].start, end: voiced[voiced.length - 1].end }
  return span.end - span.start >= LEAST_VOICE_SEC ? span : null
}

/** Clips already measured in this page, by what is in them: a clip is in
 *  many videos. */
const measured = new Map<string, Range | null>()
const MOST_KEPT = 500

/** His voice's span in a clip, measured once per clip in this page. */
export async function voiceSpan(clip: Clip, settings: SilenceSettings): Promise<Range | null> {
  if (!clip.audio) return null
  const file = clip.file
  const key = file ? `${file instanceof File ? file.name : ''}:${file.size}:${settings.thresholdDb}:${EDGE_QUIET_SEC}` : null
  if (key && measured.has(key)) return measured.get(key) ?? null
  const { levels } = await decodeAudio(clip.audio, false, clip.duration)
  const span = voiceSpanOf(levels, settings)
  if (key) {
    if (measured.size >= MOST_KEPT) measured.delete(measured.keys().next().value as string)
    measured.set(key, span)
  }
  return span
}
