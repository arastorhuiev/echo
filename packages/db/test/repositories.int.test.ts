import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { Db } from "@/client.js"
import * as repositories from "@/repositories/index.js"

const here = fileURLToPath(new URL(".", import.meta.url))
const migrationsFolder = resolve(here, "..", "migrations")

let container: StartedPostgreSqlContainer
let sql: postgres.Sql
let db: Db

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start()
  sql = postgres(container.getConnectionUri(), { max: 4, onnotice: () => {} })
  db = drizzle({ client: sql })
  await migrate(db, { migrationsFolder })
})

afterAll(async () => {
  await sql?.end({ timeout: 5 })
  await container?.stop()
})

describe("lookups repository", () => {
  it("creates a lookup with status=queued and returns the full row", async () => {
    const row = await repositories.lookups.create(db, {
      providerId: "stub",
      queryHash: "h1",
      query: { foo: 1 },
    })
    expect(typeof row.id).toBe("string")
    expect(row.status).toBe("queued")
    expect(row.providerId).toBe("stub")
    expect(row.query).toEqual({ foo: 1 })
    expect(row.createdAt).toBeInstanceOf(Date)
    expect(row.startedAt).toBeNull()
    expect(row.userId).toBeNull()
    expect(row.paidAt).toBeNull()
  })

  it("findById returns the same row that create returned", async () => {
    const created = await repositories.lookups.create(db, {
      providerId: "stub",
      queryHash: "h2",
      query: { x: true },
    })
    const found = await repositories.lookups.findById(db, created.id)
    expect(found?.id).toBe(created.id)
  })

  it("findById returns null for an unknown id", async () => {
    const found = await repositories.lookups.findById(db, "00000000-0000-0000-0000-000000000000")
    expect(found).toBeNull()
  })

  it("findCachedByHash returns the most recent DONE lookup, ignoring others", async () => {
    const oldDone = await repositories.lookups.create(db, {
      providerId: "p1",
      queryHash: "cache-key",
      query: {},
    })
    await repositories.lookups.markDone(db, oldDone.id, { v: "first" })

    const running = await repositories.lookups.create(db, {
      providerId: "p1",
      queryHash: "cache-key",
      query: {},
    })
    await repositories.lookups.markRunning(db, running.id)

    await new Promise((r) => setTimeout(r, 10))

    const newDone = await repositories.lookups.create(db, {
      providerId: "p1",
      queryHash: "cache-key",
      query: {},
    })
    await repositories.lookups.markDone(db, newDone.id, { v: "third" })

    const cached = await repositories.lookups.findCachedByHash(db, "p1", "cache-key")
    expect(cached?.id).toBe(newDone.id)
    expect(cached?.result).toEqual({ v: "third" })
  })

  it("transitions queued -> running -> done", async () => {
    const lookup = await repositories.lookups.create(db, {
      providerId: "stub",
      queryHash: "trans",
      query: {},
    })

    await repositories.lookups.markRunning(db, lookup.id)
    const running = await repositories.lookups.findById(db, lookup.id)
    expect(running?.status).toBe("running")
    expect(running?.startedAt).toBeInstanceOf(Date)
    expect(running?.finishedAt).toBeNull()

    await repositories.lookups.markDone(db, lookup.id, { ok: true })
    const done = await repositories.lookups.findById(db, lookup.id)
    expect(done?.status).toBe("done")
    expect(done?.result).toEqual({ ok: true })
    expect(done?.finishedAt).toBeInstanceOf(Date)
  })

  it("markFailed records error_kind, error_message and finishedAt", async () => {
    const lookup = await repositories.lookups.create(db, {
      providerId: "stub",
      queryHash: "fail",
      query: {},
    })
    await repositories.lookups.markFailed(db, lookup.id, "Timeout", "exceeded 60s")
    const cur = await repositories.lookups.findById(db, lookup.id)
    expect(cur?.status).toBe("failed")
    expect(cur?.errorKind).toBe("Timeout")
    expect(cur?.errorMessage).toBe("exceeded 60s")
    expect(cur?.finishedAt).toBeInstanceOf(Date)
  })

  it("markCancelled stamps finishedAt", async () => {
    const lookup = await repositories.lookups.create(db, {
      providerId: "stub",
      queryHash: "cancel",
      query: {},
    })
    await repositories.lookups.markCancelled(db, lookup.id)
    const cur = await repositories.lookups.findById(db, lookup.id)
    expect(cur?.status).toBe("cancelled")
    expect(cur?.finishedAt).toBeInstanceOf(Date)
  })
})

describe("lookup_events repository", () => {
  it("append + listByLookup returns events ordered by seq", async () => {
    const lookup = await repositories.lookups.create(db, {
      providerId: "stub",
      queryHash: "events",
      query: {},
    })

    await repositories.lookupEvents.append(db, lookup.id, 1, { _tag: "Started" })
    await repositories.lookupEvents.append(db, lookup.id, 2, { _tag: "Progress", pct: 50 })
    await repositories.lookupEvents.append(db, lookup.id, 3, {
      _tag: "Final",
      data: { result: "ok" },
    })

    const events = await repositories.lookupEvents.listByLookup(db, lookup.id)
    expect(events).toHaveLength(3)
    expect(events[0]?.seq).toBe(1)
    expect(events[1]?.payload).toEqual({ _tag: "Progress", pct: 50 })
    expect(events[2]?.payload).toEqual({ _tag: "Final", data: { result: "ok" } })
  })
})

describe("providers repository", () => {
  it("upsertHealth inserts a new row with state and outcome stamped", async () => {
    await repositories.providers.upsertHealth(db, "p-new", "closed", "success")
    const snap = await repositories.providers.getBreakerState(db, "p-new")
    expect(snap?.state).toBe("closed")
    expect(snap?.openedAt).toBeNull()
    expect(snap?.lastSuccessAt).toBeInstanceOf(Date)
    expect(snap?.lastFailureAt).toBeNull()
  })

  it("upsertHealth on existing row preserves the unaffected timestamps", async () => {
    await repositories.providers.upsertHealth(db, "p-update", "closed", "success")
    const before = await repositories.providers.getBreakerState(db, "p-update")
    const successAt = before?.lastSuccessAt

    await new Promise((r) => setTimeout(r, 10))

    await repositories.providers.upsertHealth(db, "p-update", "open", "failure")
    const after = await repositories.providers.getBreakerState(db, "p-update")

    expect(after?.state).toBe("open")
    expect(after?.openedAt).toBeInstanceOf(Date)
    expect(after?.lastFailureAt).toBeInstanceOf(Date)
    // lastSuccessAt was not touched on this upsert -> preserved
    expect(after?.lastSuccessAt?.getTime()).toBe(successAt?.getTime())
  })

  it("getBreakerState returns null for an unknown provider id", async () => {
    const snap = await repositories.providers.getBreakerState(db, "p-unknown")
    expect(snap).toBeNull()
  })

  it("findById returns the full provider row", async () => {
    await repositories.providers.upsertHealth(db, "p-full", "closed", "success")
    const row = await repositories.providers.findById(db, "p-full")
    expect(row?.id).toBe("p-full")
    expect(row?.enabled).toBe(true)
  })
})
