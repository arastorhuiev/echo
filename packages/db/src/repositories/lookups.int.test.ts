import { connectTestDb, type TestDbHandle } from "@test/helpers/db.js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { Db } from "@/client.js"
import * as lookups from "@/repositories/lookups.js"

let handle: TestDbHandle
let db: Db

beforeAll(() => {
  handle = connectTestDb()
  db = handle.db
})

afterAll(async () => {
  await handle.close()
})

describe("lookups repository (integration)", () => {
  it("creates a lookup with status=queued and returns the full row", async () => {
    const row = await lookups.create(db, {
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
    const created = await lookups.create(db, {
      providerId: "stub",
      queryHash: "h2",
      query: { x: true },
    })
    const found = await lookups.findById(db, created.id)
    expect(found?.id).toBe(created.id)
  })

  it("findById returns null for an unknown id", async () => {
    const found = await lookups.findById(db, "00000000-0000-0000-0000-000000000000")
    expect(found).toBeNull()
  })

  it("findCachedByHash returns the most recent DONE lookup, ignoring others", async () => {
    const oldDone = await lookups.create(db, {
      providerId: "p1",
      queryHash: "cache-key",
      query: {},
    })
    await lookups.markDone(db, oldDone.id, { v: "first" })

    const running = await lookups.create(db, {
      providerId: "p1",
      queryHash: "cache-key",
      query: {},
    })
    await lookups.markRunning(db, running.id)

    await new Promise((r) => setTimeout(r, 10))

    const newDone = await lookups.create(db, {
      providerId: "p1",
      queryHash: "cache-key",
      query: {},
    })
    await lookups.markDone(db, newDone.id, { v: "third" })

    const cached = await lookups.findCachedByHash(db, "p1", "cache-key")
    expect(cached?.id).toBe(newDone.id)
    expect(cached?.result).toEqual({ v: "third" })
  })

  it("transitions queued -> running -> done", async () => {
    const lookup = await lookups.create(db, {
      providerId: "stub",
      queryHash: "trans",
      query: {},
    })

    await lookups.markRunning(db, lookup.id)
    const running = await lookups.findById(db, lookup.id)
    expect(running?.status).toBe("running")
    expect(running?.startedAt).toBeInstanceOf(Date)
    expect(running?.finishedAt).toBeNull()

    await lookups.markDone(db, lookup.id, { ok: true })
    const done = await lookups.findById(db, lookup.id)
    expect(done?.status).toBe("done")
    expect(done?.result).toEqual({ ok: true })
    expect(done?.finishedAt).toBeInstanceOf(Date)
  })

  it("markFailed records error_kind, error_message and finishedAt", async () => {
    const lookup = await lookups.create(db, {
      providerId: "stub",
      queryHash: "fail",
      query: {},
    })
    await lookups.markFailed(db, lookup.id, "Timeout", "exceeded 60s")
    const cur = await lookups.findById(db, lookup.id)
    expect(cur?.status).toBe("failed")
    expect(cur?.errorKind).toBe("Timeout")
    expect(cur?.errorMessage).toBe("exceeded 60s")
    expect(cur?.finishedAt).toBeInstanceOf(Date)
  })

  it("markCancelled stamps finishedAt", async () => {
    const lookup = await lookups.create(db, {
      providerId: "stub",
      queryHash: "cancel",
      query: {},
    })
    await lookups.markCancelled(db, lookup.id)
    const cur = await lookups.findById(db, lookup.id)
    expect(cur?.status).toBe("cancelled")
    expect(cur?.finishedAt).toBeInstanceOf(Date)
  })
})
