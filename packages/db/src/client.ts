import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"

export interface CreateDbClientOptions {
  /** Max pool size. Default 10. */
  max?: number
  /** Connection timeout in seconds. Default 30. */
  connectTimeout?: number
}

export function createDbClient(databaseUrl: string, options: CreateDbClientOptions = {}) {
  const sql = postgres(databaseUrl, {
    max: options.max ?? 10,
    connect_timeout: options.connectTimeout ?? 30,
    onnotice: () => {},
  })
  // Drizzle 1.0 dropped the `schema` field on the postgres-js driver — tables
  // are imported directly into queries, and the runtime client doesn't need a
  // schema map. Use the `relations` slot when we adopt the query API later.
  const db = drizzle({ client: sql })
  return {
    db,
    sql,
    close: (): Promise<void> => sql.end({ timeout: 5 }),
    /**
     * Lightweight connectivity check (`select 1`). Throws if Postgres is
     * unreachable. Used by health checks and CI smoke tests.
     */
    async ping(): Promise<void> {
      await sql`select 1`
    },
  }
}

// Derive the db / client types from the factory return so we don't have
// to chase Drizzle's generic shape (relations vs. legacy schema).
export type DbClient = ReturnType<typeof createDbClient>
export type Db = DbClient["db"]
