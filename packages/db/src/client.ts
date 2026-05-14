import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import * as schema from "./schema/index.js"

export type Schema = typeof schema
export type Db = PostgresJsDatabase<Schema>

export interface DbClient {
  readonly db: Db
  readonly sql: postgres.Sql
  close(): Promise<void>
}

export interface CreateDbClientOptions {
  /** Max pool size. Default 10. */
  max?: number
  /** Connection timeout in seconds. Default 30. */
  connectTimeout?: number
}

export function createDbClient(databaseUrl: string, options: CreateDbClientOptions = {}): DbClient {
  const sql = postgres(databaseUrl, {
    max: options.max ?? 10,
    connect_timeout: options.connectTimeout ?? 30,
    onnotice: () => {},
  })
  const db = drizzle(sql, { schema })
  return {
    db,
    sql,
    close: () => sql.end({ timeout: 5 }),
  }
}
