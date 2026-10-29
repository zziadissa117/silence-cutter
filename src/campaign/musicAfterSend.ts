// Music on a finished video, from the Posts screen: mixes a track under the
// video that is waiting (addMusic.ts), sends that as a new version of the post
// with what he had already written for it, and takes the old one back. When
// the phone kept the video's sound without its music (musicFree.ts), the
// music is changed or taken off instead of added on top.

import { addMusicTo } from './addMusic'
import type { Campaign } from './look'
import { NO_POSTING } from './look'
import type { MusicLevel } from './music'
import { forgetSend, keepVoiceOnly, localVideo, queueSend, replaceNow, voiceOnly } from './outbox'
import { PostingError, postAction, postingHere, type ServerPost } from './posting'

/** The key of the next version of a post: `id` -> `id~2` -> `id~3`. */
export function nextKey(key: string): string {
  const [id, version] = key.split('~')
  const n = Number(version)
  return `${id}~${Number.isInteger(n) && n >= 1 ? n + 1 : 2}`
}

/** Music can be added while the post can still be replaced: waiting for him,
 *  approved, or scheduled for later. Once it has gone out it can't. */
export function canAddMusic(post: ServerPost, now = Date.now()): boolean {
  if (post.status === 'waiting' || post.status === 'approved') return true
  return post.status === 'scheduled' && post.postAt !== null && new Date(post.postAt).getTime() > now + 2 * 60_000
}

/** Whether the phone kept this post's sound without its music, so its music
 *  can be changed or taken off rather than only added on top. */
export async function canChangeMusic(post: ServerPost): Promise<boolean> {
  return canAddMusic(post) && (await voiceOnly(post.key)) !== null
}

async function videoOf(post: ServerPost): Promise<Blob | null> {
  const local = await localVideo(post.key).catch(() => null)
  if (local && local.size > 0) return local
  if (post.videoUrl) {
    const response = await fetch(post.videoUrl).catch(() => null)
    const blob = response?.ok ? await response.blob().catch(() => null) : null
    if (blob && blob.size > 0) return blob
  }
  return null
}

/** Adds the track and replaces the post. Returns what to tell him. */
export async function sendWithMusic({
  post,
  campaign,
  music,
  caption,
  approve = false,
  onProgress,
}: {
  post: ServerPost
  campaign: Campaign | undefined
  /** Null: the music taken off (only with the music-free sound kept). */
  music: { audio: Blob; level: MusicLevel } | null
  /** His caption as it is in the box now, when it differs from the post's. */
  caption?: string
  /** The new version goes out without asking again. */
  approve?: boolean
  onProgress?: (fraction: number) => void
}): Promise<string> {
  const local = postingHere()
  if (!local) throw new PostingError('Posting is not set up on this phone.')
  const video = await videoOf(post)
  if (!video) throw new PostingError("The video isn't on this phone any more, and Postiz's copy couldn't be fetched.")

  const voice = await voiceOnly(post.key)
  if (!music && !voice) throw new PostingError("This video's music can't be taken off: it was made before the Cutter kept its sound without music.")
  const made = await addMusicTo(video, music, onProgress, Boolean(post.batch), voice)
  const key = nextKey(post.key)
  const done = !music ? 'Music taken off' : voice ? 'Music changed' : 'Music added'
  const said = caption?.trim() ? caption : post.caption
  // Taken out once the new version is on the server - unless it is due too
  // soon to wait. Taken out first, a send that stalled left nothing at all.
  const outNow = replaceNow(post)
  const queued = await queueSend(
    {
      key,
      profileId: local.profile.id,
      campaign: { id: post.campaignId, name: post.campaignName, posting: campaign?.posting ?? NO_POSTING },
      ...(outNow ? {} : { replaces: post.key }),
      meta: {
        transcript: '',
        headline: post.headline ?? '',
        duration: 0,
        fileName: post.fileName ?? 'video.mp4',
        ...(post.batch ? { batch: post.batch } : {}),
        // A post he made by hand keeps the time he picked for it - the new
        // version went to the campaign's next time instead, today and not
        // tomorrow (2026-10-24, Lock in).
        ...(post.byHand ? { byHand: { at: post.postAt, caption: said ?? '', about: '' } } : {}),
        carry: {
          caption: caption?.trim() ? caption : post.caption,
          title: post.title,
          ...(post.captions ? { captions: post.captions } : {}),
          ...(approve ? { approve: true } : {}),
        },
      },
    },
    made.blob,
  )
  if (queued === 'duplicate') return 'That new version is already on its way.'
  // The new version keeps the sound without music too: changed again later.
  if (voice) await keepVoiceOnly(key, voice).catch(() => {})
  if (!outNow) return `${done}. The new version is on its way - the old one comes out as soon as it arrives.`
  // The new one is safely kept and queued: now the old one goes.
  try {
    await postAction('reject', post.id)
    await forgetSend(post.key).catch(() => {})
  } catch (error) {
    return `The new version is on its way, but the old post could not be removed - reject it in Posts. (${error instanceof Error ? error.message : String(error)})`
  }
  return approve
    ? `${done} and approved. The new version is on its way and the old one was removed.`
    : `${done}. The new version is on its way and the old one was removed.`
}
