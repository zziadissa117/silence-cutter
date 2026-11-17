import { PGlite } from '@electric-sql/pglite'
import { migrate, type Db } from './db.ts'

/** A real Postgres running in memory, for tests. */
export async function memoryDb(): Promise<{ db: Db; pg: PGlite }> {
  const pg = new PGlite()
  const db: Db = { query: async (text, params) => (await pg.query(text, params)).rows as never[] }
  await migrate(db)
  return { db, pg }
}
