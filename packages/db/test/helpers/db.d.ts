import postgres from "postgres"
import type { Db } from "@/client.js"
export interface TestDbHandle {
  readonly db: Db
  readonly sql: postgres.Sql
  close(): Promise<void>
}
/**
 * Connect to the Postgres container that vitest's globalSetup spun up.
 * Each test file calls this in `beforeAll` for its own pool, and closes
 * in `afterAll`. Sharing the underlying container is what makes per-file
 * integration tests cheap (~50 ms connect vs ~3 s for a fresh container).
 */
export declare function connectTestDb(): TestDbHandle
