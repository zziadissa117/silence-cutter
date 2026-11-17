import Anthropic from '@anthropic-ai/sdk'
import pg from 'pg'
import { createBot } from './bot.ts'
import { ConfigError, loadConfig } from './config.ts'
import { migrate, type Db } from './db.ts'
import { poolConfig } from './pool.ts'
import { makeReader } from './reader.ts'

async function main(): Promise<void> {
  const config = loadConfig()

  const pool = new pg.Pool(poolConfig(config.databaseUrl))
  pool.on('error', (err) => console.error('Database connection error:', err))
  const db: Db = { query: async (text, params) => (await pool.query(text, params)).rows }
  await migrate(db)

  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY?.trim())
  if (!hasKey) console.warn('ANTHROPIC_API_KEY is not set: mods will type every amount by hand.')
  const readPayout = hasKey ? makeReader(new Anthropic(), config.claudeModel) : null

  const { client } = createBot({ config, db, readPayout })
  const stop = async () => {
    await client.destroy()
    await pool.end()
    process.exit(0)
  }
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)

  try {
    await client.login(config.discordToken)
  } catch (err) {
    const text = String(err)
    if (/disallowed intents/i.test(text)) {
      console.error(
        'Discord refused the bot: turn on SERVER MEMBERS INTENT and MESSAGE CONTENT INTENT in the Developer Portal (Bot page), then restart.',
      )
    } else if (/token/i.test(text)) {
      console.error('Discord refused the token: copy a fresh one from the Developer Portal (Bot page → Reset Token) into DISCORD_TOKEN.')
    }
    throw err
  }
}

main().catch((err) => {
  if (err instanceof ConfigError) console.error(err.message)
  else console.error(err)
  process.exit(1)
})
