// Redoing captions after the campaign's caption rules or hashtags change -
// the posts already made, waiting or scheduled, written again with the new
// rules. Which posts that touches, and how a caption he wrote himself is
// kept, are decided here, pure, so they are tested without Postiz or Claude
// (recaption.test.ts); index.ts does the writing and the Postiz calls.

/** A scheduled post this close to its time is left alone: taking it out of
 *  Postiz and back in could miss the time, or post it twice. */
export const RECAPTION_CUTOFF_MS = 15 * 60_000

export interface RecaptionCandidate {
  id: string
  status: string
  post_at: string | null
}

/** Which of a campaign's posts get new captions: every one waiting for him
 *  (or approved but held for later), queued for Postiz, or scheduled with
 *  its time still a quarter of an hour or more away. */
export function pickRecaption(posts: readonly RecaptionCandidate[], now: number): { redo: string[]; tooSoon: number } {
  const redo: string[] = []
  let tooSoon = 0
  for (const post of posts) {
    if (post.status === 'waiting' || post.status === 'approved') redo.push(post.id)
    else if (post.status === 'scheduled') {
      if (post.post_at && Date.parse(post.post_at) - now >= RECAPTION_CUTOFF_MS) redo.push(post.id)
      else tooSoon++
    }
  }
  return { redo, tooSoon }
}

/** What a redo does: add the campaign's hashtags that a caption is missing,
 *  keeping every word (the default - a hundred scheduled posts, one new
 *  hashtag), or have Claude write it again with the new rules. */
export type RecaptionMode = 'hashtags' | 'rewrite'

export function cleanMode(value: unknown): RecaptionMode {
  return value === 'rewrite' ? 'rewrite' : 'hashtags'
}

/** How a post's caption is redone in rewrite mode: Claude writes it again from the video,
 *  unless the words are his own - a pasted (tracking) caption, or one he
 *  wrote for a post made by hand - which are kept, with the hashtags added. */
export function recaptionMode(post: { by_hand: boolean; rules: { caption: string } }): 'rewrite' | 'hashtags' {
  return post.rules.caption === 'claude' && !post.by_hand ? 'rewrite' : 'hashtags'
}
