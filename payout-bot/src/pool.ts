import type pg from 'pg'

/**
 * Hosted Postgres (Supabase, Railway's public URL) wants SSL with a certificate
 * Node does not know, so SSL is on without verification unless the database is
 * local or on Railway's private network.
 */
export function poolConfig(databaseUrl: string): pg.PoolConfig {
  let url: URL
  try {
    url = new URL(databaseUrl)
  } catch {
    return { connectionString: databaseUrl, max: 3 }
  }
  const sslmode = url.searchParams.get('sslmode')
  url.searchParams.delete('sslmode') // pg would let this override the ssl option below
  const privateHost =
    ['localhost', '127.0.0.1', '::1'].includes(url.hostname) || url.hostname.endsWith('.railway.internal')
  const ssl = sslmode === 'disable' || (privateHost && !sslmode) ? false : { rejectUnauthorized: false }
  return { connectionString: url.toString(), ssl, max: 3 }
}
