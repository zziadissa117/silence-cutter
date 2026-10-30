// One-time sign-in links (his ask, 2026-10-29): the only way a second login
// comes to exist. The owner's login makes one for a name; the link holds a
// random code, the server keeps only its SHA-256; it works once, within 48
// hours, and the person who opens it chooses their password and has their own
// space - their own campaigns, bank, songs and posts, nothing of his.
//
// Plain rules, no imports, for Deno and the tests.

/** How long a link works if nobody opens it. */
export const INVITE_MS = 48 * 60 * 60 * 1000

/** A login name a link may make: lower case letters, digits, dot, dash or
 *  underscore, 3 to 30 of them - never "admin". Null when it isn't one. */
export function cleanLoginName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const name = value.trim().toLowerCase()
  if (!/^[a-z0-9._-]{3,30}$/.test(name) || name === 'admin') return null
  return name
}

/** Whether a space is one that can be signed in to. Rows from before the
 *  status column count as active. */
export function isActive(space: { status?: string | null }): boolean {
  return (space.status ?? 'active') === 'active'
}

/** The songs' cutter_config key prefix for a space: the owner's bank keeps
 *  the rows it always had; any other login has its own, empty to begin with. */
export function songPrefix(spaceId: string, ownerId: string | null): string {
  return spaceId === ownerId ? 'song:' : `song@${spaceId}:`
}

/** How many phones a login made with a link can be signed in on at once. A
 *  phone's Safari and the Cutter added to its Home Screen keep separate
 *  storage, so they sign in separately: three is one phone both ways and one
 *  more - or two phones. */
export const MAX_DEVICES = 3

export interface Device {
  id: string
  name: string
}

/** The phone a sign-in says it is, checked - or null. */
export function deviceFrom(value: unknown): Device | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  const id = typeof v.id === 'string' && /^[\w-]{16,64}$/.test(v.id) ? v.id : null
  if (!id) return null
  const name = typeof v.name === 'string' ? v.name.replace(/\s+/g, ' ').trim().slice(0, 80) : ''
  return { id, name: name || 'A phone' }
}

/** Whether a new phone may sign in: the login's phones still on it, this one
 *  aside. */
export function roomForDevice(active: readonly { device_id: string }[], device: Device): 'known' | 'new' | 'full' {
  if (active.some((d) => d.device_id === device.id)) return 'known'
  return active.length >= MAX_DEVICES ? 'full' : 'new'
}
