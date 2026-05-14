import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import postgres from "postgres"

const here = fileURLToPath(new URL(".", import.meta.url))

/**
 * Resolved migrations folder for this package. In dev (tsx) it points to
 * `packages/db/migrations/`; in the built dist this resolves to
 * `packages/db/dist/../migrations` -> the same folder. Both are correct.
 */
export const defaultMigrationsFolder = resolve(here, "..", "migrations")

/**
 * Apply pending migrations against the given DATABASE_URL. Safe to call
 * on every API boot — Drizzle tracks applied migrations in a metadata
 * table and skips ones it's already run.
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
    await migrate(db, { migrationsFolder })
  } finally {
    await sql.end({ timeout: 5 })
  }
}
