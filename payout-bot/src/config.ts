export interface Config {
  discordToken: string
  guildId: string
  /** Where students post payout screenshots. */
  payoutChannelId: string
  /** Where approval cards go. Same as the payout channel unless set. */
  approvalChannelId: string
  /** Where the midnight leaderboard is posted. Same as the payout channel unless set. */
  leaderboardChannelId: string
  /** Members with this role can approve, as well as anyone with Manage Nicknames or Manage Server. */
  modRoleId: string | null
  databaseUrl: string
  /** The day rolls over at midnight here. */
  timeZone: string
  claudeModel: string
}

export class ConfigError extends Error {}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const missing: string[] = []
  const need = (name: string): string => {
    const value = env[name]?.trim()
    if (!value) missing.push(name)
    return value ?? ''
  }
  const optional = (name: string): string | null => env[name]?.trim() || null

  const config: Config = {
    discordToken: need('DISCORD_TOKEN'),
    guildId: need('GUILD_ID'),
    payoutChannelId: need('PAYOUT_CHANNEL_ID'),
    approvalChannelId: '',
    leaderboardChannelId: '',
    modRoleId: optional('MOD_ROLE_ID'),
    databaseUrl: need('DATABASE_URL'),
    timeZone: optional('TIME_ZONE') ?? 'America/New_York',
    claudeModel: optional('CLAUDE_MODEL') ?? 'claude-opus-5-5',
  }
  config.approvalChannelId = optional('APPROVAL_CHANNEL_ID') ?? config.payoutChannelId
  config.leaderboardChannelId = optional('LEADERBOARD_CHANNEL_ID') ?? config.payoutChannelId

  if (missing.length) throw new ConfigError(`Missing settings: ${missing.join(', ')}. See payout-bot/README.md.`)
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: config.timeZone })
  } catch {
    throw new ConfigError(`TIME_ZONE "${config.timeZone}" is not a time zone name, e.g. America/New_York.`)
  }
  return config
}
