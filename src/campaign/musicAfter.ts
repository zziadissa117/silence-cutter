// Music on a finished video, from the Posts screen: mixes a track under the
// video that is waiting (addMusic.ts), sends that as a new version of the post
// with what he had already written for it, and takes the old one back.

import { addMusicTo } from './addMusic'
import type { Campaign } from './look'
import { NO_POSTING } from './look'
import type { MusicLevel } from './music'
import { forgetSend, localVideo, queueSend } from './outbox'
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
  onProgress,
}: {
  post: ServerPost
  campaign: Campaign | undefined
  music: { audio: Blob; level: MusicLevel }
  onProgress?: (fraction: number) => void
}): Promise<string> {
  const local = postingHere()
  if (!local) throw new PostingError('Posting is not set up on this phone.')
  const video = await videoOf(post)
  if (!video) throw new PostingError("The video isn't on this phone any more, and Postiz's copy couldn't be fetched.")

  const made = await addMusicTo(video, music, onProgress)
  const key = nextKey(post.key)
  const queued = await queueSend(
    {
      key,
      profileId: local.profile.id,
      campaign: { id: post.campaignId, name: post.campaignName, posting: campaign?.posting ?? NO_POSTING },
      meta: {
        transcript: '',
        headline: post.headline ?? '',
        duration: 0,
        fileName: post.fileName ?? 'video.mp4',
        ...(post.batch ? { batch: post.batch } : {}),
        carry: { caption: post.caption, title: post.title, ...(post.captions ? { captions: post.captions } : {}) },
      },
    },
    made.blob,
  )
  if (queued === 'duplicate') return 'The version with music is already on its way.'
  // The new one is safely kept and queued: now the old one goes.
  try {
    await postAction('reject', post.id)
    await forgetSend(post.key).catch(() => {})
  } catch (error) {
    return `The version with music is on its way, but the old post could not be removed - reject it in Posts. (${error instanceof Error ? error.message : String(error)})`
  }
  return 'Music added. The new version is on its way and the old one was removed.'
}
