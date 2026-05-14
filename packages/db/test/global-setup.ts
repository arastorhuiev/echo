import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import postgres from "postgres"

/**
 * Vitest globalSetup: spins up a single Postgres 17 container for the entire
 * integration suite (cheaper than per-file containers), runs migrations
 * once, and exposes the connection string via `TEST_DATABASE_URL` for each
 * `*.int.test.ts` to pick up.
 */

const here = fileURLToPath(new URL(".", import.meta.url))
const migrationsFolder = resolve(here, "..", "migrations")

let container: StartedPostgreSqlContainer | undefined

export async function setup(): Promise<void> {
  container = await new PostgreSqlContainer("postgres:17-alpine").start()
  process.env.TEST_DATABASE_URL = container.getConnectionUri()

  const sql = postgres(process.env.TEST_DATABASE_URL, { max: 1, onnotice: () => {} })
  const db = drizzle({ client: sql })
  await migrate(db, { migrationsFolder })
  await sql.end({ timeout: 5 })
}

export async function teardown(): Promise<void> {
  await container?.stop()
}
