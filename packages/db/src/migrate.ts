import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import postgres from "postgres"

const here = fileURLToPath(new URL(".", import.meta.url))

/**
 * Resolved migrations folder for this package. In dev it points to
 * `packages/db/migrations/`; in the built dist this resolves to
 * `packages/db/dist/../migrations` -> the same folder. Both are correct.
 */
export const defaultMigrationsFolder = resolve(here, "..", "migrations")

/**
 * Stable Postgres advisory lock id used to serialise concurrent
 * `applyMigrations()` calls. Picked once and never changed — any value
 * within `Number.MAX_SAFE_INTEGER` works as long as no other code in
 * the project uses the same id for a different purpose. Auto-released
 * if the holding session crashes.
 */
const APPLY_MIGRATIONS_LOCK_ID = 7332026051500

/**
 * Apply pending migrations against the given DATABASE_URL. Safe to call
 * on every API boot — Drizzle tracks applied migrations in a metadata
 * table and skips ones it's already run.
 *
 * Wrapped in a Postgres session-level advisory lock so two API replicas
 * starting at once don't race on the migration metadata table. The
 * second waiter blocks until the first releases the lock, then sees
 * Drizzle's "already applied" state and continues.
 *
 * Throws on connection or migration failure so the caller can fail-fast
 * (typically by exiting the process before NestJS starts listening).
 */
export async function applyMigrations(
  databaseUrl: string,
  migrationsFolder: string = defaultMigrationsFolder,
): Promise<void> {
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} })
  const db = drizzle({ client: sql })
  try {
    await sql`SELECT pg_advisory_lock(${APPLY_MIGRATIONS_LOCK_ID})`
    try {
      await migrate(db, { migrationsFolder })
    } finally {
      await sql`SELECT pg_advisory_unlock(${APPLY_MIGRATIONS_LOCK_ID})`
    }
  } finally {
    await sql.end({ timeout: 5 })
  }
}
