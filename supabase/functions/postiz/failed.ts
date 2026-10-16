// A video that went out to some of its accounts and not others: which ones
// failed, how each account is named on the post (two accounts can share a
// name - "Ilyan Hamdane" on YouTube and on Instagram), and what the post says.

export interface FailedAccount {
  id: string
  name: string
  platform: string
}

export interface PostizRef {
  postId: string
  integration: string
}

export interface PostizState {
  id: string
  state?: string
  integration?: { id?: string; providerIdentifier?: string; name?: string }
}

const PLATFORMS: Record<string, string> = {
  'instagram-standalone': 'Instagram',
  instagram: 'Instagram',
  'tiktok-business': 'TikTok',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  facebook: 'Facebook',
}

/** "Instagram" for "instagram-standalone"; an unknown one as it is. */
export function platformWord(platform: string | undefined): string {
  if (!platform) return ''
  return PLATFORMS[platform] ?? platform
}

/** How an account is named on its post: its name, with the platform added
 *  when another account on the same post has that name too. */
export function accountName(name: string, platform: string | undefined, accounts: FailedAccount[]): string {
  const twins = accounts.filter((a) => a.name === name).length
  return twins > 1 && platform ? `${name} (${platformWord(platform)})` : name
}

/** The post's Postiz posts that Postiz says failed. */
export function failedRefs(ids: PostizRef[], found: PostizState[]): PostizRef[] {
  const byId = new Map(found.map((p) => [p.id, p]))
  return ids.filter((ref) => byId.get(ref.postId)?.state === 'ERROR')
}

/** "Not posted to Jake (Instagram)." - each failed account by its name on the post. */
export function notPostedNote(errored: PostizState[], accounts: FailedAccount[]): string {
  const names = errored.map((p) => {
    const account = accounts.find((a) => a.id === p.integration?.id)
    const name = account?.name ?? p.integration?.name ?? 'an account'
    return accountName(name, account?.platform ?? p.integration?.providerIdentifier, accounts)
  })
  return `Not posted to ${[...new Set(names)].join(', ')}.`
}
