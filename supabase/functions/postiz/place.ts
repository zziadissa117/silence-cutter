// The place every Instagram post is tagged with - a default for the login,
// or a campaign's own - to say where its posts are from.
//
// Instagram takes a place as `location_id`: the ID of the place's Facebook
// Page. Postiz passes Instagram's settings through as they are sent (extra
// ones are kept, never refused), but does not hand `location_id` on to
// Instagram yet - asked of them on 2026-10-22, with the change written
// (docs/postiz-location). Until then posts carry it and nothing shows.
//
// No imports: the posting function runs it on Deno, the phone uses it to
// read what he pastes, and the tests run it under Vitest.

export interface Place {
  /** The place's Facebook Page ID. */
  id: string
  /** What he sees: from the link, or the ID when the link has no name. */
  name: string
}

const ID = /^\d{5,25}$/

/** A place as saved, checked - or null. */
export function cleanPlace(value: unknown): Place | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  const id = typeof v.id === 'string' ? v.id.trim() : ''
  if (!ID.test(id)) return null
  const name = typeof v.name === 'string' && v.name.trim() ? v.name.trim().slice(0, 80) : `Place ${id}`
  return { id, name }
}

const words = (slug: string) =>
  decodeURIComponent(slug)
    .replace(/[-_+]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())

/** A place from what he pastes: the place's ID, or a link to it - its
 *  Facebook page ("facebook.com/pages/Los-Angeles-California/110970792260960",
 *  "facebook.com/profile.php?id=…") or its Instagram location page
 *  ("instagram.com/explore/locations/…/los-angeles-california/"). Null when
 *  no ID can be read from it - a page known only by its short name. */
export function parsePlace(text: string): Place | null {
  const raw = text.trim()
  if (ID.test(raw)) return { id: raw, name: `Place ${raw}` }
  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
  } catch {
    return null
  }
  const param = url.searchParams.get('id')
  if (param && ID.test(param)) return { id: param, name: `Place ${param}` }
  const parts = url.pathname.split('/').filter(Boolean)
  const at = parts.findIndex((p) => ID.test(p))
  if (at >= 0) {
    // The words beside the number, before it (Facebook) or after it (Instagram).
    const slug = parts[at - 1] && !['pages', 'locations', 'explore', 'places'].includes(parts[at - 1]) ? parts[at - 1] : parts[at + 1]
    const name = slug ? words(slug) : ''
    return { id: parts[at], name: name || `Place ${parts[at]}` }
  }
  // "Los-Angeles-California-110970792260960": the number at the end of a name.
  const tail = parts.at(-1)?.match(/^(.*?)-(\d{5,25})$/)
  if (tail) return { id: tail[2], name: words(tail[1]) || `Place ${tail[2]}` }
  return null
}

/** The place a campaign's Instagram posts are tagged with: its own, else the
 *  default, else none. */
export function instagramPlace(
  settings: { instagramPlace?: unknown; campaigns?: Record<string, { instagramPlace?: unknown }> } | undefined,
  campaignId: string,
): Place | null {
  return cleanPlace(settings?.campaigns?.[campaignId]?.instagramPlace) ?? cleanPlace(settings?.instagramPlace)
}
