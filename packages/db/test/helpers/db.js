import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
/**
 * Connect to the Postgres container that vitest's globalSetup spun up.
 * Each test file calls this in `beforeAll` for its own pool, and closes
 * in `afterAll`. Sharing the underlying container is what makes per-file
 * integration tests cheap (~50 ms connect vs ~3 s for a fresh container).
 */
export function connectTestDb() {
  const url = process.env.TEST_DATABASE_URL
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL is not set — vitest globalSetup must run before any *.int.test.ts file",
    )
  }
  const sql = postgres(url, { max: 4, onnotice: () => {} })
  const db = drizzle({ client: sql })
  return {
    db,
    sql,
    close: () => sql.end({ timeout: 5 }),
  }
}
//# sourceMappingURL=db.js.map
